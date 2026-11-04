import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "uplink-test-"));
const file = join(directory, "sources");
let failRouting = false;
let signals = 0;
const random = Math.random;
Math.random = () => 0;
mock.module("../../helpers/logger.ts", () => ({
	logger: { error() {}, warn() {}, debug() {}, info() {} },
}));
mock.module("../../modules/setup.ts", () => ({ setup: { ips_file: file } }));
mock.module("../../modules/network/ipv6-routing.ts", () => ({
	updateIpv6Routing: async (sources: Array<{ address: string }>) => {
		if (failRouting) throw new Error("route query failed");
		return new Set(sources.map((s) => s.address));
	},
}));
let cached = false;
mock.module("../../modules/network/dns.ts", () => ({
	dnsCacheResolve: async (address: string) => ({
		addrs: cached ? ["2001:db8::1", "192.0.2.1"] : [address],
		fromCache: cached,
	}),
	dnsCacheValidate: () => {},
}));
mock.module("../../modules/network/gateways.ts", () => ({
	queueUpdateGw: () => {},
}));
mock.module("../../modules/streaming/processes.ts", () => ({
	srtlaSendExec: "sender",
	streamingProcesses: {
		signal() {
			signals++;
		},
	},
}));
const interfaces: Record<
	string,
	{ ip?: string; ipv6: string; enabled: boolean; error: number }
> = {
	dual: { ip: "192.0.2.2", ipv6: "2001:db8::2", enabled: true, error: 0 },
	v6: { ipv6: "2001:db8::3", enabled: true, error: 0 },
};
mock.module("../../modules/network/network-interfaces.ts", () => ({
	getNetworkInterfaces: () => interfaces,
}));
const { resolveSrtla, genSrtlaIpList, setSrtlaIpList } = await import(
	"../../modules/streaming/srtla.ts"
);
try {
	const ipv4 = await resolveSrtla("192.0.2.1");
	await setSrtlaIpList(genSrtlaIpList(ipv4));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n");
	const ipv6 = await resolveSrtla("[2001:db8::1]");
	assert.equal(ipv6, "2001:db8::1");
	await setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n2001:db8::3\n");
	const before = signals;
	await setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(signals, before);
	failRouting = true;
	await setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n");
	assert.equal(signals, before + 1);
	failRouting = false;
	assert(interfaces.v6);
	interfaces.v6.enabled = false;
	await setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n");
	cached = true;
	assert.equal(await resolveSrtla("receiver.invalid"), "192.0.2.1");
	assert(interfaces.dual);
	interfaces.dual.ip = undefined;
	assert.equal(await resolveSrtla("receiver.invalid"), "2001:db8::1");
	await setSrtlaIpList([]);
	assert.equal(readFileSync(file, "utf8"), "");
} finally {
	Math.random = random;
	await setSrtlaIpList([]);
	rmSync(directory, { recursive: true });
}
console.log("source file checks passed");
