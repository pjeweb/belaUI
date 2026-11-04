import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { URL } from "node:url";
import type WebSocket from "ws";
let addresses = ["2001:db8::1"];
let fresh = false;
let validations = 0;
const sockets: FakeSocket[] = [];
class FakeSocket extends EventEmitter {
	constructor(readonly url: URL) {
		super();
		sockets.push(this);
	}
	send() {}
	terminate() {}
}
mock.module("../../helpers/logger.ts", () => ({
	logger: { warn() {}, error() {}, debug() {}, info() {} },
}));
mock.module("../../modules/config.ts", () => ({
	getConfig: () => config,
	saveConfig() {},
}));
const config = {
	remote_key: "synthetic",
	relay_server: undefined,
	relay_account: undefined,
};
mock.module("../../modules/setup.ts", () => ({
	setup: { remote_endpoint_host: "receiver.invalid" },
}));
mock.module("../../modules/network/dns.ts", () => ({
	dnsCacheResolve: async () => ({ addrs: addresses, fromCache: true, fresh }),
	dnsCacheValidate() {
		validations++;
	},
}));
mock.module("../../modules/network/gateways.ts", () => ({
	queueUpdateGw() {},
}));
mock.module("../../modules/network/network-interfaces.ts", () => ({
	getNetworkInterfaces: () => ({
		wan: { ipv6: "2001:db8::2", enabled: false, error: 0 },
	}),
}));
mock.module("../../modules/ui/auth.ts", () => ({ addAuthedSocket() {} }));
mock.module("../../modules/ui/status.ts", () => ({ sendInitialStatus() {} }));
mock.module("../../modules/ui/websocket-server.ts", () => ({
	broadcastMsg() {},
	broadcastMsgLocal() {},
	deleteSocketSenderId() {},
	getLastActive() {
		return 0;
	},
	markConnectionActive() {},
	setSocketSenderId() {},
	handleMessage() {},
}));
mock.module("../../modules/remote/remote-relays.ts", () => ({
	buildRelaysMsg() {},
	handleRemoteRelays() {},
	updateCachedRelays: async () => false,
}));
const { remoteConnect } = await import("../../modules/remote/remote.ts");
await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
assert.equal(sockets[0]?.url.hostname, "[2001:db8::1]");
sockets[0]?.emit("open");
assert.equal(validations, 0);
addresses = ["192.0.2.1", "2001:db8::1"];
fresh = true;
await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
assert.equal(sockets[1]?.url.hostname, "192.0.2.1");
sockets[1]?.emit("open");
assert.equal(validations, 1);
console.log("remote cache checks passed");
