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

import { validatePortNo } from "../../helpers/number.ts";

export type RelayCache = {
	bcrp_key?: string;
	servers: Record<
		string,
		{
			type: string;
			name: string;
			default?: true;
			addr: string;
			port: number;
			bcrp_port?: number;
		}
	>;
	accounts: Record<
		string,
		{
			name: string;
			ingest_key: string;
			disabled?: true;
		}
	>;
};

export type ValidateRemoteRelaysMessage = {
	relays: {
		bcrp_key?: unknown;
		servers: Record<
			string,
			{
				type?: unknown;
				name?: unknown;
				addr?: unknown;
				port?: unknown;
				bcrp_port?: unknown;
				default?: unknown;
			}
		>;
		accounts: Record<
			string,
			{
				name?: unknown;
				ingest_key?: unknown;
				disabled?: unknown;
			}
		>;
	};
};

export function validateRemoteRelays(
	msg: ValidateRemoteRelaysMessage["relays"],
) {
	try {
		const out: RelayCache = {
			servers: Object.create(null),
			accounts: Object.create(null),
		};
		for (const r_id in msg.servers) {
			const r = msg.servers[r_id];
			if (!r) continue;

			if (
				r.type !== "srtla" ||
				typeof r.name !== "string" ||
				typeof r.addr !== "string"
			)
				continue;
			if (r.default && r.default !== true) continue;

			const port = validatePortNo(r.port as string);
			if (!port) continue;
			const probePort =
				r.bcrp_port === undefined
					? undefined
					: validatePortNo(r.bcrp_port as string);
			if (r.bcrp_port !== undefined && !probePort) continue;

			out.servers[r_id] = {
				type: r.type,
				name: r.name,
				addr: r.addr,
				port: port,
			};
			if (r.default) out.servers[r_id].default = true;
			if (probePort) out.servers[r_id].bcrp_port = probePort;
		}

		for (const a_id in msg.accounts) {
			const a = msg.accounts[a_id];
			if (!a || typeof a.name !== "string" || typeof a.ingest_key !== "string")
				continue;

			out.accounts[a_id] = { name: a.name, ingest_key: a.ingest_key };
			if (a.disabled) out.accounts[a_id].disabled = true;
		}

		if (msg.bcrp_key !== undefined) {
			if (typeof msg.bcrp_key !== "string") return;
			out.bcrp_key = msg.bcrp_key;
		}
		if (Object.keys(out.servers).length < 1) return;

		return out;
	} catch (err) {
		return undefined;
	}
}
