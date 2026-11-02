import { describe, expect, test } from "bun:test";
import { waitForAudioSource } from "../modules/streaming/audio-wait.ts";
import { StreamLifecycle } from "../modules/streaming/start-lifecycle.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function until(condition: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (condition()) return;
		await sleep(2);
	}
	throw new Error("Timed out");
}
function fixture(
	overrides: Partial<
		ConstructorParameters<typeof StreamLifecycle<string, string, string>>[0]
	> = {},
) {
	const events: string[] = [];
	const lifecycle = new StreamLifecycle<string, string, string>(
		{
			isUpdating: () => false,
			status: (active) => {
				events.push(`status:${active}`);
			},
			validate: (params) => params,
			prepare: async (config) => config,
			launch: (value) => {
				events.push(`launch:${value}`);
			},
			stop: async () => {
				events.push("cleanup");
			},
			error: () => {
				events.push("error");
			},
			...overrides,
		},
		5,
	);
	return { lifecycle, events };
}

describe("stream start ownership", () => {
	test("locks before awaiting and admits only one start", async () => {
		const ready = deferred<string>();
		const { lifecycle, events } = fixture({ prepare: () => ready.promise });
		const first = lifecycle.start("first");
		expect(events).toEqual(["status:true"]);
		expect(await lifecycle.start("second")).toBe(false);
		ready.resolve("first");
		expect(await first).toBe(true);
		await lifecycle.stop();
		expect(events.filter((event) => event.startsWith("launch"))).toEqual([
			"launch:first",
		]);
	});
	test("Stop during DNS/preparation prevents late spawning and holds admission until cleanup", async () => {
		const ready = deferred<string>();
		const { lifecycle, events } = fixture({ prepare: () => ready.promise });
		const starting = lifecycle.start("old");
		const stopping = lifecycle.stop();
		expect(await lifecycle.start("new")).toBe(false);
		ready.resolve("old");
		expect(await starting).toBe(false);
		await stopping;
		expect(events).not.toContain("launch:old");
		expect(events.at(-1)).toBe("status:false");
		expect(await lifecycle.start("new")).toBe(true);
		await lifecycle.stop();
	});
	test("Stop cancels missing-audio wait without a fake connection or later retry", async () => {
		const audio: { source?: string } = {};
		const { lifecycle, events } = fixture({
			prepare: (_, signal) =>
				waitForAudioSource(
					() => audio.source,
					signal,
					() => {},
					2,
				),
		});
		const starting = lifecycle.start("audio");
		await lifecycle.stop();
		expect(await starting).toBe(false);
		audio.source = "USB";
		await sleep(10);
		expect(events.some((event) => event.startsWith("launch"))).toBe(false);
	});
	test("no eligible paths rejects start before spawning", async () => {
		const { lifecycle, events } = fixture({
			prepare: async () => {
				throw new Error("no available network connections");
			},
		});
		expect(await lifecycle.start("offline")).toBe(false);
		expect(events).toEqual(["status:true", "cleanup", "error", "status:false"]);
	});
	test("invalid saved configuration fails once without autostart retries", async () => {
		let attempts = 0;
		const { lifecycle, events } = fixture({
			validate: () => {
				attempts++;
				throw new Error("invalid saved config");
			},
		});
		expect(await lifecycle.start("boot", true)).toBe(false);
		await sleep(20);
		expect(attempts).toBe(1);
		expect(events.some((event) => event.startsWith("launch"))).toBe(false);
	});
	test("autostart retries transient failure and manual start cancels a pending retry", async () => {
		let attempts = 0;
		const { lifecycle, events } = fixture({
			prepare: async (value) => {
				if (++attempts === 1) throw new Error("DNS unavailable");
				return value;
			},
		});
		expect(await lifecycle.start("boot", true)).toBe(false);
		await until(() => events.includes("launch:boot"));
		await lifecycle.stop();
		const other = fixture({
			prepare: async (value) => {
				if (value === "boot") throw new Error("offline");
				return value;
			},
		});
		await other.lifecycle.start("boot", true);
		expect(await other.lifecycle.start("manual")).toBe(true);
		await sleep(20);
		expect(other.events.filter((event) => event.startsWith("launch"))).toEqual([
			"launch:manual",
		]);
		await other.lifecycle.stop();
	});
	test("Stop and disabling autostart cancel scheduled retries", async () => {
		for (const disableOnly of [false, true]) {
			let attempts = 0;
			const { lifecycle } = fixture({
				prepare: async () => {
					attempts++;
					throw new Error("offline");
				},
			});
			await lifecycle.start("boot", true);
			if (disableOnly) lifecycle.cancelAutostart();
			else await lifecycle.stop();
			await sleep(20);
			expect(attempts).toBe(1);
		}
	});
	test("software update blocks manual and boot starts", async () => {
		const { lifecycle, events } = fixture({ isUpdating: () => true });
		expect(await lifecycle.start("manual")).toBe(false);
		expect(await lifecycle.start("boot", true)).toBe(false);
		expect(events).toEqual([]);
	});
});
