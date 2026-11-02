import { expect, test } from "bun:test";
import {
	NETIF_ERR_DUPIPV4,
	NETIF_ERR_HOTSPOT,
	selectSrtlaAddresses,
} from "../modules/network/interface-addresses.ts";

const interfaces = {
	wan: {
		ip: "198.51.100.2",
		netmask: "255.255.255.0",
		enabled: true,
		error: 0,
	},
	lan: {
		ip: "192.168.1.1",
		netmask: "255.255.255.0",
		enabled: false,
		error: 0,
	},
	hotspot: {
		ip: "192.168.10.1",
		netmask: "255.255.255.0",
		enabled: false,
		error: NETIF_ERR_HOTSPOT,
	},
	duplicate: {
		ip: "192.168.1.2",
		netmask: "255.255.255.0",
		enabled: false,
		error: NETIF_ERR_DUPIPV4,
	},
};
test("WAN selection excludes disabled, duplicate and hotspot paths", () => {
	expect(selectSrtlaAddresses(interfaces)).toEqual(["198.51.100.2"]);
});
test("local receiver uses its subnet even when WAN bonding is disabled", () => {
	expect(selectSrtlaAddresses(interfaces, "192.168.1.100")).toEqual([
		"192.168.1.1",
	]);
});
test("receiver on the encoder hotspot retains a usable local path", () => {
	expect(selectSrtlaAddresses(interfaces, "192.168.10.100")).toEqual([
		"192.168.10.1",
	]);
});
test("no matching path is empty and handover state can later recover", () => {
	expect(selectSrtlaAddresses({}, "192.168.1.100")).toEqual([]);
	expect(selectSrtlaAddresses(interfaces, "192.168.1.100")).toEqual([
		"192.168.1.1",
	]);
});
