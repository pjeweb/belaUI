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

import type WebSocket from "ws";
import { isLocalIp } from "../../helpers/ip-addresses.ts";
import { logger } from "../../helpers/logger.ts";
import { getConfig, saveConfig } from "../config.ts";
import { getBcrptLowMtu } from "../network/bcrpt.ts";
import { onNetworkInterfacesChange } from "../network/network-interfaces.ts";
import { setup } from "../setup.ts";
import {
	isUpdating,
	periodicCheckForSoftwareUpdates,
} from "../system/software-updates.ts";
import {
	notificationBroadcast,
	notificationExists,
} from "../ui/notifications.ts";
import { sendStatus } from "../ui/status.ts";
import { broadcastMsg, getSocketSenderId } from "../ui/websocket-server.ts";
import { DEFAULT_AUDIO_ID, asrcProbe, pipelineSetAsrc } from "./audio.ts";
import { bootAutostart } from "./boot-autostart.ts";
import type { ConfigParameters, ValidatedStream } from "./config-validation.ts";
import { setBitrate } from "./encoder.ts";
import { removeBitrateOverlay } from "./pipelines.ts";
import { ProcessSupervisor } from "./process-supervisor.ts";
import {
	genSrtalIpListForLocalIpAddress,
	genSrtlaIpList,
	resolveSrtla,
	restartSrtla,
	setSrtlaIpList,
} from "./srtla.ts";
import { StreamLifecycle } from "./start-lifecycle.ts";
import {
	getIsStreaming,
	saveStreamConfig,
	startError,
	updateStatus,
	validateConfig,
} from "./streaming.ts";

export const belacoderExec = `${setup.belacoder_path ?? "/usr/bin"}/belacoder`;
export const srtlaSendExec = `${setup.srtla_path ?? "/usr/bin"}/srtla_send`;

const supervisor = new ProcessSupervisor(undefined, (message) =>
	logger.error(message),
);
let removeNetworkListener: (() => void) | undefined;
async function stopProcesses() {
	removeNetworkListener?.();
	removeNetworkListener = undefined;
	await supervisor.stop();
}

function pathsFor(address: string) {
	return isLocalIp(address)
		? genSrtalIpListForLocalIpAddress(address)
		: genSrtlaIpList();
}

type StartRequest = { params: unknown; conn?: WebSocket; senderId?: string };
type ReadyStream = ValidatedStream & { pipelineFile: string };

const lifecycle = new StreamLifecycle<
	StartRequest,
	ValidatedStream,
	ReadyStream
>({
	isUpdating,
	status: updateStatus,
	validate: (request) => validateConfig(request.params),
	async prepare(validated, signal, automatic) {
		const srtlaAddr = await resolveSrtla(validated.srtlaAddr);
		signal.throwIfAborted();
		if (!automatic) saveStreamConfig(validated.config);
		if (!pathsFor(srtlaAddr).length)
			throw new Error("Failed to start, no available network connections");
		const { config, pipeline } = validated;
		let pipelineFile = pipeline.path;
		if (!config.bitrate_overlay) {
			const generated = await removeBitrateOverlay(pipelineFile);
			signal.throwIfAborted();
			if (!generated)
				throw new Error(
					"failed to generate the pipeline file - bitrate overlay",
				);
			pipelineFile = generated;
		}
		const source = pipeline.asrc
			? await asrcProbe(config.asrc ?? "", signal)
			: DEFAULT_AUDIO_ID;
		signal.throwIfAborted();
		pipelineFile = await pipelineSetAsrc(
			pipelineFile,
			source,
			pipeline.acodec ? config.acodec : undefined,
		);
		signal.throwIfAborted();
		return { ...validated, srtlaAddr, pipelineFile };
	},
	launch(ready) {
		const paths = pathsFor(ready.srtlaAddr);
		if (!paths.length)
			throw new Error("Failed to start, no available network connections");
		setSrtlaIpList(paths);
		if (setBitrate(ready.config) === null) throw new Error("Invalid bitrate");
		supervisor.start();
		removeNetworkListener = onNetworkInterfacesChange(() => {
			try {
				// An empty list during a handover is valid; retain the listener for recovery.
				setSrtlaIpList(pathsFor(ready.srtlaAddr));
				restartSrtla();
			} catch (error) {
				logger.error(error);
			}
		});
		supervisor.spawnLoop(
			srtlaSendExec,
			() => [
				"9000",
				ready.srtlaAddr,
				String(ready.srtlaPort),
				String(setup.ips_file),
			],
			100,
			(error) => {
				let msg: string | undefined;
				if (error.includes("Failed to establish any initial connections"))
					msg = "Failed to connect to the SRTLA server. Retrying...";
				else if (error.includes("no available connections"))
					msg = "All SRTLA connections failed. Trying to reconnect...";
				if (msg) notificationBroadcast("srtla", "error", msg, 5, true, false);
			},
		);
		supervisor.spawnLoop(
			belacoderExec,
			() => {
				const args = [
					ready.pipelineFile,
					"127.0.0.1",
					"9000",
					"-d",
					String(ready.config.delay),
					"-b",
					String(setup.bitrate_file),
					"-l",
					String(ready.config.srt_latency),
				];
				if (ready.streamid) args.push("-s", ready.streamid);
				if (getBcrptLowMtu()) args.push("-r");
				return args;
			},
			2000,
			(err) => {
				let msg: string | undefined;
				if (err.match("gstreamer error from alsasrc0")) {
					msg = "Capture card error (audio). Trying to restart...";
				} else if (err.match("gstreamer error from v4l2src0")) {
					msg = "Capture card error (video). Trying to restart...";
				} else if (err.match("Pipeline stall detected")) {
					msg = "The input source has stalled. Trying to restart...";
				} else if (err.match("Failed to establish an SRT connection")) {
					if (!notificationExists("srtla")) {
						const reasonMatch = err.match(
							/Failed to establish an SRT connection: ([\w ]+)\./,
						);
						const reason = reasonMatch?.[1] ? ` (${reasonMatch[1]})` : "";
						msg = `Failed to connect to the SRT server${reason}. Retrying...`;
					}
				} else if (err.match(/The SRT connection.+, exiting/)) {
					if (!notificationExists("srtla")) {
						msg = "The SRT connection failed. Trying to reconnect...";
					}
				}
				if (msg) {
					notificationBroadcast("belacoder", "error", msg, 5, true, false);
				}
			},
		);
	},
	stop: stopProcesses,
	error(error, automatic, request) {
		const message = error instanceof Error ? error.message : String(error);
		if (!automatic && request.conn)
			startError(request.conn, message, request.senderId);
		else logger.warn(`autostart failed: ${message}`);
	},
});

export async function start(conn: WebSocket, params: ConfigParameters) {
	if (getIsStreaming() || isUpdating()) {
		sendStatus(conn);
		return;
	}
	await lifecycle.start({ params, conn, senderId: getSocketSenderId(conn) });
}

export async function stop() {
	await lifecycle.stop();
	periodicCheckForSoftwareUpdates();
}

export function setAutostart(value: unknown) {
	if (typeof value !== "boolean") return;
	getConfig().autostart = value;
	saveConfig();
	if (!value) lifecycle.cancelAutostart();
	broadcastMsg("config", getConfig());
}

export function initAutostart() {
	bootAutostart(getConfig().autostart === true, () => {
		void lifecycle.start({ params: { ...getConfig() } }, true);
	});
}
