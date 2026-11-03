import { mock } from "bun:test";
import assert from "node:assert/strict";
import type WebSocket from "ws";

mock.module("../../helpers/logger.ts", () => ({
	logger: { error: () => {}, info: () => {} },
}));
mock.module("../../modules/ui/notifications.ts", () => ({
	notificationBroadcast: () => {},
	notificationRemove: () => {},
	notificationSend: () => {},
}));
mock.module("../../modules/ui/websocket-server.ts", () => ({
	broadcastMsg: () => {},
	buildMsg: (_type: string, data: unknown) => JSON.stringify({ netif: data }),
}));
mock.module("../../modules/wifi/wifi-device-list.ts", () => ({
	wifiDeviceListAdd: () => {},
	wifiDeviceListStartUpdate: () => {},
	wifiDeviceListEndUpdate: () => false,
}));
mock.module("../../modules/wifi/wifi-interfaces.ts", () => ({
	wifiUpdateDevices: () => {},
}));

const { getNetworkInterfaces, netIfBuildMsg, handleNetif, NETIF_ERR_DUPIPV4 } =
	await import("../../modules/network/network-interfaces.ts");
const interfaces = getNetworkInterfaces();
const names = ["__proto__", "constructor", "toString", "cell0"];
for (const [index, name] of names.entries()) {
	Object.defineProperty(interfaces, name, {
		value: {
			ip: `192.0.2.${index + 1}`,
			tp: 100,
			txb: 1000,
			enabled: true,
			error: 0,
		},
		enumerable: true,
	});
}

const response = netIfBuildMsg();
const decoded = JSON.parse(JSON.stringify(response));
for (const name of names) {
	assert(Object.hasOwn(response, name), `Missing response entry ${name}`);
	assert(Object.hasOwn(decoded, name), `Missing JSON entry ${name}`);
	assert.deepEqual(decoded[name], {
		ip: interfaces[name]?.ip,
		tp: 100,
		enabled: true,
	});
}
assert.equal(Object.getPrototypeOf(response), null);

const replies: Array<{ netif: ReturnType<typeof netIfBuildMsg> }> = [];
const conn = {
	send: (payload: string) => replies.push(JSON.parse(payload)),
} as unknown as WebSocket;
for (const name of names.slice(0, 3)) {
	const ip = interfaces[name]?.ip;
	assert(ip);
	for (const enabled of [false, true]) {
		handleNetif(conn, { name, ip, enabled });
		const reply = replies.at(-1);
		assert(reply);
		assert(Object.hasOwn(reply.netif, name));
		assert.equal(reply.netif[name]?.enabled, enabled);
		assert.equal(interfaces[name]?.enabled, enabled);
	}
}
assert.equal(replies.length, 6);
const ordinary = interfaces.cell0;
assert(ordinary);
ordinary.error = NETIF_ERR_DUPIPV4;
ordinary.enabled = false;
const errorResponse = JSON.parse(JSON.stringify(netIfBuildMsg()));
assert.equal(errorResponse.cell0.error, "duplicate IPv4 addr");
assert.equal(errorResponse.cell0.enabled, false);
console.log("network response and toggle checks passed");
