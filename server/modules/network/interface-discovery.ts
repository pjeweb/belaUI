import { isUla } from "../../helpers/ip-addresses.ts";

export type InterfaceAddress = {
	family: "inet" | "inet6";
	address: string;
	prefixLength: number;
	scope: string;
	tentative: boolean;
	deprecated: boolean;
	temporary: boolean;
	dadfailed: boolean;
};
export type IpInterface = {
	ifname: string;
	flags: string[];
	address?: string;
	addr_info: Array<{
		family: "inet" | "inet6";
		local: string;
		prefixlen: number;
		scope: string;
		flags?: string[];
		tentative?: boolean;
		deprecated?: boolean;
		temporary?: boolean;
		dadfailed?: boolean;
		preferred_life_time?: number;
	}>;
	stats64?: { tx: { bytes: number } };
};
export function interfaceAddresses(info: IpInterface): InterfaceAddress[] {
	return info.addr_info.map((a) => ({
		family: a.family,
		address: a.local,
		prefixLength: a.prefixlen,
		scope: a.scope,
		tentative: !!a.tentative || !!a.flags?.includes("tentative"),
		deprecated:
			!!a.deprecated ||
			a.preferred_life_time === 0 ||
			!!a.flags?.includes("deprecated"),
		temporary: !!a.temporary || !!a.flags?.includes("temporary"),
		dadfailed: !!a.dadfailed || !!a.flags?.includes("dadfailed"),
	}));
}
export function selectIpv6(addresses: InterfaceAddress[]) {
	return addresses
		.filter(
			(a) =>
				a.family === "inet6" &&
				a.scope === "global" &&
				!a.tentative &&
				!a.deprecated &&
				!a.dadfailed,
		)
		.sort(
			(a, b) =>
				Number(isUla(a.address)) - Number(isUla(b.address)) ||
				Number(a.temporary) - Number(b.temporary),
		)[0]?.address;
}
export function prefixNetmask(prefix: number) {
	if (prefix === 0) return "0.0.0.0";
	return [24, 16, 8, 0]
		.map((shift) => ((0xffffffff << (32 - prefix)) >>> shift) & 255)
		.join(".");
}
