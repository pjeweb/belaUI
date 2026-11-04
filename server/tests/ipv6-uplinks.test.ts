import { expect, test } from "bun:test";
import {
	bracketHost,
	isLocalIp,
	isSameSubnet,
	normalizeIp,
} from "../helpers/ip-addresses.ts";
import { modemIpFamily, modemIpFields } from "../modules/modems/ip-family.ts";
import {
	buildProbeTargets,
	parseProbeStats,
} from "../modules/network/bcrpt-client.ts";
import { selectSrtlaAddresses } from "../modules/network/interface-addresses.ts";
import {
	type IpInterface,
	interfaceAddresses,
	prefixNetmask,
	selectIpv6,
} from "../modules/network/interface-discovery.ts";
import {
	IPV6_ROUTING_BASE,
	planIpv6Routing,
} from "../modules/network/ipv6-routing-plan.ts";

const v6 = "2001:db8::2";
const source = { address: v6, device: "wan0", gateway: "2001:db8::1" };
const network = { enabled: true, error: 0, ipv6: v6 };
test("one source per interface, IPv4 first, AAAA required for IPv6 fallback", () => {
	expect(
		selectSrtlaAddresses(
			{ wan: { ...network, ip: "192.0.2.2" } },
			undefined,
			true,
		),
	).toEqual(["192.0.2.2"]);
	expect(selectSrtlaAddresses({ wan: network })).toEqual([]);
	expect(selectSrtlaAddresses({ wan: network }, undefined, true)).toEqual([v6]);
	expect(
		selectSrtlaAddresses(
			{ wan: { ...network, enabled: false } },
			undefined,
			true,
		),
	).toEqual([]);
	expect(
		selectSrtlaAddresses({ wan: { ...network, error: 2 } }, undefined, true),
	).toEqual([]);
});
test("structured addresses reject unusable IPv6 and prefer stable addresses", () => {
	const info: IpInterface = {
		ifname: "wan0",
		flags: ["LOWER_UP"],
		addr_info: [
			{ family: "inet", local: "192.0.2.2", prefixlen: 24, scope: "global" },
			...["tentative", "deprecated", "dadfailed", "temporary", "stable"].map(
				(flag, index) => ({
					family: "inet6" as const,
					local: `2001:db8::${index + 1}`,
					prefixlen: 64,
					scope: "global",
					flags: [flag],
				}),
			),
		],
	};
	const addresses = interfaceAddresses(info);
	expect(addresses[0]?.prefixLength).toBe(24);
	expect(selectIpv6(addresses)).toBe("2001:db8::5");
	expect(selectIpv6(addresses.slice(0, 4))).toBeUndefined();
	expect(
		selectIpv6(
			addresses.filter((a) => !a.temporary && a.address !== "2001:db8::5"),
		),
	).toBeUndefined();
	expect(
		selectIpv6(addresses.map((a) => ({ ...a, scope: "link" }))),
	).toBeUndefined();
	expect(prefixNetmask(0)).toBe("0.0.0.0");
	expect(prefixNetmask(24)).toBe("255.255.255.0");
});
test("IPv6 prefix matching and literals", () => {
	expect(isSameSubnet(v6, "2001:db8::3", "64")).toBe(true);
	expect(isSameSubnet(v6, "2001:db8:1::3", "64")).toBe(false);
	expect(isSameSubnet(v6, "192.0.2.2", "64")).toBe(false);
	expect(isSameSubnet(v6, v6, "129")).toBe(false);
	expect(isLocalIp(v6)).toBe(false);
	// Exercise local prefix classification without non-documentation literals.
	expect(isLocalIp(`${(0xfc00).toString(16)}::1`)).toBe(true);
	expect(isLocalIp(`${(0xfe80).toString(16)}::1`)).toBe(true);
	expect(normalizeIp(`[${v6}]`)).toBe(v6);
	expect(bracketHost(v6)).toBe(`[${v6}]`);
	expect(bracketHost("192.0.2.2")).toBe("192.0.2.2");
});
test("IPv6 routing add, idempotence, change and removal", () => {
	const added = planIpv6Routing([], [source]);
	expect(added.commands).toEqual([
		[
			"-6",
			"route",
			"replace",
			"default",
			"via",
			source.gateway,
			"dev",
			"wan0",
			"table",
			String(IPV6_ROUTING_BASE),
		],
		[
			"-6",
			"rule",
			"add",
			"from",
			`${v6}/128`,
			"lookup",
			String(IPV6_ROUTING_BASE),
			"priority",
			String(IPV6_ROUTING_BASE),
		],
	]);
	expect(planIpv6Routing(added.routes, [source]).commands).toEqual([]);
	const changed = planIpv6Routing(added.routes, [
		{ ...source, address: "2001:db8::3" },
	]);
	expect(changed.commands).toHaveLength(4);
	expect(changed.commands[0]?.at(-1)).not.toBe(String(IPV6_ROUTING_BASE));
	expect(planIpv6Routing(changed.routes, []).commands).toHaveLength(2);
	expect(planIpv6Routing([], []).commands).toEqual([]);
	expect(
		planIpv6Routing(added.routes, [{ ...source, gateway: "2001:db8::4" }])
			.commands,
	).toHaveLength(4);
	expect(
		planIpv6Routing([], [{ ...source, gateway: undefined }]).commands[0],
	).not.toContain("via");
	expect(() =>
		planIpv6Routing([], [{ ...source, address: "192.0.2.2" }]),
	).toThrow();
});
test("modem family default and explicit profiles round-trip", () => {
	expect(modemIpFields()).toEqual(modemIpFields("ipv4"));
	for (const family of ["ipv4", "ipv4v6", "ipv6"] as const) {
		const fields = modemIpFields(family);
		expect(modemIpFamily(fields["ipv4.method"], fields["ipv6.method"])).toBe(
			family,
		);
		expect(fields["ipv4.may-fail"]).toBe("yes");
		expect(fields["ipv6.may-fail"]).toBe("yes");
	}
	expect(modemIpFields()["ipv6.method"]).toBe("ignore");
	expect(modemIpFields("ipv6")["ipv4.method"]).toBe("disabled");
});
test("probe brackets IPv6 destinations and accounts for its larger header", async () => {
	const result = await buildProbeTargets(
		{
			interfaces: { wan: { ip: "192.0.2.2" } },
			streaming: false,
			relays: { servers: { relay: { addr: v6, bcrp_port: 9000 } } },
		},
		async () => ({ addrs: [v6], fromCache: false }),
		() => {},
	);
	expect(result.servers).toBe(`[${v6}]:9000\n`);
	expect(parseProbeStats({ mtu: { [v6]: 1355 } }, {}).lowMtu).toBe(true);
	expect(parseProbeStats({ mtu: { [v6]: 1356 } }, {}).lowMtu).toBe(false);
	expect(parseProbeStats({ mtu: { "192.0.2.2": 1336 } }, {}).lowMtu).toBe(
		false,
	);
});
