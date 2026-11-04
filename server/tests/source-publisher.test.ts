import { expect, test } from "bun:test";
import { SourcePublisher } from "../modules/streaming/source-publisher.ts";
const v4 = "192.0.2.2";
const v6 = "2001:db8::2";
function fixture(route: (addresses: string[]) => Promise<Set<string>>) {
	const writes: string[] = [];
	let signals = 0;
	const errors: unknown[] = [];
	const publisher = new SourcePublisher({
		route,
		write: async (list) => {
			writes.push(list);
		},
		signal: () => {
			signals++;
		},
		log: (error) => {
			errors.push(error);
		},
	});
	return {
		publisher,
		writes,
		errors,
		get signals() {
			return signals;
		},
	};
}
test("routing errors still publish IPv4 and signal a changed list", async () => {
	let fail = false;
	const f = fixture(async () => {
		if (fail) throw new Error("bad route JSON");
		return new Set([v6]);
	});
	await f.publisher.update([v4, v6]);
	fail = true;
	await f.publisher.update([v4, v6]);
	expect(f.writes).toEqual([`${v4}\n${v6}\n`, `${v4}\n`]);
	expect(f.signals).toBe(2);
	expect(f.errors).toHaveLength(1);
});
test("refresh restores routing without repeated file writes or SIGHUP", async () => {
	let routes = 0;
	const f = fixture(async () => {
		routes++;
		return new Set([v6]);
	});
	await f.publisher.update([v6]);
	await f.publisher.update([v6]);
	expect(routes).toBe(2);
	expect(f.writes).toEqual([`${v6}\n`]);
	expect(f.signals).toBe(1);
});
test("slow routing is asynchronous and coalesces superseded requests", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let inFlight = 0;
	let max = 0;
	const requests: string[][] = [];
	const f = fixture(async (addresses) => {
		requests.push(addresses);
		inFlight++;
		max = Math.max(max, inFlight);
		if (requests.length === 1) await gate;
		inFlight--;
		return new Set([v6]);
	});
	const first = f.publisher.update([v4, v6]);
	f.publisher.update([v6]);
	const last = f.publisher.update([]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(f.writes).toEqual([]);
	release();
	await Promise.all([first, last]);
	expect(requests).toEqual([[v4, v6], []]);
	expect(max).toBe(1);
	expect(f.writes).toEqual([""]);
});
test("partial routing success retains only the confirmed IPv6 sources", async () => {
	const f = fixture(async () => new Set([v6]));
	await f.publisher.update([v4, v6, "2001:db8:1::2"]);
	expect(f.writes).toEqual([`${v4}\n${v6}\n`]);
});

test("a failed in-flight file write cannot discard queued Stop cleanup", async () => {
	let entered!: () => void;
	let fail!: (error: Error) => void;
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((_resolve, reject) => {
		fail = reject;
	});
	const requests: string[][] = [];
	const writes: string[] = [];
	const publisher = new SourcePublisher({
		route: async (addresses) => {
			requests.push(addresses);
			return new Set([v6]);
		},
		write: async (list) => {
			if (list) {
				entered();
				await gate;
			}
			writes.push(list);
		},
		signal() {},
		log() {},
	});
	const starting = publisher.update([v6]);
	await writing;
	const stopping = publisher.update([]);
	fail(new Error("write failed"));
	await Promise.all([starting, stopping]);
	expect(requests).toEqual([[v6], []]);
	expect(writes).toEqual([""]);
});
