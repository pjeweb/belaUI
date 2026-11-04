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
const networks: Record<
	string,
	{ ip?: string; ipv6?: string; enabled: boolean; error: number }
> = {
	wan: { ipv6: "2001:db8::2", enabled: false, error: 0 },
	hotspot: { ip: "192.0.2.3", enabled: false, error: 2 },
	duplicate: { ip: "192.0.2.4", enabled: false, error: 1 },
};
mock.module("../../modules/network/network-interfaces.ts", () => ({
	getNetworkInterfaces: () => networks,
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
if (process.argv.includes("--ipv6-only")) {
	addresses = ["192.0.2.1", "2001:db8::1"];
	await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
	assert.equal(sockets[0]?.url.hostname, "[2001:db8::1]");
	assert(networks.wan);
	networks.wan.ip = "192.0.2.2";
	await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
	assert.equal(sockets[1]?.url.hostname, "192.0.2.1");
	networks.wan.ip = undefined;
	addresses = ["2001:db8::1"];
	await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
	assert.equal(sockets[2]?.url.hostname, "[2001:db8::1]");
	console.log("remote family checks passed");
} else {
	await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
	assert.equal(sockets[0]?.url.hostname, "[2001:db8::1]");
	sockets[0]?.emit("open");
	assert.equal(validations, 0);
	addresses = ["192.0.2.1", "2001:db8::1"];
	fresh = true;
	assert(networks.wan);
	networks.wan.ip = "192.0.2.2";
	await remoteConnect((url) => new FakeSocket(url) as unknown as WebSocket);
	assert.equal(sockets[1]?.url.hostname, "192.0.2.1");
	sockets[1]?.emit("open");
	assert.equal(validations, 1);
	console.log("remote cache checks passed");
}
