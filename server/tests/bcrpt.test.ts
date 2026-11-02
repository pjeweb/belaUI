import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	BcrptMonitor,
	type ProbeIO,
	type ProbeState,
	buildProbeTargets,
	parseProbeStats,
} from "../modules/network/bcrpt-client.ts";
import { validateRemoteRelays } from "../modules/remote/relay-validation.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (condition()) return;
		await sleep(2);
	}
	throw new Error("Timed out");
}
const relay = {
	type: "srtla",
	name: "Test relay",
	addr: "relay.invalid",
	port: 5000,
	bcrp_port: 6000,
};
const resolve = async () => ({
	addrs: ["198.51.100.1", "198.51.100.2"],
	fromCache: false,
});
const base: ProbeState = {
	interfaces: {
		wan: { ip: "192.0.2.1", error: 0 },
		hotspot: { ip: "192.168.1.1", error: 2 },
		duplicate: { ip: "192.0.2.2", error: 1 },
	},
	relays: { servers: { one: relay }, bcrp_key: "synthetic-probe-key" },
	streaming: false,
};

class Child extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	signals: string[] = [];
	kill(signal: NodeJS.Signals) {
		this.signals.push(signal);
		return true;
	}
}
function fixture(
	ioOverrides: Partial<ProbeIO> = {},
	state: () => ProbeState = () => base,
) {
	const files = new Map<string, string>();
	const children: Child[] = [];
	const updates: Record<string, number>[] = [];
	const logs: string[] = [];
	const io: ProbeIO = {
		mkdir: async () => {},
		write: async (file, contents) => {
			files.set(file, contents);
		},
		spawn: () => {
			const child = new Child();
			children.push(child);
			return child;
		},
		...ioOverrides,
	};
	const monitor = new BcrptMonitor(
		{
			command: "test-bcrpt",
			directory: "/test/probe",
			state,
			resolve,
			validateDns: () => {},
			rttUpdated: (rtts) => {
				updates.push(rtts);
			},
			log: (message) => {
				logs.push(message);
			},
		},
		io,
		5,
	);
	return { monitor, files, children, updates, logs };
}

describe("BCRPT configuration and statistics", () => {
	test("retains probe metadata while rejecting invalid ports and keys", () => {
		const valid = validateRemoteRelays({
			servers: { one: relay },
			accounts: {},
			bcrp_key: "synthetic-probe-key",
		});
		expect(valid?.servers.one?.bcrp_port).toBe(6000);
		expect(valid?.bcrp_key).toBe("synthetic-probe-key");
		expect(
			validateRemoteRelays({
				servers: { one: { ...relay, bcrp_port: 65536 } },
				accounts: {},
			}),
		).toBeUndefined();
		expect(
			validateRemoteRelays({
				servers: { one: relay },
				accounts: {},
				bcrp_key: 123,
			}),
		).toBeUndefined();
	});
	test("filters source errors, resolves all probe targets, validates fresh DNS", async () => {
		const validated: string[] = [];
		const targets = await buildProbeTargets(base, resolve, async (address) => {
			validated.push(address);
		});
		expect(targets.sources).toBe("192.0.2.1\n");
		expect(targets.servers).toBe("198.51.100.1:6000\n198.51.100.2:6000\n");
		expect(validated).toEqual(["relay.invalid"]);
	});
	test("cached DNS works without revalidation and streaming removes probe targets", async () => {
		let validations = 0;
		const cached = await buildProbeTargets(
			base,
			async () => ({ addrs: ["198.51.100.1"], fromCache: true }),
			() => {
				validations++;
			},
		);
		expect(cached.servers).toBe("198.51.100.1:6000\n");
		expect(validations).toBe(0);
		const paused = await buildProbeTargets(
			{ ...base, streaming: true },
			async () => {
				throw new Error("must not resolve while streaming");
			},
			() => {},
		);
		expect(paused.servers).toBe("");
		expect(paused.relayIds).toEqual({});
	});
	test("aggregates max_min RTT by relay and uses the exact low-MTU threshold", () => {
		const ids = { a: "one", b: "one" };
		expect(
			parseProbeStats(
				{
					rtt: {
						a: { max_min: 20 },
						b: { max_min: 90 },
						unknown: { max_min: 999 },
					},
					mtu: { a: 1336 },
				},
				ids,
			),
		).toEqual({ rtts: { one: 90 }, lowMtu: false });
		expect(parseProbeStats({ mtu: { a: 1335 } }, ids).lowMtu).toBe(true);
		expect(parseProbeStats({ mtu: { a: 0 } }, ids).lowMtu).toBe(false);
	});
	test("handles split and coalesced JSON, discards invalid schema, and latches low MTU", async () => {
		const f = fixture();
		await f.monitor.start();
		const output = f.children[0]?.stdout;
		output?.emit(
			"data",
			Buffer.from('{"rtt":{"198.51.100.1:6000":{"max_min":'),
		);
		expect(f.updates.length).toBe(0);
		output?.emit(
			"data",
			Buffer.from(
				'40}},"mtu":{"wan":1300}}\nnull\n42\nbad-json\n{"rtt":{},"mtu":{"wan":1500}}\n',
			),
		);
		expect(f.updates).toEqual([{ one: 40 }, {}]);
		expect(f.monitor.getLowMtu()).toBe(true);
		expect(f.logs.filter((log) => log.includes("invalid")).length).toBe(3);
		f.monitor.stop();
	});
	test("refresh at process-launch completion is not lost", async () => {
		let streaming = false;
		let paused: Promise<void> | undefined;
		const f = fixture(
			{
				spawn: () => {
					const child = new Child();
					queueMicrotask(() => {
						streaming = true;
						paused = f.monitor.refresh();
					});
					return child;
				},
			},
			() => ({ ...base, streaming }),
		);
		const monitor = f.monitor;
		await monitor.start();
		await paused;
		expect(f.files.get("/test/probe/server_ips")).toBe("");
		monitor.stop();
	});
	test("slow DNS cannot restore obsolete targets after a streaming change", async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let streaming = false;
		const files = new Map<string, string>();
		const monitor = new BcrptMonitor(
			{
				command: "test",
				directory: "/test",
				state: () => ({ ...base, streaming }),
				resolve: async () => {
					await held;
					return resolve();
				},
				validateDns: () => {},
				rttUpdated: () => {},
				log: () => {},
			},
			{
				mkdir: async () => {},
				write: async (file, value) => {
					files.set(file, value);
				},
				spawn: () => new Child(),
			},
			5,
		);
		const starting = monitor.start();
		await sleep(0);
		streaming = true;
		const refreshing = monitor.refresh();
		release();
		await starting;
		await refreshing;
		expect(files.get("/test/server_ips")).toBe("");
		monitor.stop();
	});
	test("failed file writes retry configuration and process exits restart once", async () => {
		let writes = 0;
		const f = fixture({
			write: async () => {
				if (++writes === 1) throw new Error("read-only filesystem");
			},
		});
		await f.monitor.start();
		await until(() => f.children.length === 1);
		f.children[0]?.emit("error", new Error("probe failure"));
		f.children[0]?.emit("close");
		await until(() => f.children.length === 2);
		f.monitor.stop();
		f.children[1]?.emit("close");
		await sleep(15);
		expect(f.children.length).toBe(2);
	});
});
