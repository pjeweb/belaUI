import { logger } from "../../helpers/logger.ts";
import { setup } from "../setup.ts";
import { ProcessSupervisor } from "./process-supervisor.ts";

export const belacoderExec = `${setup.belacoder_path ?? "/usr/bin"}/belacoder`;
export const srtlaSendExec = `${setup.srtla_path ?? "/usr/bin"}/srtla_send`;
export const streamingProcesses = new ProcessSupervisor(undefined, (message) =>
	logger.error(message),
);
