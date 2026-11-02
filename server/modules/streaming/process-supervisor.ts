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

import { type ChildProcess, spawn } from "node:child_process";

type Spawn = (command: string, args: string[]) => ChildProcess;
type StreamingProcess = {
	child: ChildProcess;
	closed: boolean;
	done: Promise<void>;
	restartTimer?: ReturnType<typeof setTimeout>;
};

export class ProcessSupervisor {
	private processes = new Set<StreamingProcess>();
	private running = false;
	private stopping?: Promise<void>;
	constructor(
		private spawnProcess: Spawn = (command, args) =>
			spawn(command, args, { stdio: ["inherit", "inherit", "pipe"] }),
		private log: (message: string) => void = console.error,
		private killTimeout = 5000,
	) {}

	start() {
		this.running = true;
	}

	spawnLoop(
		command: string,
		args: () => string[],
		cooldown: number,
		report: (data: string) => void,
	) {
		if (!this.running) return;
		const child = this.spawnProcess(command, args());
		let closed!: () => void;
		const process: StreamingProcess = {
			child,
			closed: false,
			done: new Promise<void>((resolve) => {
				closed = resolve;
			}),
		};
		this.processes.add(process);
		child.stderr?.on("data", (data) => {
			report(data.toString("utf8"));
		});
		child.on("error", (error) => {
			this.log(`Failed to spawn ${command}: ${error.message}`);
		});
		child.on("close", () => {
			process.closed = true;
			closed();
			if (this.running)
				process.restartTimer = setTimeout(() => {
					this.processes.delete(process);
					if (this.running) this.spawnLoop(command, args, cooldown, report);
				}, cooldown);
			else this.processes.delete(process);
		});
	}

	private async terminate(process: StreamingProcess) {
		clearTimeout(process.restartTimer);
		if (!process.closed) {
			process.child.kill("SIGTERM");
			const timeout = setTimeout(() => {
				process.child.kill("SIGKILL");
			}, this.killTimeout);
			try {
				await process.done;
			} finally {
				clearTimeout(timeout);
			}
		}
		this.processes.delete(process);
	}

	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.running = false;
		// Stop the encoder before its sender, so media shuts down in order.
		this.stopping = (async () => {
			await Promise.all(
				[...this.processes]
					.filter((p) => p.child.spawnfile.endsWith("belacoder"))
					.map((p) => this.terminate(p)),
			);
			await Promise.all([...this.processes].map((p) => this.terminate(p)));
		})().finally(() => {
			this.stopping = undefined;
		});
		return this.stopping;
	}
}
