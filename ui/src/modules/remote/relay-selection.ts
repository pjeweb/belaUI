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

import type { Config } from "../config.ts";
import type { Option } from "../ui/options-list.ts";

export type Relays = {
	servers: Record<string, Option & { default?: boolean }>;
	accounts: Record<string, Option>;
};

export class RelaySelection {
	private relays?: Relays;
	private user?: { server: string; account: string };

	select(server: string, account: string) {
		this.user = { server, account };
	}

	update(config: Config, relays: Partial<Relays> | null) {
		if (relays === null) this.user = undefined;
		else if (relays.servers && relays.accounts) this.relays = relays as Relays;
		const presets: Record<string, Option> = {
			manual: { name: "Manual configuration" },
		};
		let server = this.user?.server ?? config.relay_server;
		if (
			!this.relays ||
			(!this.user && (config.srtla_addr || config.srtla_port))
		)
			server = "manual";
		else if (
			server !== "manual" &&
			(!server || !Object.hasOwn(this.relays.servers, server))
		) {
			server = Object.entries(this.relays.servers).find(
				([, value]) => value.default,
			)?.[0];
		}
		let account = this.user?.account ?? config.relay_account;
		if (!this.relays || (!this.user && config.srt_streamid !== undefined))
			account = "manual";
		else if (
			account &&
			account !== "manual" &&
			!Object.hasOwn(this.relays.accounts, account)
		) {
			account = "unavailable";
		}
		return {
			server,
			account,
			servers: [this.relays?.servers ?? {}, presets],
			accounts: [
				this.relays?.accounts ?? {},
				{
					...presets,
					...(account === "unavailable"
						? { unavailable: { name: "No longer available", disabled: true } }
						: {}),
				},
			],
		};
	}
}
