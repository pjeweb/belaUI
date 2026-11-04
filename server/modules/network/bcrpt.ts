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

import { logger } from "../../helpers/logger.ts";
import {
	getRelays,
	onRelaysChange,
	updateRelayRtts,
} from "../remote/remote-relays.ts";
import { setup } from "../setup.ts";
import {
	getIsStreaming,
	onStreamingStatusChange,
} from "../streaming/streaming.ts";
import { BcrptMonitor } from "./bcrpt-client.ts";
import { dnsCacheResolve, dnsCacheValidate } from "./dns.ts";
import {
	getNetworkInterfaces,
	onNetworkInterfacesChange,
} from "./network-interfaces.ts";

const monitor = new BcrptMonitor({
	command: `${setup.bcrpt_path ?? "/usr/bin"}/bcrpt`,
	directory: "/var/run/bcrpt",
	state: () => ({
		interfaces: getNetworkInterfaces(),
		relays: getRelays(),
		streaming: getIsStreaming(),
	}),
	resolve: (address) => dnsCacheResolve(address),
	validateDns: dnsCacheValidate,
	rttUpdated: updateRelayRtts,
	log: (message) => logger.info(message),
});

export function getBcrptLowMtu() {
	return monitor.getLowMtu();
}

export function initBcrpt() {
	const refresh = () => {
		void monitor.refresh();
	};
	onNetworkInterfacesChange(refresh);
	onRelaysChange(refresh);
	onStreamingStatusChange(refresh);
	void monitor.start();
	process.once("exit", () => {
		monitor.stop();
	});
}
