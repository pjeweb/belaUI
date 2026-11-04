export type ModemIpFamily = "ipv4" | "ipv4v6" | "ipv6";
export function isModemIpFamily(value: unknown): value is ModemIpFamily {
	return value === "ipv4" || value === "ipv4v6" || value === "ipv6";
}
export function modemIpFields(family: ModemIpFamily = "ipv4") {
	return {
		"ipv4.method": family === "ipv6" ? "disabled" : "auto",
		"ipv6.method": family === "ipv4" ? "ignore" : "auto",
		"ipv4.may-fail": "yes",
		"ipv6.may-fail": "yes",
	} as const;
}
export function modemIpFamily(ipv4: string, ipv6: string): ModemIpFamily {
	return ipv6 === "auto" ? (ipv4 === "disabled" ? "ipv6" : "ipv4v6") : "ipv4";
}
