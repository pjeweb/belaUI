import { isIP } from "node:net";

export function ipToInt(ip: string) {
	return (
		ip
			.split(".")
			.reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0
	);
}

export function isSameSubnet(ip1: string, ip2: string, netmask: string) {
	if (isIP(normalizeIp(ip1)) === 6 || isIP(normalizeIp(ip2)) === 6) {
		const a = ipv6ToBigInt(ip1);
		const b = ipv6ToBigInt(ip2);
		const prefix = Number(netmask);
		if (
			a === undefined ||
			b === undefined ||
			!Number.isInteger(prefix) ||
			prefix < 0 ||
			prefix > 128
		)
			return false;
		return a >> BigInt(128 - prefix) === b >> BigInt(128 - prefix);
	}
	const ip1Int = ipToInt(ip1);
	const ip2Int = ipToInt(ip2);
	const netmaskInt = ipToInt(netmask);

	return (ip1Int & netmaskInt) === (ip2Int & netmaskInt);
}

const localIpPatterns = [
	/^127\./, // Loopback addresses
	/^10\./, // Class A private addresses
	/^192\.168\./, // Class C private addresses
	/^172\.(1[6-9]|2\d|3[0-1])\./, // Class B private addresses (172.16.0.0 - 172.31.255.255)
	/^169\.254\./, // Link-local addresses
];

export function isLocalIp(ip: string) {
	const value = ipv6ToBigInt(ip);
	if (value !== undefined)
		return value === 1n || value >> 121n === 126n || value >> 118n === 1018n;
	return localIpPatterns.some((pattern) => pattern.test(ip));
}

export function normalizeIp(address: string) {
	return address.startsWith("[") && address.endsWith("]")
		? address.slice(1, -1)
		: address;
}
export function bracketHost(address: string) {
	const host = normalizeIp(address);
	return isIP(host) === 6 ? `[${host}]` : host;
}
export function ipv6ToBigInt(address: string): bigint | undefined {
	let ip = normalizeIp(address);
	if (isIP(ip) !== 6 || ip.includes("%")) return undefined;
	if (ip.includes(".")) {
		const split = ip.lastIndexOf(":");
		const v4 = ipToInt(ip.slice(split + 1));
		ip = `${ip.slice(0, split)}:${(v4 >>> 16).toString(16)}:${(v4 & 65535).toString(16)}`;
	}
	const [left, right] = ip.split("::");
	const a = left ? left.split(":") : [];
	const b = right ? right.split(":") : [];
	const words =
		right !== undefined
			? [...a, ...Array(8 - a.length - b.length).fill("0"), ...b]
			: a;
	return words.reduce(
		(value, word) => (value << 16n) + BigInt(`0x${word}`),
		0n,
	);
}
