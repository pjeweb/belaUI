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

import { validateInteger } from "../../helpers/number.ts";

export type ConfigParameters = {
	delay?: number | string;
	srt_latency?: number | string;
	pipeline?: string;
	acodec?: string;
	relay_server?: string;
	relay_account?: string;
	srtla_addr?: string;
	srtla_port?: number | string;
	srt_streamid?: string;
	asrc?: string;
	bitrate_overlay?: boolean;
	max_br?: number | string;
};

export type StreamConfig = Omit<
	ConfigParameters,
	"delay" | "srt_latency" | "srtla_port" | "max_br" | "pipeline"
> & {
	delay: number;
	srt_latency: number;
	max_br: number;
	pipeline: string;
	srtla_port?: number;
};

export type Pipeline = { path: string; asrc?: unknown; acodec?: unknown };
export type ValidationContext = {
	pipeline(id: string): Pipeline | null;
	audioDevices: Record<string, string>;
	audioCodecs: Record<string, string>;
	savedAudioSource?: string;
	relays?: {
		servers: Record<string, { addr: string; port: number }>;
		accounts: Record<string, { ingest_key: string }>;
	};
};

export type ValidatedStream = {
	config: StreamConfig;
	pipeline: Pipeline;
	srtlaAddr: string;
	srtlaPort: number;
	streamid: string;
};

function integer(value: unknown, min: number, max: number, name: string) {
	const parsed =
		typeof value === "string" || typeof value === "number"
			? validateInteger(String(value), min, max)
			: undefined;
	if (parsed === undefined) throw new Error(`Invalid ${name}: '${value}'`);
	return parsed;
}

export function validateStreamConfig(
	input: unknown,
	context: ValidationContext,
): ValidatedStream {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Invalid config");
	const params = input as Record<string, unknown>;
	const delay = integer(params.delay, -2000, 2000, "audio delay");
	const srt_latency = integer(params.srt_latency, 100, 10000, "SRT latency");
	const max_br = integer(params.max_br, 300, 12000, "max bitrate");
	if (typeof params.pipeline !== "string") throw new Error("Invalid pipeline");
	const pipeline = context.pipeline(params.pipeline);
	if (!pipeline) throw new Error("Pipeline not found");
	const config: StreamConfig = {
		delay,
		srt_latency,
		max_br,
		pipeline: params.pipeline,
		bitrate_overlay: Boolean(params.bitrate_overlay),
	};
	if (pipeline.acodec) {
		if (
			typeof params.acodec !== "string" ||
			!Object.hasOwn(context.audioCodecs, params.acodec)
		)
			throw new Error("Audio codec not found");
		config.acodec = params.acodec;
	}
	if (pipeline.asrc) {
		if (typeof params.asrc !== "string")
			throw new Error("Invalid audio source");
		if (
			params.asrc !== context.savedAudioSource &&
			!Object.hasOwn(context.audioDevices, params.asrc)
		)
			throw new Error("Selected audio source not found");
		config.asrc = params.asrc;
	}
	let srtlaAddr: string;
	let srtlaPort: number;
	if (context.relays && params.relay_server) {
		const id = String(params.relay_server);
		const server = Object.hasOwn(context.relays.servers, id)
			? context.relays.servers[id]
			: undefined;
		if (!server) throw new Error("Invalid relay server");
		config.relay_server = id;
		srtlaAddr = server.addr;
		srtlaPort = server.port;
	} else {
		if (typeof params.srtla_addr !== "string" || !params.srtla_addr.trim())
			throw new Error("Invalid SRTLA address");
		srtlaAddr = config.srtla_addr = params.srtla_addr.trim();
		srtlaPort = config.srtla_port = integer(
			params.srtla_port,
			1,
			65535,
			"SRTLA port",
		);
	}
	let streamid: string;
	if (context.relays && config.relay_server && params.relay_account) {
		const id = String(params.relay_account);
		const account = Object.hasOwn(context.relays.accounts, id)
			? context.relays.accounts[id]
			: undefined;
		if (!account) throw new Error("Invalid relay account");
		config.relay_account = id;
		streamid = account.ingest_key;
	} else {
		if (typeof params.srt_streamid !== "string")
			throw new Error("SRT streamid not specified");
		streamid = config.srt_streamid = params.srt_streamid;
	}
	return { config, pipeline, srtlaAddr, srtlaPort, streamid };
}
