import { expect, test } from "bun:test";
import {
	buildProbeTargets,
	parseProbeStats,
} from "../modules/network/bcrpt-client.ts";
import { selectSrtlaAddresses } from "../modules/network/interface-addresses.ts";
import {
	interfaceAddresses,
	selectIpv6,
} from "../modules/network/interface-discovery.ts";
import { StreamLifecycle } from "../modules/streaming/start-lifecycle.ts";
const ula = `${(0xfd00).toString(16)}::2`;
const addresses = interfaceAddresses({
	ifname: "wan0",
	flags: [],
	addr_info: [
		{ family: "inet6", local: ula, prefixlen: 64, scope: "global" },
		{
			family: "inet6",
			local: "2001:db8::2",
			prefixlen: 64,
			scope: "global",
			temporary: true,
		},
	],
});
test("global unicast outranks stable ULA for WAN", () => {
	expect(selectIpv6(addresses)).toBe("2001:db8::2");
});
test("ULA-only uplink is excluded for a WAN receiver", () => {
	expect(
		selectSrtlaAddresses(
			{
				wan: {
					ipv6: ula,
					addresses: addresses.slice(0, 1),
					enabled: true,
					error: 0,
				},
			},
			undefined,
			true,
		),
	).toEqual([]);
});
test("local IPv6 receiver selects its prefix on a dual-stack LAN", () => {
	expect(
		selectSrtlaAddresses(
			{
				lan: {
					ip: "192.0.2.2",
					ipv6: "2001:db8::2",
					addresses,
					enabled: true,
					error: 0,
				},
			},
			`${(0xfd00).toString(16)}::3`,
			true,
		),
	).toEqual([ula]);
});
test("IPv4 probe sources exclude AAAA relay targets", async () => {
	const targets = await buildProbeTargets(
		{
			interfaces: { wan: { ip: "192.0.2.2" } },
			streaming: false,
			relays: { servers: { relay: { addr: "192.0.2.1", bcrp_port: 9000 } } },
		},
		async () => ({ addrs: ["192.0.2.1", "2001:db8::1"], fromCache: false }),
		() => {},
	);
	expect(targets.servers).toBe("192.0.2.1:9000\n");
});
test("MTU endpoint keys retain the IPv4 threshold", () => {
	expect(parseProbeStats({ mtu: { "192.0.2.2:9000": 1340 } }, {}).lowMtu).toBe(
		false,
	);
	expect(
		parseProbeStats({ mtu: { "[2001:db8::2]:9000": 1340 } }, {}).lowMtu,
	).toBe(true);
});
for (const launchFailure of [false, true])
	test(`lifecycle recovers after ${launchFailure ? "launch and cleanup" : "Stop"} failure`, async () => {
		const statuses: boolean[] = [];
		let fail = true;
		let disposed = 0;
		const lifecycle = new StreamLifecycle<string, string, string>({
			isUpdating: () => false,
			status: (a) => {
				statuses.push(a);
			},
			validate: (a) => a,
			prepare: async (a) => a,
			launch: () => {
				if (launchFailure && fail) throw new Error("launch failed");
			},
			stop: async () => {
				if (fail) throw new Error("cleanup failed");
			},
			dispose: async () => {
				disposed++;
			},
			error: () => {},
		});
		if (launchFailure) await lifecycle.start("first").catch(() => {});
		else {
			await lifecycle.start("first");
			await lifecycle.stop().catch(() => {});
		}
		expect(statuses.at(-1)).toBe(false);
		expect(disposed).toBe(1);
		fail = false;
		expect(await lifecycle.start("next")).toBe(true);
		await lifecycle.stop();
	});

test("IPv6 notifications preserve unchanged IPv4 publication without reload", async () => {
	const { interfaceSourceChanged } = await import(
		"../modules/network/interface-state.ts"
	);
	const previous = {
		ip: "192.0.2.2",
		ipv6: "2001:db8::2",
		enabled: true,
		error: 0,
		tp: 0,
		txb: 0,
	};
	expect(
		interfaceSourceChanged(previous, { ...previous, ipv6: "2001:db8::3" }),
	).toBe(true);
	expect(
		interfaceSourceChanged(
			{ ...previous, ip: undefined },
			{ ...previous, ip: undefined, ipv6: "2001:db8::3" },
		),
	).toBe(true);
	expect(interfaceSourceChanged(previous, { ...previous, ip: undefined })).toBe(
		true,
	);
	const { SourcePublisher } = await import(
		"../modules/streaming/source-publisher.ts"
	);
	let writes = 0;
	let signals = 0;
	const publisher = new SourcePublisher({
		route: async () => new Set(),
		write: async () => {
			writes++;
		},
		signal: () => {
			signals++;
		},
		log() {},
	});
	await publisher.update(selectSrtlaAddresses({ wan: previous }));
	await publisher.update(
		selectSrtlaAddresses({ wan: { ...previous, ipv6: "2001:db8::3" } }),
	);
	expect(writes).toBe(1);
	expect(signals).toBe(1);
});
test("cached receivers prefer A unless every selected source needs IPv6", async () => {
	const { cachedReceiverAddress } = await import("../helpers/ip-addresses.ts");
	expect(cachedReceiverAddress(["2001:db8::1", "192.0.2.1"])).toBe("192.0.2.1");
	expect(cachedReceiverAddress(["192.0.2.1", "2001:db8::1"], true)).toBe(
		"2001:db8::1",
	);
	expect(cachedReceiverAddress(["2001:db8::1"])).toBe("2001:db8::1");
});

test("dual-stack uplinks use IPv6 only for an IPv6-only receiver", () => {
	const networks = {
		wan: { ip: "192.0.2.2", ipv6: "2001:db8::2", enabled: true, error: 0 },
	};
	expect(selectSrtlaAddresses(networks, undefined, true, false)).toEqual([
		"2001:db8::2",
	]);
	expect(selectSrtlaAddresses(networks, undefined, true, true)).toEqual([
		"192.0.2.2",
	]);
	expect(selectSrtlaAddresses(networks, undefined, false, true)).toEqual([
		"192.0.2.2",
	]);
});
test("dual-stack IPv6 address and prefix changes notify source selection", async () => {
	const { interfaceSourceChanged } = await import(
		"../modules/network/interface-state.ts"
	);
	const old = {
		ip: "192.0.2.2",
		ipv6: "2001:db8::2",
		addresses,
		enabled: true,
		error: 0,
		tp: 0,
		txb: 0,
	};
	expect(interfaceSourceChanged(old, { ...old, ipv6: "2001:db8::3" })).toBe(
		true,
	);
	expect(
		interfaceSourceChanged(old, {
			...old,
			addresses: addresses.map((a) => ({ ...a, prefixLength: 80 })),
		}),
	).toBe(true);
	expect(
		interfaceSourceChanged(old, {
			...old,
			addresses: addresses.map((a) => ({ ...a, deprecated: true })),
		}),
	).toBe(true);
});

test("cached AAAA remains available without eligible streaming sources", async () => {
	const { cachedReceiverAddress } = await import("../helpers/ip-addresses.ts");
	expect(cachedReceiverAddress(["2001:db8::1"])).toBe("2001:db8::1");
	expect(cachedReceiverAddress(["2001:db8::1", "192.0.2.1"])).toBe("192.0.2.1");
});

test("probe targets validate fresh DNS even when another family is cached", async () => {
	let validated = 0;
	await buildProbeTargets(
		{
			interfaces: { wan: { ip: "192.0.2.2" } },
			streaming: false,
			relays: {
				servers: { relay: { addr: "receiver.invalid", bcrp_port: 9000 } },
			},
		},
		async () => ({
			addrs: ["192.0.2.1", "2001:db8::1"],
			fromCache: true,
			fresh: true,
		}),
		() => {
			validated++;
		},
	);
	expect(validated).toBe(1);
});
