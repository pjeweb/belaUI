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
	launch(ready: Ready, signal: AbortSignal): void | Promise<void>;
	dispose?(ready: Ready): Promise<void>;
	stop(): Promise<void>;
	error(error: unknown, automatic: boolean, params: Params): void;
};

/** Owns start admission, cancellation and retry timers across manual and boot starts. */
export class StreamLifecycle<Params, Validated, Ready> {
	private state: "idle" | "starting" | "running" | "stopping" = "idle";
	private controller?: AbortController;
	private ready?: Ready;
	private stopping?: Promise<void>;
	private retry?: ReturnType<typeof setTimeout>;
	private retryAllowed = false;
	private attempt = 0;

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
		if (this.state !== "idle" || this.stopping || this.hooks.isUpdating())
			return Promise.resolve(false);
		if (automatic) this.retryAllowed = true;
		const controller = new AbortController();
		this.controller = controller;
		this.state = "starting";
		this.hooks.status(true);
		return this.run(params, controller, automatic, ++this.attempt);
	}

	private async run(
		params: Params,
		controller: AbortController,
		automatic: boolean,
		attempt: number,
	) {
		const signal = controller.signal;
		let validated = false;
		try {
			const config = this.hooks.validate(params);
			validated = true;
			const ready = await this.hooks.prepare(config, signal, automatic);
			if (signal.aborted || this.controller !== controller) {
				await this.hooks.dispose?.(ready);
				return false;
			}
			this.ready = ready;
			await this.hooks.launch(ready, signal);
			if (signal.aborted || this.controller !== controller) return false;
			this.state = "running";
			return true;
		} catch (error) {
			if (signal.aborted || this.controller !== controller) return false;
			const stopping = this.finish(controller);
			try {
				this.hooks.error(error, automatic, params);
			} finally {
				await stopping;
			}
			if (
				automatic &&
				validated &&
				this.retryAllowed &&
				!signal.aborted &&
				this.attempt === attempt
			) {
				this.retry = setTimeout(() => {
					this.retry = undefined;
					void this.start(params, true).catch((error) =>
						console.error("Stream retry failed", error),
					);
				}, this.retryMs);
			}
			return false;
		}
	}

	private finish(controller: AbortController): Promise<void> {
		if (this.stopping) return this.stopping;
		this.state = "stopping";
		const stopping = Promise.resolve()
			.then(() => this.hooks.stop())
			.finally(async () => {
				const ready = this.ready;
				this.ready = undefined;
				try {
					if (ready !== undefined) await this.hooks.dispose?.(ready);
				} finally {
					if (this.controller === controller) {
						this.controller = undefined;
						this.state = "idle";
						this.hooks.status(false);
					}
				}
			})
			.finally(() => {
				if (this.stopping === stopping) this.stopping = undefined;
			});
		this.stopping = stopping;
		return stopping;
	}

	stop(): Promise<void> {
		this.cancelAutostart();
		const controller = this.controller;
		if (!controller) return Promise.resolve();
		controller.abort();
		return this.finish(controller);
	}
}
