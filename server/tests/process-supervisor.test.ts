import { expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { ProcessSupervisor } from "../modules/streaming/process-supervisor.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class Child extends EventEmitter {
	stderr = new EventEmitter();
	signals: string[] = [];
	constructor(
		public spawnfile: string,
		private order: string[],
	) {
		super();
	}
	kill(signal: NodeJS.Signals) {
		this.signals.push(signal);
		this.order.push(`${this.spawnfile}:${signal}`);
		queueMicrotask(() => {
			this.emit("close");
		});
		return true;
	}
}
function fixture() {
	const order: string[] = [];
	const children: Child[] = [];
	const errors: string[] = [];
	const supervisor = new ProcessSupervisor(
		(command) => {
			const child = new Child(command, order);
			children.push(child);
			return child as unknown as ChildProcess;
		},
		(error) => {
			errors.push(error);
		},
		20,
	);
	return { supervisor, children, order, errors };
}

test("only the current retry can report stderr while the stream is running", async () => {
	const f = fixture();
	const reports: string[] = [];
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		(data) => reports.push(data),
	);
	try {
		const retired = f.children[0];
		if (!retired) throw new Error("Missing first child");
		retired.stderr.emit("data", Buffer.from("first"));
		retired.emit("exit", 0, null);
		retired.stderr.emit("data", Buffer.from("after exit"));
		await sleep(10);
		const current = f.children[1];
		if (!current) throw new Error("Missing retry child");
		current.stderr.emit("data", Buffer.from("current"));
		retired.stderr.emit("data", Buffer.from("after retry"));
		expect(reports).toEqual(["first", "after exit", "current"]);
	} finally {
		await f.supervisor.stop();
	}
});

test("Stop silences stderr immediately and retired sessions stay silent after Start", async () => {
	const f = fixture();
	const reports: string[] = [];
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		(data) => reports.push(data),
	);
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		(data) => reports.push(data),
	);
	try {
		const encoder = f.children[0];
		const sender = f.children[1];
		if (!encoder || !sender) throw new Error("Missing stream children");
		encoder.stderr.emit("data", Buffer.from("active encoder"));
		sender.stderr.emit("data", Buffer.from("active sender"));
		const stopping = f.supervisor.stop();
		encoder.stderr.emit("data", Buffer.from("stopping encoder"));
		sender.stderr.emit("data", Buffer.from("stopping sender"));
		await stopping;
		f.supervisor.start();
		f.supervisor.spawnLoop(
			"srtla_send",
			() => [],
			2,
			(data) => reports.push(data),
		);
		encoder.stderr.emit("data", Buffer.from("retired encoder"));
		sender.stderr.emit("data", Buffer.from("retired sender"));
		f.children[2]?.stderr.emit("data", Buffer.from("new sender"));
		expect(reports).toEqual(["active encoder", "active sender", "new sender"]);
	} finally {
		await f.supervisor.stop();
	}
});

test("a failed retry also retires the previous child's stderr", async () => {
	const child = new Child("srtla_send", []);
	const reports: string[] = [];
	let attempts = 0;
	const supervisor = new ProcessSupervisor(
		() => {
			if (++attempts === 1) return child as unknown as ChildProcess;
			throw new Error("synthetic spawn failure");
		},
		() => {},
		20,
	);
	supervisor.start();
	supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		(data) => reports.push(data),
	);
	try {
		child.stderr.emit("data", Buffer.from("active"));
		child.emit("exit", 0, null);
		child.stderr.emit("data", Buffer.from("buffered"));
		await sleep(10);
		expect(attempts).toBeGreaterThanOrEqual(2);
		child.stderr.emit("data", Buffer.from("after failed retry"));
		expect(reports).toEqual(["active", "buffered"]);
	} finally {
		await supervisor.stop();
	}
});

test("child error/close retries once and Stop cancels restart timers", async () => {
	const f = fixture();
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		() => {},
	);
	f.children[0]?.emit("error", new Error("synthetic spawn error"));
	f.children[0]?.emit("close");
	await sleep(10);
	expect(f.children.length).toBe(2);
	expect(f.errors.length).toBe(1);
	f.children[1]?.emit("close");
	await f.supervisor.stop();
	await sleep(10);
	expect(f.children.length).toBe(2);
});
test("ordered Stop terminates encoder before sender and permits a later session", async () => {
	const f = fixture();
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		() => {},
	);
	f.supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	await f.supervisor.stop();
	expect(f.order).toEqual(["belacoder:SIGTERM", "srtla_send:SIGTERM"]);
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	expect(f.children.length).toBe(3);
	await f.supervisor.stop();
});

test("unresponsive children are force-killed before Stop completes", async () => {
	const order: string[] = [];
	const child = new Child("belacoder", order);
	child.kill = (signal) => {
		child.signals.push(signal);
		if (signal === "SIGKILL")
			queueMicrotask(() => {
				child.emit("close");
			});
		return true;
	};
	const supervisor = new ProcessSupervisor(
		() => child as unknown as ChildProcess,
		() => {},
		5,
	);
	supervisor.start();
	supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	await supervisor.stop();
	expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("direct-child exit completes Stop without waiting for pipe close", async () => {
	const child = new Child("belacoder", []);
	child.kill = (signal) => {
		child.signals.push(signal);
		queueMicrotask(() => {
			child.emit("exit", 0, null);
		});
		return true;
	};
	const supervisor = new ProcessSupervisor(
		() => child as unknown as ChildProcess,
		() => {},
		5,
	);
	supervisor.start();
	supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	await supervisor.stop();
	expect(child.signals).toEqual(["SIGTERM"]);
});
