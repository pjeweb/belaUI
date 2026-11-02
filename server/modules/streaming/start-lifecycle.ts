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

export type StartHooks<Params, Validated, Ready> = {
	isUpdating(): boolean;
	status(active: boolean): void;
	validate(params: Params): Validated;
	prepare(
		config: Validated,
		signal: AbortSignal,
		automatic: boolean,
	): Promise<Ready>;
	launch(ready: Ready): void;
	stop(): Promise<void>;
	error(error: unknown, automatic: boolean, params: Params): void;
};

/** Owns start admission, cancellation and retry timers across manual and boot starts. */
export class StreamLifecycle<Params, Validated, Ready> {
	private state: "idle" | "starting" | "running" | "stopping" = "idle";
	private controller?: AbortController;
	private pending?: Promise<boolean>;
	private stopping?: Promise<void>;
	private retry?: ReturnType<typeof setTimeout>;
	private retryAllowed = false;

	constructor(
		private hooks: StartHooks<Params, Validated, Ready>,
		private retryMs = 1000,
	) {}

	cancelAutostart() {
		this.retryAllowed = false;
		clearTimeout(this.retry);
		this.retry = undefined;
	}

	start(params: Params, automatic = false): Promise<boolean> {
		if (!automatic) this.cancelAutostart();
		if (this.state !== "idle" || this.hooks.isUpdating())
			return Promise.resolve(false);
		if (automatic) this.retryAllowed = true;
		this.state = "starting";
		this.hooks.status(true);
		const controller = new AbortController();
		this.controller = controller;
		const pending = this.run(params, controller.signal, automatic);
		this.pending = pending;
		return pending;
	}

	private async run(params: Params, signal: AbortSignal, automatic: boolean) {
		let validated = false;
		let started = false;
		try {
			const config = this.hooks.validate(params);
			validated = true;
			const ready = await this.hooks.prepare(config, signal, automatic);
			signal.throwIfAborted();
			this.hooks.launch(ready);
			this.state = "running";
			started = true;
		} catch (error) {
			if (!signal.aborted) {
				await this.hooks.stop();
				this.hooks.error(error, automatic, params);
			}
		} finally {
			if (this.state !== "stopping") {
				this.controller = undefined;
				this.pending = undefined;
				if (!started) {
					this.state = "idle";
					this.hooks.status(false);
					if (automatic && validated && this.retryAllowed && !signal.aborted) {
						this.retry = setTimeout(() => {
							this.retry = undefined;
							void this.start(params, true);
						}, this.retryMs);
					}
				}
			}
		}
		return started;
	}

	stop(): Promise<void> {
		this.cancelAutostart();
		if (this.state === "stopping") return this.stopping ?? Promise.resolve();
		if (this.state === "idle") return Promise.resolve();
		this.state = "stopping";
		this.controller?.abort();
		this.stopping = (async () => {
			await this.pending;
			await this.hooks.stop();
			this.controller = undefined;
			this.pending = undefined;
			this.state = "idle";
			this.hooks.status(false);
		})();
		return this.stopping;
	}
}
