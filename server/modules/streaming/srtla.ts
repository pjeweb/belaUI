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

import fs from "node:fs";
import { isIP } from "node:net";
import { normalizeIp } from "../../helpers/ip-addresses.ts";
import { logger } from "../../helpers/logger.ts";
import { updateIpv6Routing } from "../network/ipv6-routing.ts";

import { dnsCacheResolve, dnsCacheValidate } from "../network/dns.ts";
import { queueUpdateGw } from "../network/gateways.ts";
import { selectSrtlaAddresses } from "../network/interface-addresses.ts";
import { getNetworkInterfaces } from "../network/network-interfaces.ts";
import { setup } from "../setup.ts";
import { srtlaSendExec, streamingProcesses } from "./processes.ts";

const receiverIpv6 = new Map<string, boolean>();
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
		const cachedAddr = addrs[Math.floor(Math.random() * addrs.length)];
		if (cachedAddr) srtlaAddr = cachedAddr;
		queueUpdateGw();
	} else {
		/* At the moment we don't check that the SRTLA connection was established before
       validating the DNS result. The caching DNS resolver checks for invalid
       results from captive portals, etc, so all results *should* be good already */
		dnsCacheValidate(addr);
	}

	receiverIpv6.set(
		srtlaAddr,
		isIP(srtlaAddr) === 6 ||
			(isIP(srtlaAddr) === 0 && addrs.some((a) => isIP(a) === 6)),
	);
	return srtlaAddr;
}

let routingRefresh: ReturnType<typeof setInterval> | undefined;
let requestedAddresses: string[] = [];
let lastList: string | undefined;
export function setSrtlaIpList(addresses: string[]) {
	requestedAddresses = addresses;
	if (addresses.some((a) => isIP(a) === 6) && !routingRefresh) {
		routingRefresh = setInterval(() => {
			try {
				const before = lastList;
				setSrtlaIpList(requestedAddresses);
				if (before !== lastList) restartSrtla();
			} catch (error) {
				logger.error(error);
			}
		}, 2000);
		routingRefresh.unref();
	} else if (!addresses.some((a) => isIP(a) === 6) && routingRefresh) {
		clearInterval(routingRefresh);
		routingRefresh = undefined;
	}

	const sources = Object.entries(getNetworkInterfaces()).flatMap(
		([device, network]) =>
			network.ipv6 && !network.ip && addresses.includes(network.ipv6)
				? [{ address: network.ipv6, device }]
				: [],
	);
	const routed = updateIpv6Routing(sources);
	const usable = addresses.filter((a) => isIP(a) !== 6 || routed?.has(a));
	const list = usable.length ? `${usable.join("\n")}\n` : "";
	fs.writeFileSync(setup.ips_file, list);
	lastList = list;
}

export function restartSrtla() {
	streamingProcesses.signal(srtlaSendExec, "SIGHUP");
}

export function genSrtlaIpList(receiver = "") {
	return selectSrtlaAddresses(
		getNetworkInterfaces(),
		undefined,
		receiverIpv6.get(receiver),
	);
}

export function genSrtalIpListForLocalIpAddress(ipAddress: string) {
	return selectSrtlaAddresses(
		getNetworkInterfaces(),
		ipAddress,
		receiverIpv6.get(ipAddress),
	);
}
