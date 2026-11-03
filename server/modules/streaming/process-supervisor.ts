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
	command: string;
	args: () => string[];
	cooldown: number;
	report: (data: string) => void;
	child?: ChildProcess;
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
		if (this.stopping) throw new Error("Stream processes are stopping");
		this.running = true;
	}

	spawnLoop(
		command: string,
		args: () => string[],
		cooldown: number,
		report: (data: string) => void,
	) {
		if (!this.running) return;
		const process: StreamingProcess = {
			command,
			args,
			cooldown,
			report,
			closed: true,
			done: Promise.resolve(),
		};
		this.processes.add(process);
		this.spawn(process);
	}

	private retry(process: StreamingProcess) {
		if (!this.running || !this.processes.has(process)) return;
		process.restartTimer = setTimeout(() => {
			process.restartTimer = undefined;
			if (this.running && this.processes.has(process)) this.spawn(process);
		}, process.cooldown);
	}

	private spawn(process: StreamingProcess) {
		let child: ChildProcess;
		try {
			child = this.spawnProcess(process.command, process.args());
		} catch (error) {
			this.log(`Failed to spawn ${process.command}: ${error}`);
			this.retry(process);
			return;
		}
		process.child = child;
		process.closed = false;
		let resolve!: () => void;
		process.done = new Promise<void>((done) => {
			resolve = done;
		});
		const finished = () => {
			if (process.child !== child || process.closed) return;
			process.closed = true;
			resolve();
			this.retry(process);
		};
		child.stderr?.on("data", (data) => process.report(data.toString("utf8")));
		child.on("error", (error) => {
			this.log(`Child ${process.command}: ${error.message}`);
			if (child.pid === undefined) finished();
		});
		// Exit tracks the direct child even if a descendant keeps a pipe open.
		child.once("exit", finished);
		child.once("close", finished);
	}

	signal(command: string, signal: NodeJS.Signals) {
		if (!this.running) return;
		for (const process of this.processes) {
			if (process.command !== command || process.closed || !process.child)
				continue;
			try {
				process.child.kill(signal);
			} catch (error) {
				this.log(`Failed to signal ${command}: ${error}`);
			}
		}
	}

	private async terminate(process: StreamingProcess) {
		clearTimeout(process.restartTimer);
		const child = process.child;
		if (!process.closed && child) {
			const timeout = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch (error) {
					this.log(`Failed to terminate ${process.command}: ${error}`);
				}
			}, this.killTimeout);
			try {
				try {
					child.kill("SIGTERM");
				} catch (error) {
					this.log(`Failed to stop ${process.command}: ${error}`);
				}
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
		for (const process of this.processes) clearTimeout(process.restartTimer);
		this.stopping = Promise.resolve()
			.then(async () => {
				await Promise.all(
					[...this.processes]
						.filter((p) => p.command.endsWith("belacoder"))
						.map((p) => this.terminate(p)),
				);
				await Promise.all([...this.processes].map((p) => this.terminate(p)));
			})
			.finally(() => {
				this.stopping = undefined;
			});
		return this.stopping;
	}
}
