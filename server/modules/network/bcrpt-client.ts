import { bracketHost } from "../../helpers/ip-addresses.ts";
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

import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export type ProbeRelays = {
	servers: Record<string, { addr: string; bcrp_port?: number }>;
	bcrp_key?: string;
};
export type ProbeState = {
	interfaces: Record<string, { ip?: string; error?: number }>;
	relays?: ProbeRelays;
	streaming: boolean;
};
export type ProbeTargets = {
	sources: string;
	servers: string;
	key: string;
	relayIds: Record<string, string>;
};
export type ProbeResolver = (
	address: string,
) => Promise<{ addrs: string[]; fromCache: boolean }>;

export async function buildProbeTargets(
	state: ProbeState,
	resolve: ProbeResolver,
	validate: (address: string) => void | Promise<void>,
): Promise<ProbeTargets> {
	const targets: ProbeTargets = {
		sources: "",
		servers: "",
		key: state.relays?.bcrp_key ?? "",
		relayIds: {},
	};
	const sources = new Set<string>();
	for (const value of Object.values(state.interfaces))
		if (value.ip && !value.error) sources.add(value.ip);
	targets.sources = [...sources].map((ip) => `${ip}\n`).join("");
	if (!state.streaming && state.relays) {
		for (const [id, server] of Object.entries(state.relays.servers)) {
			if (!server.bcrp_port) continue;
			const result = await resolve(server.addr);
			for (const ip of result.addrs) {
				const address = `${bracketHost(ip)}:${server.bcrp_port}`;
				targets.relayIds[address] = id;
				targets.servers += `${address}\n`;
			}
			if (!result.fromCache) await validate(server.addr);
		}
	}
	return targets;
}

export function parseProbeStats(
	input: unknown,
	relayIds: Record<string, string>,
) {
	if (!input || typeof input !== "object")
		throw new Error("Invalid BCRPT statistics");
	const stats = input as {
		rtt?: Record<string, { max_min?: unknown }>;
		mtu?: Record<string, unknown>;
	};
	const rtts: Record<string, number> = {};
	if (stats.rtt && typeof stats.rtt === "object") {
		for (const [address, value] of Object.entries(stats.rtt)) {
			const id = relayIds[address];
			const rtt = value?.max_min;
			if (id && typeof rtt === "number" && Number.isFinite(rtt) && rtt >= 0)
				rtts[id] = Math.max(rtts[id] ?? 0, rtt);
		}
	}
	const lowMtu =
		stats.mtu &&
		typeof stats.mtu === "object" &&
		Object.entries(stats.mtu).some(
			([source, mtu]) =>
				typeof mtu === "number" &&
				Number.isFinite(mtu) &&
				mtu > 0 &&
				mtu < (source.includes(":") ? 1356 : 1336),
		);
	return { rtts, lowMtu: Boolean(lowMtu) };
}

type ProbeProcess = EventEmitter & {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill(signal: NodeJS.Signals): boolean;
};
export type ProbeIO = {
	mkdir(directory: string): Promise<unknown>;
	write(file: string, contents: string): Promise<unknown>;
	spawn(command: string, args: string[]): ProbeProcess;
};
const systemIO: ProbeIO = {
	mkdir: (directory) => mkdir(directory, { recursive: true }),
	async write(file, contents) {
		const temporary = `${file}.tmp`;
		await writeFile(temporary, contents, { mode: 0o600 });
		await rename(temporary, file);
	},
	spawn: (command, args) =>
		spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }),
};

type ProbeOptions = {
	command: string;
	directory: string;
	state(): ProbeState;
	resolve: ProbeResolver;
	validateDns(address: string): void | Promise<void>;
	rttUpdated(rtts: Record<string, number>): void;
	log(message: string): void;
};

/** Serializes config reloads and supervises the independent BCRPT process. */
export class BcrptMonitor {
	private active = false;
	private revision = 0;
	private updating: Promise<void> = Promise.resolve();
	private retry?: ReturnType<typeof setTimeout>;
	private child?: ProbeProcess;
	private relayIds: Record<string, string> = {};
	private lowMtu = false;

	constructor(
		private options: ProbeOptions,
		private io: ProbeIO = systemIO,
		private retryMs = 1000,
	) {}

	getLowMtu() {
		return this.lowMtu;
	}

	start() {
		this.active = true;
		return this.refresh();
	}

	refresh(): Promise<void> {
		if (!this.active) return Promise.resolve();
		const revision = ++this.revision;
		this.updating = this.updating.then(() => this.update(revision));
		return this.updating;
	}

	stop() {
		this.active = false;
		clearTimeout(this.retry);
		this.retry = undefined;
		this.child?.kill("SIGTERM");
		this.child = undefined;
	}

	private scheduleRetry() {
		if (!this.active || this.retry) return;
		this.retry = setTimeout(() => {
			this.retry = undefined;
			void this.refresh();
		}, this.retryMs);
	}

	private async update(revision: number) {
		if (!this.active || revision !== this.revision) return;
		try {
			const targets = await buildProbeTargets(
				this.options.state(),
				this.options.resolve,
				this.options.validateDns,
			);
			if (!this.active) return;
			if (revision !== this.revision) return;
			const dir = this.options.directory;
			await this.io.mkdir(dir);
			await this.io.write(`${dir}/source_ips`, targets.sources);
			await this.io.write(`${dir}/server_ips`, targets.servers);
			await this.io.write(`${dir}/key`, targets.key);
			if (!this.active) return;
			if (revision !== this.revision) return;
			this.relayIds = targets.relayIds;
			if (this.child) this.child.kill("SIGHUP");
			else this.launch();
			clearTimeout(this.retry);
			this.retry = undefined;
		} catch {
			this.options.log("BCRPT configuration failed; retrying");
			this.scheduleRetry();
		}
	}

	private launch() {
		const dir = this.options.directory;
		const child = this.io.spawn(this.options.command, [
			`${dir}/source_ips`,
			`${dir}/server_ips`,
			`${dir}/key`,
		]);
		this.child = child;
		const decoder = new StringDecoder("utf8");
		let buffer = "";
		const consume = (text: string) => {
			try {
				const stats = parseProbeStats(JSON.parse(text), this.relayIds);
				if (stats.lowMtu && !this.lowMtu) {
					this.lowMtu = true;
					this.options.log(
						"Detected low MTU network. Using reduced SRT packet size",
					);
				}
				this.options.rttUpdated(stats.rtts);
				return true;
			} catch {
				return false;
			}
		};
		child.stdout.on("data", (data: Buffer) => {
			if (this.child !== child || !this.active) return;
			buffer += decoder.write(data);
			if (buffer.length > 1024 * 1024) {
				buffer = "";
				this.options.log("Discarded oversized BCRPT output");
				return;
			}
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line && !consume(line))
					this.options.log("Discarded invalid BCRPT statistics");
				newline = buffer.indexOf("\n");
			}
			// Also accept a complete JSON document without a trailing newline.
			if (buffer.trim() && consume(buffer)) buffer = "";
		});
		child.stderr.on("data", () => {
			this.options.log("BCRPT reported an error on stderr");
		});
		child.on("error", () => {
			this.options.log("BCRPT process error");
		});
		child.on("close", () => {
			if (this.child !== child) return;
			this.child = undefined;
			this.options.log("BCRPT exited; retrying");
			this.scheduleRetry();
		});
	}
}
