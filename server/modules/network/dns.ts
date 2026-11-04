/*
    belaUI - web UI for the BELABOX project
    Copyright (C) 2020-2022 BELABOX project

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/*
  DNS utils w/ a persistent cache
*/

import { Resolver } from "node:dns";
import fs from "node:fs";
import { isIP } from "node:net";
import { normalizeIp } from "../../helpers/ip-addresses.ts";

import { logger } from "../../helpers/logger.ts";
import { writeTextFile } from "../../helpers/text-files.ts";

const DNS_CACHE_FILE = "dns_cache.json";
/* Minimum age of an updated record to trigger a persistent DNS cache update (in ms)
   Some records change with almost every query if using CDNs, etc
   This limits the frequency of file writes */
const DNS_MIN_AGE = 60_000; // in ms
const DNS_TIMEOUT = 2_000; // in ms
const DNS_WELLKNOWN_NAME = "wellknown.belabox.net";
const DNS_WELLKNOWN_ADDR = "127.1.33.7";

type ResolveResult = Array<string> | null;

type ResolveType = "a" | "aaaa";

/*
  dns.Resolver uses c-ares, with each instance (and the global
  dns.resolve*() functions) mapped one-to-one to a c-ares channel

  c-ares channels re-use the underlying UDP sockets for multi queries,
  which is good for performance but the incorrect behaviour for us, as
  it can end up trying to use stale connections long after we change
  the default route after a network becomes unavailable

  For simplicity, we create a new instance for each query unless one
  is provided by the caller. The callers shouldn't reuse Resolver
  instances for unrelated queries as we call resolver.cancel() on
  timeout, which will make all pending queries time out.
*/
export function resolveP(
	hostname: string,
	rrtype: ResolveType | undefined,
	existingResolver?: Resolver,
	timeout = DNS_TIMEOUT,
) {
	const resolver = existingResolver ?? new Resolver();
	return new Promise<ResolveResult>((resolve, reject) => {
		let pending = rrtype ? 1 : 2;
		const answers: Partial<Record<ResolveType, string[]>> = {};
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			const result = [...(answers.a ?? []), ...(answers.aaaa ?? [])];
			if (result.length) resolve(result);
			else reject(new Error(`DNS record not found for ${hostname}`));
		};
		const timer = setTimeout(() => {
			finish();
			resolver.cancel();
		}, timeout);
		const receive = (
			family: ResolveType,
			err: NodeJS.ErrnoException | null,
			addresses: string[],
		) => {
			if (finished) return;
			if (!err) answers[family] = addresses;
			if (--pending === 0) finish();
		};
		if (!rrtype || rrtype === "a")
			resolver.resolve4(hostname, (err, addresses) =>
				receive("a", err, addresses),
			);
		if (!rrtype || rrtype === "aaaa")
			resolver.resolve6(hostname, (err, addresses) =>
				receive("aaaa", err, addresses),
			);
	});
}

type DnsCacheEntry = {
	ts: number;
	results: NonNullable<ResolveResult>;
};

let dnsCache: Record<string, DnsCacheEntry> = {};
const dnsResults: Record<string, ResolveResult> = {};
try {
	dnsCache = JSON.parse(fs.readFileSync(DNS_CACHE_FILE, "utf8"));
	for (const [name, entry] of Object.entries(dnsCache)) {
		if (!name.startsWith("a:") && !name.startsWith("aaaa:")) {
			if (entry.results.every((a) => isIP(a) === 4))
				dnsCache[`a:${name}`] = entry;
			delete dnsCache[name];
		}
	}
} catch (err) {
	logger.warn(
		"Failed to load the persistent DNS cache, starting with an empty cache",
	);
}

function isValidResolveType(rrtype: string): rrtype is ResolveType {
	return rrtype === "a" || rrtype === "aaaa";
}

function normalizeResolveType(
	rrtype: string | undefined,
): ResolveType | undefined {
	if (rrtype === undefined) return undefined;
	const normalized = rrtype.toLowerCase();
	if (isValidResolveType(normalized)) return normalized;

	throw "Invalid rrtype";
}

export async function dnsCacheResolve(
	input: string,
	rrtype_?: string,
): Promise<{ addrs: string[]; fromCache: boolean }> {
	const name = normalizeIp(input);
	const rrtype = normalizeResolveType(rrtype_);
	if (!rrtype && !isIP(name)) {
		const results = await Promise.allSettled([
			dnsCacheResolve(name, "a"),
			dnsCacheResolve(name, "aaaa"),
		]);
		const good = results.flatMap((r) =>
			r.status === "fulfilled" ? [r.value] : [],
		);
		if (!good.length)
			throw new Error("DNS query failed and no cached value is available");
		return {
			addrs: good.flatMap((r) => r.addrs),
			fromCache: good.some((r) => r.fromCache),
		};
	}
	const family = isIP(name);
	if (
		family &&
		(!rrtype || (family === 4 ? rrtype === "a" : rrtype === "aaaa"))
	) {
		return { addrs: [name], fromCache: false };
	}

	if (family) throw new Error("Literal address family mismatch");
	const key = `${rrtype}:${name}`;
	delete dnsResults[key];
	let badDns = true;

	// Reuse the Resolver instance for the actual query after a succesful validation
	const resolver = new Resolver();

	/* Assume that DNS resolving is broken, unless it returns
     the expected result for a known name */
	try {
		const lookup = await resolveP(DNS_WELLKNOWN_NAME, "a", resolver);
		if (lookup && lookup.length === 1 && lookup[0] === DNS_WELLKNOWN_ADDR) {
			badDns = false;
		} else {
			logger.error(
				`DNS validation failure: got result ${lookup} instead of the expected ${DNS_WELLKNOWN_ADDR}`,
			);
		}
	} catch (e) {
		logger.error(`DNS validation failure: ${e}`);
	}

	if (badDns) {
		delete dnsResults[key];
	} else {
		try {
			const res = (await resolveP(name, rrtype, resolver)) ?? [];
			dnsResults[key] = res;

			return { addrs: res, fromCache: false };
		} catch (err) {
			logger.error(`dns error ${err}`);
		}
	}

	const cachedEntry = dnsCache[key];
	if (cachedEntry) return { addrs: cachedEntry.results, fromCache: true };

	throw "DNS query failed and no cached value is available";
}

// biome-ignore lint/suspicious/noExplicitAny: typescript workaround
type SomeValue = keyof any;

function compareArrayElements(a1: Array<SomeValue>, a2: Array<SomeValue>) {
	if (!Array.isArray(a1) || !Array.isArray(a2)) return false;

	const cmp: Record<SomeValue, boolean> = {};
	for (const e of a1) {
		cmp[e] = false;
	}

	// check that all elements of a2 are in a1
	for (const e of a2) {
		if (cmp[e] === undefined) {
			return false;
		}
		cmp[e] = true;
	}

	// check that all elements of a1 are in a2
	for (const e in cmp) {
		if (!cmp[e]) return false;
	}

	return true;
}

export async function dnsCacheValidate(name: string) {
	for (const family of ["a", "aaaa"])
		await validateFamily(`${family}:${normalizeIp(name)}`);
}
async function validateFamily(key: string) {
	if (!dnsResults[key]) {
		return;
	}

	const cachedEntry = dnsCache[key];

	if (
		!cachedEntry ||
		!compareArrayElements(dnsResults[key], cachedEntry.results)
	) {
		const writeFile = !(
			cachedEntry?.ts && Date.now() - cachedEntry.ts < DNS_MIN_AGE
		);

		dnsCache[key] = cachedEntry ?? {
			ts: Date.now(),
			results: [],
		};

		dnsCache[key].results = dnsResults[key];

		if (writeFile) {
			dnsCache[key].ts = Date.now();
			await writeTextFile(DNS_CACHE_FILE, JSON.stringify(dnsCache));
		}
	}
}
