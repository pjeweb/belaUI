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

import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { getConfig, saveConfig } from "../config.ts";
import {
	convertManualToRemoteRelay,
	getRelays,
} from "../remote/remote-relays.ts";
import { notificationSend } from "../ui/notifications.ts";
import {
	broadcastMsg,
	deleteSocketSenderId,
	getSocketSenderId,
	setSocketSenderId,
} from "../ui/websocket-server.ts";
import { audioCodecs, getAudioDevices } from "./audio.ts";
import {
	type ConfigParameters,
	type StreamConfig,
	validateStreamConfig,
} from "./config-validation.ts";
import { searchPipelines } from "./pipelines.ts";

export type { ConfigParameters } from "./config-validation.ts";
export type StartMessage = { start: ConfigParameters };
const statusEvents = new EventEmitter();
export function onStreamingStatusChange(callback: () => void) {
	statusEvents.on("change", callback);
	return () => {
		statusEvents.off("change", callback);
	};
}

let isStreaming = false;

export function getIsStreaming() {
	return isStreaming;
}

export function updateStatus(status: boolean) {
	if (status !== isStreaming) {
		isStreaming = status;
		broadcastMsg("status", { is_streaming: isStreaming });
		statusEvents.emit("change");
		return true;
	}

	return false;
}

export function startError(conn: WebSocket, msg: string, id?: string) {
	const originalId = getSocketSenderId(conn);
	if (id !== undefined) {
		setSocketSenderId(conn, id);
	}

	try {
		notificationSend(conn, "start_error", "error", msg, 10);
	} finally {
		if (id !== undefined) {
			if (originalId) {
				setSocketSenderId(conn, originalId);
			} else {
				deleteSocketSenderId(conn);
			}
		}
	}

	return false;
}

export function validateConfig(params: unknown) {
	return validateStreamConfig(params, {
		pipeline: searchPipelines,
		audioDevices: getAudioDevices(),
		audioCodecs,
		savedAudioSource: getConfig().asrc,
		relays: getRelays(),
	});
}

export function saveStreamConfig(params: StreamConfig) {
	const config = getConfig();
	Object.assign(config, params);
	config.relay_server = params.relay_server;
	config.relay_account = params.relay_account;
	config.srtla_addr = params.srtla_addr;
	config.srtla_port = params.srtla_port;
	config.srt_streamid = params.srt_streamid;
	if (!params.relay_server || !params.relay_account)
		convertManualToRemoteRelay();
	saveConfig();
	broadcastMsg("config", config);
}
