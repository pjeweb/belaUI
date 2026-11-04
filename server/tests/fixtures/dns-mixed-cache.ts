import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { Resolver } from "node:dns";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const previous = process.cwd();
const directory = mkdtempSync(join(tmpdir(), "dns-cache-test-"));
let validationAddress = "";
mock.module("../../helpers/logger.ts", () => ({
	logger: { warn() {}, error() {}, debug() {}, info() {} },
}));
class FakeResolver {
	private validated = false;
	resolve4(
		_name: string,
		callback: (error: Error | null, addresses: string[]) => void,
	) {
		if (!this.validated) {
			this.validated = true;
			callback(null, [validationAddress]);
		} else callback(null, ["192.0.2.1"]);
	}
	resolve6(
		_name: string,
		callback: (error: Error | null, addresses: string[]) => void,
	) {
		callback(new Error("missing AAAA"), []);
	}
	cancel() {}
}
try {
	process.chdir(directory);
	writeFileSync(
		"dns_cache.json",
		JSON.stringify({
			"aaaa:receiver.invalid": { ts: 0, results: ["2001:db8::1"] },
		}),
	);
	const { dnsCacheResolve, dnsCacheValidate, DNS_WELLKNOWN_ADDR } =
		await import("../../modules/network/dns.ts");
	validationAddress = DNS_WELLKNOWN_ADDR;
	const result = await dnsCacheResolve(
		"receiver.invalid",
		undefined,
		() => new FakeResolver() as unknown as Resolver,
	);
	assert.equal(result.fromCache, true);
	assert.equal(result.fresh, true);
	await dnsCacheValidate("receiver.invalid");
	const cache = JSON.parse(readFileSync("dns_cache.json", "utf8"));
	assert.deepEqual(cache["a:receiver.invalid"].results, ["192.0.2.1"]);
	assert.deepEqual(cache["aaaa:receiver.invalid"].results, ["2001:db8::1"]);
} finally {
	process.chdir(previous);
	rmSync(directory, { recursive: true });
}
console.log("mixed DNS cache checks passed");
