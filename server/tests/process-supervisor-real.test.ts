import { describe, expect, it, spyOn } from "bun:test";
import { ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessSupervisor } from "../modules/streaming/process-supervisor.ts";

function realSupervisor(report: (message: string) => void, grace: number) {
	const supervisor = new ProcessSupervisor(
		(_, args) =>
			spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] }),
		report,
		grace,
	);
	supervisor.start();
	return supervisor;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 3000;
	while (!(await predicate())) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for child");
		await sleep(5);
	}
}

describe("stream process supervision", () => {
	it("restarts an exited child until Stop", async () => {
		const directory = await mkdtemp(join(tmpdir(), "stream-retry-test-"));
		const marker = join(directory, "starts");
		const supervisor = realSupervisor(() => {}, 100);
		try {
			supervisor.spawnLoop(
				"srtla_send",
				() => [
					"-e",
					`require("fs").appendFileSync(${JSON.stringify(marker)}, "start\\n");`,
				],
				20,
				() => {},
			);
			await until(
				async () =>
					(await readFile(marker, "utf8").catch(() => "")).split("\n").length >=
					3,
			);
			await supervisor.stop();
			const stoppedAt = await readFile(marker, "utf8");
			await sleep(50);
			expect(await readFile(marker, "utf8")).toBe(stoppedAt);
		} finally {
			await supervisor.stop();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("lets the encoder drain before terminating the sender", async () => {
		const directory = await mkdtemp(join(tmpdir(), "stream-stop-test-"));
		const marker = join(directory, "order");
		const supervisor = realSupervisor(() => {}, 300);
		let ready = 0;
		try {
			for (const role of ["encoder", "sender"] as const) {
				const code = `process.on("SIGTERM", () => setTimeout(() => { require("fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${role}\n`)}); process.exit(0); }, ${role === "encoder" ? 40 : 0})); console.error("ready"); setInterval(() => {}, 1000);`;
				supervisor.spawnLoop(
					role === "encoder" ? "belacoder" : "srtla_send",
					() => ["-e", code],
					10,
					() => {
						ready++;
					},
				);
			}
			await until(() => ready === 2);
			await supervisor.stop();
			expect(await readFile(marker, "utf8")).toBe("encoder\nsender\n");
		} finally {
			await supervisor.stop();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("continues signaling other senders if one signal throws", async () => {
		const errors: string[] = [];
		const supervisor = realSupervisor((message) => errors.push(message), 100);
		let ready = 0;
		let hups = 0;
		let received = false;
		const originalKill = ChildProcess.prototype.kill;
		try {
			for (let i = 0; i < 2; i++) {
				supervisor.spawnLoop(
					"srtla_send",
					() => [
						"-e",
						'process.on("SIGHUP", () => console.error("hup")); console.error("ready"); setInterval(() => {}, 1000);',
					],
					10,
					(data) => {
						if (data.includes("ready")) ready++;
						if (data.includes("hup")) received = true;
					},
				);
			}
			await until(() => ready === 2);
			const kill = spyOn(ChildProcess.prototype, "kill").mockImplementation(
				function (this: ChildProcess, signal) {
					if (signal === "SIGHUP" && ++hups === 1) throw new Error("EPERM");
					return originalKill.call(this, signal);
				},
			);
			try {
				supervisor.signal("srtla_send", "SIGHUP");
				await until(() => received);
				expect(hups).toBe(2);
				expect(errors).toHaveLength(1);
			} finally {
				kill.mockRestore();
			}
		} finally {
			await supervisor.stop();
		}
	});
	it("cancels queued retries before waiting for a hung encoder and escalates termination", async () => {
		const directory = await mkdtemp(join(tmpdir(), "stream-process-test-"));
		const marker = join(directory, "starts");
		const supervisor = realSupervisor(() => {}, 180);
		let ready = false;
		try {
			supervisor.spawnLoop(
				"belacoder",
				() => [
					"-e",
					'process.on("SIGTERM", () => {}); console.error("ready"); setInterval(() => {}, 1000);',
				],
				10,
				() => {
					ready = true;
				},
			);
			await until(() => ready);
			supervisor.spawnLoop(
				"srtla_send",
				() => [
					"-e",
					`require("fs").appendFileSync(${JSON.stringify(marker)}, "start\\n"); process.exit(0);`,
				],
				100,
				() => {},
			);
			await until(
				async () => (await readFile(marker, "utf8").catch(() => "")).length > 0,
			);
			await sleep(15);
			const started = Date.now();
			const stopping = supervisor.stop();
			expect(supervisor.stop()).toBe(stopping);
			await stopping;
			expect(Date.now() - started).toBeGreaterThanOrEqual(150);
			expect(Date.now() - started).toBeLessThan(2000);
			await sleep(120);
			expect(await readFile(marker, "utf8")).toBe("start\n");
		} finally {
			await supervisor.stop();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("signals only owned senders and can start another session after Stop", async () => {
		const supervisor = realSupervisor(() => {}, 100);
		const code =
			'process.on("SIGHUP", () => console.error("hup")); console.error("ready"); setInterval(() => {}, 1000);';
		let owned = "";
		let unrelatedOutput = "";
		const unrelated = spawn(process.execPath, ["-e", code], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		unrelated.stderr.on("data", (data) => {
			unrelatedOutput += data;
		});
		try {
			supervisor.spawnLoop(
				"srtla_send",
				() => ["-e", code],
				10,
				(data) => {
					owned += data;
				},
			);
			await until(
				() => owned.includes("ready") && unrelatedOutput.includes("ready"),
			);
			supervisor.signal("srtla_send", "SIGHUP");
			await until(() => owned.includes("hup"));
			await sleep(30);
			expect(unrelatedOutput).toBe("ready\n");
			await supervisor.stop();
			owned = "";
			supervisor.start();
			supervisor.spawnLoop(
				"srtla_send",
				() => ["-e", code],
				10,
				(data) => {
					owned += data;
				},
			);
			await until(() => owned.includes("ready"));
		} finally {
			await supervisor.stop();
			const exited = new Promise((resolve) => unrelated.once("exit", resolve));
			unrelated.kill("SIGKILL");
			await exited;
		}
	});
	it("retries failed spawns and stops those retries", async () => {
		let errors = 0;
		const supervisor = new ProcessSupervisor(
			undefined,
			() => {
				errors++;
			},
			100,
		);
		supervisor.start();
		supervisor.spawnLoop(
			"/nonexistent-stream-test-command",
			() => [],
			10,
			() => {},
		);
		try {
			await until(() => errors >= 2);
		} finally {
			await supervisor.stop();
		}
		const stoppedAt = errors;
		await sleep(40);
		expect(errors).toBe(stoppedAt);
	});
});
