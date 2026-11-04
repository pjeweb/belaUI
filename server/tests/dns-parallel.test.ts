import { expect, test } from "bun:test";
import type { Resolver } from "node:dns";
import { dnsCacheResolve, resolveP } from "../modules/network/dns.ts";

type Callback = (
	err: NodeJS.ErrnoException | null,
	addresses: string[],
) => void;
function resolver() {
	const callbacks: Partial<Record<"a" | "aaaa", Callback>> = {};
	let cancelled = false;
	return {
		callbacks,
		get cancelled() {
			return cancelled;
		},
		resolver: {
			resolve4: (_name: string, callback: Callback) => {
				callbacks.a = callback;
			},
			resolve6: (_name: string, callback: Callback) => {
				callbacks.aaaa = callback;
			},
			cancel: () => {
				cancelled = true;
			},
		} as unknown as Resolver,
	};
}
for (const first of ["a", "aaaa"] as const)
	test(`parallel DNS waits when ${first} finishes first`, async () => {
		const fake = resolver();
		let finished = false;
		const result = resolveP("", undefined, fake.resolver, 50).then((r) => {
			finished = true;
			return r;
		});
		fake.callbacks[first]?.(null, [
			first === "a" ? "192.0.2.1" : "2001:db8::1",
		]);
		await Promise.resolve();
		expect(finished).toBe(false);
		const second = first === "a" ? "aaaa" : "a";
		fake.callbacks[second]?.(null, [
			second === "a" ? "192.0.2.1" : "2001:db8::1",
		]);
		expect(await result).toEqual(["192.0.2.1", "2001:db8::1"]);
	});
for (const failing of ["a", "aaaa"] as const)
	test(`parallel DNS tolerates failed ${failing}`, async () => {
		const fake = resolver();
		const result = resolveP("", undefined, fake.resolver, 50);
		fake.callbacks[failing]?.(new Error("missing"), []);
		fake.callbacks[failing === "a" ? "aaaa" : "a"]?.(null, [
			failing === "a" ? "2001:db8::1" : "192.0.2.1",
		]);
		expect(await result).toEqual([
			failing === "a" ? "2001:db8::1" : "192.0.2.1",
		]);
	});
test("both DNS failures reject", async () => {
	const fake = resolver();
	const result = resolveP("", undefined, fake.resolver, 50);
	fake.callbacks.a?.(new Error("missing"), []);
	fake.callbacks.aaaa?.(new Error("missing"), []);
	await expect(result).rejects.toThrow();
});
test("DNS deadline retains success from one family and cancels remaining query", async () => {
	const fake = resolver();
	const result = resolveP("", undefined, fake.resolver, 5);
	fake.callbacks.aaaa?.(null, ["2001:db8::1"]);
	expect(await result).toEqual(["2001:db8::1"]);
	expect(fake.cancelled).toBe(true);
});
test("DNS deadline without answers rejects", async () => {
	const fake = resolver();
	await expect(resolveP("", undefined, fake.resolver, 5)).rejects.toThrow();
	expect(fake.cancelled).toBe(true);
});
test("IPv4 and bracketed or bare IPv6 literals bypass DNS", async () => {
	for (const literal of ["192.0.2.1", "2001:db8::1", "[2001:db8::1]"]) {
		expect(await dnsCacheResolve(literal)).toEqual({
			addrs: [literal.replace(/[\[\]]/g, "")],
			fromCache: false,
		});
	}
	await expect(dnsCacheResolve("[2001:db8::1]", "a")).rejects.toThrow();
});
