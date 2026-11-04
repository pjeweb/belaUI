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

import { isIP } from "node:net";
import { isSameSubnet, isUla } from "../../helpers/ip-addresses.ts";
import { selectIpv6 } from "./interface-discovery.ts";

export const NETIF_ERR_DUPIPV4 = 0x01;
export const NETIF_ERR_HOTSPOT = 0x02;

type AddressInterface = {
	ip?: string;
	ipv6?: string;
	addresses?: import("./interface-discovery.ts").InterfaceAddress[];
	netmask?: string;
	enabled: boolean;
	error: number;
};

export function selectSrtlaAddresses(
	interfaces: Record<string, AddressInterface>,
	localTarget?: string,
	receiverHasIpv6 = false,
	receiverHasIpv4 = true,
) {
	const addresses = new Set<string>();
	for (const network of Object.values(interfaces)) {
		if (localTarget && isIP(localTarget) === 6) {
			if (network.error & NETIF_ERR_DUPIPV4) continue;
			const candidates =
				network.addresses?.filter((a) =>
					isSameSubnet(localTarget, a.address, String(a.prefixLength)),
				) ?? [];
			const source = selectIpv6(candidates);
			if (source) addresses.add(source);
			continue;
		}
		const source =
			(receiverHasIpv4 ? network.ip : undefined) ??
			(receiverHasIpv6 && network.ipv6 && !isUla(network.ipv6)
				? network.ipv6
				: undefined);
		if (!source) continue;
		if (localTarget) {
			// Preserve IPv4 LAN and hotspot receiver selection.
			if (
				!(network.error & NETIF_ERR_DUPIPV4) &&
				network.ip &&
				network.netmask &&
				isSameSubnet(localTarget, network.ip, network.netmask)
			)
				addresses.add(source);
		} else if (network.enabled && !network.error) addresses.add(source);
	}
	return [...addresses];
}
