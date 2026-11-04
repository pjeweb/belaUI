import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { GsmConnections } from "../../modules/modems/gsm-connections.ts";
import type { ModemInfo, SimInfo } from "../../modules/modems/mmcli.ts";
const connections: GsmConnections = {
	byDevice: {},
	byOperator: {},
	byUuid: {},
};
mock.module("../../helpers/logger.ts", () => ({
	logger: { debug() {}, warn() {}, error() {}, info() {} },
}));
mock.module("../../modules/modems/gsm-connections.ts", () => ({
	getGsmConnections: async () => connections,
	resetGsmConnections() {},
}));
const { modemGetConfig } = await import(
	"../../modules/modems/modem-update-loop.ts"
);
for (const family of [undefined, "ipv4", "ipv4v6", "ipv6"] as const) {
	connections.byOperator.synthetic = {
		state: "",
		uuid: "",
		deviceId: "",
		simId: "",
		operatorId: "synthetic",
		apn: "",
		username: "",
		password: "",
		roaming: true,
		network: "",
		ip_family: family,
	};
	const config = await modemGetConfig(
		{ "modem.generic.device-identifier": "synthetic" } as ModemInfo,
		{
			"sim.properties.iccid": "synthetic",
			"sim.properties.operator-code": "synthetic",
		} as SimInfo,
	);
	assert.equal(config?.ip_family, family ?? "ipv4");
	assert.equal(config?.conn, undefined);
}
console.log("operator profile checks passed");
