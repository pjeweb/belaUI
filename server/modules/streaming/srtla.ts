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

import { writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import {
	cachedReceiverAddress,
	ipv6Prefix,
	normalizeIp,
} from "../../helpers/ip-addresses.ts";
import { logger } from "../../helpers/logger.ts";
import { updateIpv6Routing } from "../network/ipv6-routing.ts";
import { SourcePublisher } from "./source-publisher.ts";

import { dnsCacheResolve, dnsCacheValidate } from "../network/dns.ts";
import { queueUpdateGw } from "../network/gateways.ts";
import { selectSrtlaAddresses } from "../network/interface-addresses.ts";
import { getNetworkInterfaces } from "../network/network-interfaces.ts";
import { setup } from "../setup.ts";
import { srtlaSendExec, streamingProcesses } from "./processes.ts";

const receiverFamilies = new Map<string, { ipv4: boolean; ipv6: boolean }>();
export async function resolveSrtla(input: string) {
	const addr = normalizeIp(input);

	let srtlaAddr = addr;

	let addrs: string[] | undefined;
	let fromCache: boolean | undefined;
	try {
		const res = await dnsCacheResolve(addr);
		addrs = res.addrs;
		fromCache = res.fromCache;
	} catch (err) {
		queueUpdateGw();
		throw new Error(`Failed to resolve SRTLA addr ${addr}`);
	}

	if (fromCache) {
		const candidates = selectSrtlaAddresses(
			getNetworkInterfaces(),
			undefined,
			addrs.some((a) => isIP(a) === 6),
			addrs.some((a) => isIP(a) === 4),
		);
		const ipv6Only =
			candidates.length > 0 && candidates.every((a) => isIP(a) === 6);
		const cachedAddr = cachedReceiverAddress(addrs, ipv6Only);
		if (!cachedAddr) throw new Error("No compatible cached receiver address");
		if (cachedAddr) srtlaAddr = cachedAddr;
		queueUpdateGw();
	} else {
		/* At the moment we don't check that the SRTLA connection was established before
       validating the DNS result. The caching DNS resolver checks for invalid
       results from captive portals, etc, so all results *should* be good already */
		dnsCacheValidate(addr);
	}

	receiverFamilies.set(srtlaAddr, {
		ipv4: isIP(srtlaAddr)
			? isIP(srtlaAddr) === 4
			: addrs.some((a) => isIP(a) === 4),
		ipv6: isIP(srtlaAddr)
			? isIP(srtlaAddr) === 6
			: addrs.some((a) => isIP(a) === 6),
	});
	return srtlaAddr;
}

let routingRefresh: ReturnType<typeof setInterval> | undefined;
let requestedAddresses: string[] = [];
const publisher = new SourcePublisher({
	route: (addresses) => {
		const sources = Object.entries(getNetworkInterfaces()).flatMap(
			([device, network]) => {
				const address = addresses.find(
					(a) =>
						isIP(a) === 6 &&
						(a === network.ipv6 ||
							network.addresses?.some((info) => info.address === a)),
				);
				if (!address) return [];
				const prefixes = [
					...new Set(
						(network.addresses ?? [])
							.filter(
								(info) =>
									info.family === "inet6" && !info.tentative && !info.dadfailed,
							)
							.map((info) => ipv6Prefix(info.address, info.prefixLength)),
					),
				].sort();
				return [{ address, device, prefixes }];
			},
		);
		return updateIpv6Routing(sources);
	},
	write: (list) => writeFile(setup.ips_file, list),
	signal: () => restartSrtla(),
	log: (error) => logger.error(error),
});
let shuttingDown = false;
export function shutdownSrtla() {
	shuttingDown = true;
	clearInterval(routingRefresh);
	routingRefresh = undefined;
	requestedAddresses = [];
	return publisher.shutdown();
}
export function setSrtlaIpList(addresses: string[]) {
	if (shuttingDown) return publisher.shutdown();
	requestedAddresses = addresses;
	if (addresses.some((a) => isIP(a) === 6) && !routingRefresh) {
		routingRefresh = setInterval(() => {
			void publisher
				.update(requestedAddresses)
				.catch((error) => logger.error(error));
		}, 2000);
		routingRefresh.unref();
	} else if (!addresses.some((a) => isIP(a) === 6) && routingRefresh) {
		clearInterval(routingRefresh);
		routingRefresh = undefined;
	}
	return publisher.update(addresses);
}

export function restartSrtla() {
	streamingProcesses.signal(srtlaSendExec, "SIGHUP");
}

export function genSrtlaIpList(receiver = "") {
	return selectSrtlaAddresses(
		getNetworkInterfaces(),
		undefined,
		receiverFamilies.get(receiver)?.ipv6,
		receiverFamilies.get(receiver)?.ipv4 ?? true,
	);
}

export function genSrtalIpListForLocalIpAddress(ipAddress: string) {
	return selectSrtlaAddresses(
		getNetworkInterfaces(),
		ipAddress,
		receiverFamilies.get(ipAddress)?.ipv6,
		receiverFamilies.get(ipAddress)?.ipv4 ?? true,
	);
}
