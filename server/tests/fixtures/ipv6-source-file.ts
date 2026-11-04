import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "uplink-test-"));
const file = join(directory, "sources");
mock.module("../../modules/setup.ts", () => ({ setup: { ips_file: file } }));
mock.module("../../modules/network/ipv6-routing.ts", () => ({
	updateIpv6Routing: (sources: Array<{ address: string }>) =>
		new Set(sources.map((s) => s.address)),
}));
mock.module("../../modules/network/dns.ts", () => ({
	dnsCacheResolve: async (address: string) => ({
		addrs: [address],
		fromCache: false,
	}),
	dnsCacheValidate: () => {},
}));
mock.module("../../modules/network/gateways.ts", () => ({
	queueUpdateGw: () => {},
}));
mock.module("../../modules/streaming/processes.ts", () => ({
	srtlaSendExec: "sender",
	streamingProcesses: { signal() {} },
}));
const interfaces = {
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
	setSrtlaIpList(genSrtlaIpList(ipv4));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n");
	const ipv6 = await resolveSrtla("[2001:db8::1]");
	assert.equal(ipv6, "2001:db8::1");
	setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n2001:db8::3\n");
	interfaces.v6.enabled = false;
	setSrtlaIpList(genSrtlaIpList(ipv6));
	assert.equal(readFileSync(file, "utf8"), "192.0.2.2\n");
	setSrtlaIpList([]);
	assert.equal(readFileSync(file, "utf8"), "");
} finally {
	setSrtlaIpList([]);
	rmSync(directory, { recursive: true });
}
console.log("source file checks passed");
