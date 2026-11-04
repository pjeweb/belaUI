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

import { exec } from "node:child_process";
/* Network interface list */
import {
	type IpInterface,
	interfaceAddresses,
	prefixNetmask,
	selectIpv6,
} from "./interface-discovery.ts";

import type WebSocket from "ws";

import { getms } from "../../helpers/time.ts";

import { logger } from "../../helpers/logger.ts";
import { ACTIVE_TO } from "../../helpers/shared.ts";

import { EventEmitter } from "node:events";
import {
	notificationBroadcast,
	notificationRemove,
	notificationSend,
} from "../ui/notifications.ts";
import { broadcastMsg, buildMsg } from "../ui/websocket-server.ts";
import {
	wifiDeviceListAdd,
	wifiDeviceListEndUpdate,
	wifiDeviceListStartUpdate,
} from "../wifi/wifi-device-list.ts";
import { wifiUpdateDevices } from "../wifi/wifi-interfaces.ts";

import {
	InterfaceState,
	type NetworkInterface,
	interfaceSourceChanged,
} from "./interface-state.ts";
export type { NetworkInterface } from "./interface-state.ts";

export type NetworkInterfaceMessage = {
	netif: {
		name: string;
		ip: string;
		enabled: boolean | unknown;
	};
};

import { NETIF_ERR_DUPIPV4, NETIF_ERR_HOTSPOT } from "./interface-addresses.ts";
export { NETIF_ERR_DUPIPV4, NETIF_ERR_HOTSPOT } from "./interface-addresses.ts";

const interfaceState = new InterfaceState();

const networkInterfacesEventEmitter = new EventEmitter();

export function triggerNetworkInterfacesChange() {
	networkInterfacesEventEmitter.emit("change");
}

export function onNetworkInterfacesChange(callback: () => void) {
	networkInterfacesEventEmitter.on("change", callback);

	return () => {
		networkInterfacesEventEmitter.off("change", callback);
	};
}

export function getNetworkInterfaces() {
	return interfaceState.interfaces;
}

export function initNetworkInterfaceMonitoring() {
	updateNetif();
	setInterval(updateNetif, 1000);
}

function updateNetif() {
	const poll = interfaceState.beginPoll();
	exec("ip -j -s addr", (error, stdout) => {
		if (error) {
			logger.error(`Error getting interface addresses: ${error.message}`);
			return;
		}

		if (!interfaceState.acceptPoll(poll)) return;
		const netif = interfaceState.interfaces;
		let intsChanged = false;
		const newInterfaces: Record<string, NetworkInterface> = Object.create(null);

		let interfaces: IpInterface[];
		try {
			interfaces = JSON.parse(stdout);
		} catch (error) {
			logger.error(error);
			return;
		}

		wifiDeviceListStartUpdate();

		for (const int of interfaces) {
			try {
				const name = int.ifname;

				if (name === "lo" || name.match("^docker") || name.match("^l4tbr"))
					continue;

				const addresses = interfaceAddresses(int);
				const ipv4 = addresses.find((a) => a.family === "inet");
				const inetAddr = ipv4?.address;
				const ipv6 = selectIpv6(addresses);
				const netmask = ipv4 ? prefixNetmask(ipv4.prefixLength) : undefined;
				const isRunning = int.flags.includes("LOWER_UP");
				if (name.match("^wlan") && int.address) {
					wifiDeviceListAdd(
						name,
						int.address,
						isRunning ? (inetAddr ?? ipv6) : null,
					);
				}
				if (!isRunning) continue;
				const txBytes = int.stats64?.tx.bytes ?? 0;

				let tp = 0;
				if (netif[name]) {
					tp = txBytes - netif[name].txb;
				}

				const enabled = interfaceState.isEnabled(name);
				const error = netif[name] ? netif[name].error : 0;
				newInterfaces[name] = {
					ip: inetAddr,
					ipv6,
					addresses,
					netmask,
					txb: txBytes,
					tp,
					enabled,
					error,
				};

				// Detect interfaces that are new or with a different address
				if (interfaceSourceChanged(netif[name], newInterfaces[name])) {
					intsChanged = true;
				}
			} catch (err) {
				logger.error(`Error parsing interface addresses: ${err}`);
			}
		}

		// Detect removed interfaces
		for (const i in netif) {
			if (!newInterfaces[i]) {
				intsChanged = true;
			}
		}

		if (intsChanged) {
			const intAddrs: Record<string, string | Array<string>> = {};

			// Detect duplicate IP adddresses and set error status
			for (const i in newInterfaces) {
				const newInterface = newInterfaces[i];
				if (!newInterface?.ip) continue;

				clearNetifDup(newInterface);
				const currentValue = intAddrs[newInterface.ip];

				if (currentValue === undefined) {
					intAddrs[newInterface.ip] = i;
				} else {
					if (Array.isArray(currentValue)) {
						currentValue.push(i);
					} else {
						setNetifDup(newInterfaces[currentValue]);
						intAddrs[newInterface.ip] = [currentValue, i];
					}
					setNetifDup(newInterface);
				}
			}

			// Send out an error message for duplicate IP addresses
			let msg = "";
			for (const d in intAddrs) {
				if (Array.isArray(intAddrs[d])) {
					if (msg !== "") {
						msg += "; ";
					}
					msg += `Interfaces ${intAddrs[d].join(", ")} can't be used because they share the same IP address: ${d}`;
				}
			}

			if (msg === "") {
				notificationRemove("netif_dup_ip");
			} else {
				notificationBroadcast("netif_dup_ip", "error", msg, 0, true, true);
			}
		}

		if (wifiDeviceListEndUpdate()) {
			logger.info("updated wifi devices");
			// a delay seems to be needed before NM registers new devices
			setTimeout(wifiUpdateDevices, 1000);
		}

		interfaceState.interfaces = newInterfaces;

		if (intsChanged) {
			triggerNetworkInterfacesChange();
		}

		broadcastMsg("netif", netIfBuildMsg(), getms() - ACTIVE_TO);
	});
}

// The order is deliberate, we want *hotspot* to have higher priority
const netIfErrors = {
	2: "WiFi hotspot",
	1: "duplicate IPv4 addr",
} as const;

function setNetifError(int: NetworkInterface | undefined, err: number) {
	if (!int) return;

	int.enabled = false;
	int.error |= err;
}

function clearNetifError(int: NetworkInterface | undefined, err: number) {
	if (!int) return;
	int.error &= ~err;
}

function setNetifDup(int: NetworkInterface | undefined) {
	setNetifError(int, NETIF_ERR_DUPIPV4);
}

function clearNetifDup(int: NetworkInterface | undefined) {
	clearNetifError(int, NETIF_ERR_DUPIPV4);
}

export function setNetifHotspot(int: NetworkInterface | undefined) {
	setNetifError(int, NETIF_ERR_HOTSPOT);
}

const isValidNetworkInterfaceErrorCode = (
	e: number,
): e is keyof typeof netIfErrors => e in netIfErrors;

export function netIfGetErrorMsg(i: NetworkInterface) {
	if (i.error === 0) return;

	for (const e in netIfErrors) {
		const errorCode = Number.parseInt(e, 10);
		if (i.error & errorCode && isValidNetworkInterfaceErrorCode(errorCode))
			return netIfErrors[errorCode];
	}
}

type NetworkInterfaceResponseMessage = {
	[key: string]: Pick<NetworkInterface, "ip" | "ipv6" | "tp" | "enabled"> & {
		error?: string;
	};
};

export function netIfBuildMsg() {
	const netif = interfaceState.interfaces;
	const m: NetworkInterfaceResponseMessage = Object.create(null);
	for (const i in netif) {
		const networkInterface = netif[i];
		if (!networkInterface) continue;

		m[i] = {
			ip: networkInterface.ip,
			ipv6: !networkInterface.ip ? networkInterface.ipv6 : undefined,
			tp: networkInterface.tp,
			enabled: networkInterface.enabled,
		};
		const error = netIfGetErrorMsg(networkInterface);
		if (error) {
			m[i].error = error;
		}
	}
	return m;
}

function countActiveNetif() {
	const netif = interfaceState.interfaces;
	let count = 0;
	for (const int in netif) {
		if (netif[int]?.enabled) count++;
	}
	return count;
}

export function handleNetif(
	conn: WebSocket,
	msg: NetworkInterfaceMessage["netif"],
) {
	const int = interfaceState.getInterface(msg.name);
	if (!int) return;

	if ((int.ip ?? int.ipv6 ?? "") !== msg.ip) return;

	if (msg.enabled === true || msg.enabled === false) {
		if (msg.enabled) {
			const err = netIfGetErrorMsg(int);
			if (err) {
				notificationSend(
					conn,
					"netif_enable_error",
					"error",
					`Can't enable ${msg.name}: ${err}`,
					10,
				);
				return;
			}
		} else {
			if (int.enabled && countActiveNetif() === 1) {
				notificationSend(
					conn,
					"netif_disable_all",
					"error",
					"Can't disable all networks",
					10,
				);
				return;
			}
		}

		interfaceState.setEnabled(msg.name, msg.enabled);
		triggerNetworkInterfacesChange();
	}

	conn.send(buildMsg("netif", netIfBuildMsg()));
}
