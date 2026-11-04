import { mock } from "bun:test";
import assert from "node:assert/strict";
let resolve: ((address: string) => Promise<{ addrs: string[] }>) | undefined;
mock.module("../../helpers/logger.ts", () => ({
	logger: { warn() {}, error() {}, debug() {}, info() {} },
}));
mock.module("../../modules/network/bcrpt-client.ts", () => ({
	BcrptMonitor: class {
		constructor(options: { resolve: typeof resolve }) {
			resolve = options.resolve;
		}
	},
}));
mock.module("../../modules/remote/remote-relays.ts", () => ({
	getRelays() {},
	onRelaysChange() {},
	updateRelayRtts() {},
}));
mock.module("../../modules/setup.ts", () => ({ setup: {} }));
mock.module("../../modules/streaming/streaming.ts", () => ({
	getIsStreaming() {
		return false;
	},
	onStreamingStatusChange() {},
}));
mock.module("../../modules/network/network-interfaces.ts", () => ({
	getNetworkInterfaces() {
		return {};
	},
	onNetworkInterfacesChange() {},
}));
await import("../../modules/network/bcrpt.ts");
assert(resolve);
assert.deepEqual((await resolve("2001:db8::1")).addrs, ["2001:db8::1"]);
assert.deepEqual((await resolve("192.0.2.1")).addrs, ["192.0.2.1"]);
console.log("probe literal checks passed");
