import { mock } from "bun:test";
import assert from "node:assert/strict";
mock.module("../../helpers/logger.ts", () => ({
	logger: { debug() {}, info() {}, warn() {}, error() {} },
}));
const { sanitizeModemConfigForNetworkManager } = await import(
	"../../modules/modems/modem-update-loop.ts"
);
const { modemIpFields } = await import("../../modules/modems/ip-family.ts");
for (const family of [undefined, "ipv4", "ipv4v6", "ipv6"] as const) {
	const result = sanitizeModemConfigForNetworkManager({
		ip_family: family,
		autoconfig: false,
		apn: "",
		username: "",
		password: "",
		roaming: true,
		network: "",
	});
	for (const [key, value] of Object.entries(modemIpFields(family)))
		assert.equal(result[key as keyof typeof result], value);
	assert.equal(result["gsm.home-only"], "no");
}
console.log("modem profile checks passed");
