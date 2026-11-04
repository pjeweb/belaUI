import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type WebSocket from "ws";
import type { ConfigParameters } from "../modules/streaming/config-validation.ts";

let active = false;
let listener: (() => void | Promise<void>) | undefined;
let wanAddresses = ["192.0.2.1"];
let localAddresses: string[] = [];
const directories = new Set<string>();
const spawnLoop = mock(
	(
		_command: string,
		_args: () => string[],
		_cooldown: number,
		_report: (data: string) => void,
	) => {},
);
const supervisor = {
	start: mock(() => {}),
	spawnLoop,
	stop: mock(async () => {}),
};
let publish = async (_addresses: string[]) => {};
const setAddresses = mock((addresses: string[]) => publish(addresses));
const reload = mock(() => {});
const error = mock(() => {});
const updates = mock(() => {
	expect(active).toBe(false);
});
async function transform(_input: string, output: string) {
	directories.add(dirname(output));
	await writeFile(output, "prepared pipeline");
	return output;
}
const defaults = {
	resolveSrtla: async (address: string) => address,
	overlay: transform,
	audio: async (_source: string, _signal: AbortSignal) => "usbaudio",
	audioFile: transform,
};
const preparation = { ...defaults };

mock.module("../helpers/logger.ts", () => ({
	logger: { error: () => {}, warn: () => {} },
}));
mock.module("../modules/setup.ts", () => ({
	setup: { ips_file: "/synthetic/ips", bitrate_file: "/synthetic/bitrate" },
}));
mock.module("../modules/config.ts", () => ({
	getConfig: () => ({}),
	saveConfig: () => {},
}));
mock.module("../modules/network/bcrpt.ts", () => ({
	getBcrptLowMtu: () => false,
}));
mock.module("../modules/network/network-interfaces.ts", () => ({
	onNetworkInterfacesChange: (callback: () => void | Promise<void>) => {
		listener = callback;
		return () => {
			listener = undefined;
		};
	},
}));
mock.module("../modules/system/software-updates.ts", () => ({
	isUpdating: () => false,
	periodicCheckForSoftwareUpdates: updates,
}));
mock.module("../modules/ui/notifications.ts", () => ({
	notificationBroadcast: () => {},
	notificationExists: () => false,
}));
mock.module("../modules/ui/status.ts", () => ({ sendStatus: () => {} }));
mock.module("../modules/ui/websocket-server.ts", () => ({
	getSocketSenderId: () => "request-id",
	broadcastMsg: () => {},
}));
mock.module("../modules/streaming/processes.ts", () => ({
	streamingProcesses: supervisor,
	belacoderExec: "/synthetic/belacoder",
	srtlaSendExec: "/synthetic/srtla_send",
}));
mock.module("../modules/streaming/encoder.ts", () => ({
	setBitrate: () => 5000,
}));
mock.module("../modules/streaming/audio.ts", () => ({
	DEFAULT_AUDIO_ID: "Pipeline default",
	asrcProbe: (...args: Parameters<typeof defaults.audio>) =>
		preparation.audio(...args),
	pipelineSetAsrc: (...args: Parameters<typeof transform>) =>
		preparation.audioFile(...args),
}));
mock.module("../modules/streaming/pipelines.ts", () => ({
	removeBitrateOverlay: (...args: Parameters<typeof transform>) =>
		preparation.overlay(...args),
}));
mock.module("../modules/streaming/srtla.ts", () => ({
	genSrtlaIpList: () => wanAddresses,
	genSrtalIpListForLocalIpAddress: () => localAddresses,
	resolveSrtla: (address: string) => preparation.resolveSrtla(address),
	setSrtlaIpList: setAddresses,
	shutdownSrtla: () => setAddresses([]),
	restartSrtla: reload,
}));
mock.module("../modules/streaming/streaming.ts", () => ({
	getIsStreaming: () => active,
	updateStatus: (value: boolean) => {
		const changed = value !== active;
		active = value;
		return changed;
	},
	saveStreamConfig: () => {},
	startError: error,
	validateConfig: (params: ConfigParameters) => ({
		config: {
			...params,
			delay: 0,
			srt_latency: 2000,
			max_br: 5000,
			asrc: "USB audio",
			acodec: "aac",
			pipeline: "test",
		},
		pipeline: { path: "/synthetic/input", asrc: true, acodec: true },
		srtlaAddr: params.srtla_addr ?? "203.0.113.1",
		srtlaPort: 5000,
		streamid: "",
	}),
}));

const { start, stop } = await import("../modules/streaming/streamloop.ts");
const conn = {} as WebSocket;
beforeEach(() => {
	wanAddresses = ["192.0.2.1"];
	publish = async () => {};
	localAddresses = [];
	directories.clear();
	Object.assign(preparation, defaults);
	for (const callback of [spawnLoop, setAddresses, reload, error, updates])
		callback.mockClear();
});
afterEach(stop);

describe("stream startup integration", () => {
	test("no eligible WAN or local path starts no children", async () => {
		wanAddresses = [];
		await start(conn, {});
		expect(spawnLoop).not.toHaveBeenCalled();
		expect(active).toBe(false);
		wanAddresses = ["192.0.2.1"];
		await start(conn, { srtla_addr: "192.168.1.50" });
		expect(spawnLoop).not.toHaveBeenCalled();
		expect(active).toBe(false);
	});
	test("local-subnet selection and handover listener last until Stop", async () => {
		localAddresses = ["192.168.1.10"];
		await start(conn, { srtla_addr: "192.168.1.50" });
		expect(setAddresses).toHaveBeenLastCalledWith(localAddresses);
		expect(spawnLoop).toHaveBeenCalledTimes(2);
		localAddresses = [];
		await listener?.();
		expect(setAddresses).toHaveBeenLastCalledWith([]);
		// The source publisher now owns signalling after a changed file is written.
		expect(reload).not.toHaveBeenCalled();
		expect(active).toBe(true);
		await stop();
		expect(listener).toBeUndefined();
		for (const directory of directories)
			await expect(access(directory)).rejects.toThrow();
	});
	for (const stage of [
		"resolveSrtla",
		"overlay",
		"audio",
		"audioFile",
	] as const) {
		for (const fail of [false, true]) {
			test(`late ${stage} ${fail ? "error" : "success"} cannot affect a newer stream`, async () => {
				let enter!: () => void;
				let resolve!: (value: string) => void;
				let reject!: (error: unknown) => void;
				const entered = new Promise<void>((yes) => {
					enter = yes;
				});
				const gate = new Promise<string>((yes, no) => {
					resolve = yes;
					reject = no;
				});
				const original = preparation[stage];
				let blocked = false;
				Object.assign(preparation, {
					[stage]: (...args: unknown[]) => {
						if (!blocked) {
							blocked = true;
							if (typeof args[1] === "string")
								directories.add(dirname(args[1]));
							enter();
							return gate;
						}
						return Reflect.apply(original, undefined, args);
					},
				});
				const old = start(conn, {});
				await entered;
				await stop();
				await start(conn, {});
				expect(active).toBe(true);
				const currentPipeline = spawnLoop.mock.calls[1]?.[1]()[0];
				if (!currentPipeline) throw new Error("No active pipeline");
				if (fail) reject(new Error("stale failure"));
				else resolve("obsolete result");
				await old;
				expect(active).toBe(true);
				expect(spawnLoop).toHaveBeenCalledTimes(2);
				expect(error).not.toHaveBeenCalled();
				expect(await readFile(currentPipeline, "utf8")).toBe(
					"prepared pipeline",
				);
				for (const directory of directories) {
					if (directory !== dirname(currentPipeline))
						await expect(access(directory)).rejects.toThrow();
				}
				await stop();
				await expect(access(dirname(currentPipeline))).rejects.toThrow();
			});
		}
	}
});

test("Stop tolerates source-file cleanup failure and admits the next start", async () => {
	await start(conn, {});
	publish = async (addresses) => {
		if (!addresses.length) throw new Error("source cleanup failed");
	};
	await stop();
	expect(active).toBe(false);
	publish = async () => {};
	await start(conn, {});
	expect(active).toBe(true);
});
test("Stop during async source publication prevents late spawning", async () => {
	let entered!: () => void;
	let release!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	publish = async (addresses) => {
		if (addresses.length) {
			entered();
			await gate;
		}
	};
	const starting = start(conn, {});
	await ready;
	await stop();
	release();
	await starting;
	expect(spawnLoop).not.toHaveBeenCalled();
	expect(active).toBe(false);
});

test("shutdown detaches discovery and blocks new stream producers before cleanup", async () => {
	const modulePath = "../modules/streaming/streamloop.ts";
	const runtime: typeof import("../modules/streaming/streamloop.ts") =
		await import(`${modulePath}?shutdown-regression`);
	await runtime.start(conn, {});
	expect(listener).toBeDefined();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	publish = async (addresses) => {
		if (!addresses.length) await gate;
	};
	const stopping = runtime.shutdown();
	expect(listener).toBeUndefined();
	const count = spawnLoop.mock.calls.length;
	await runtime.start(conn, {});
	expect(spawnLoop.mock.calls).toHaveLength(count);
	release();
	await stopping;
	expect(active).toBe(false);
});

test("discovery handover during initial publication queues the current source list", async () => {
	let entered!: () => void;
	let release!: () => void;
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let first = true;
	publish = async () => {
		if (first) {
			first = false;
			entered();
			await gate;
		}
	};
	const starting = start(conn, {});
	await writing;
	const subscribed = listener;
	wanAddresses = ["192.0.2.3"];
	await subscribed?.();
	release();
	await starting;
	expect(subscribed).toBeDefined();
	expect(setAddresses).toHaveBeenLastCalledWith(["192.0.2.3"]);
});
