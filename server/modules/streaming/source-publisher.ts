/** Coalesces handovers and refreshes; a superseded update never publishes stale sources. */
export class SourcePublisher {
	private latest: string[] = [];
	private closed = false;
	private revision = 0;
	private running?: Promise<void>;
	private lastList?: string;
	constructor(
		private io: {
			route(addresses: string[]): Promise<Set<string>>;
			write(contents: string): Promise<void>;
			signal(): void;
			log(error: unknown): void;
		},
	) {}
	shutdown() {
		this.closed = true;
		return this.enqueue([]);
	}
	update(addresses: string[]) {
		if (this.closed) return this.running ?? Promise.resolve();
		return this.enqueue(addresses);
	}
	private enqueue(addresses: string[]) {
		if (
			this.running &&
			addresses.length === this.latest.length &&
			addresses.every((address, index) => address === this.latest[index])
		)
			return this.running;
		this.latest = [...addresses];
		this.revision++;
		if (!this.running) {
			this.running = this.drain().finally(() => {
				this.running = undefined;
			});
		}
		return this.running;
	}
	private async drain() {
		let applied = 0;
		while (applied !== this.revision) {
			applied = this.revision;
			const addresses = this.latest;
			let routed = new Set<string>();
			try {
				routed = await this.io.route(addresses);
			} catch (error) {
				this.io.log(error);
			}
			if (applied !== this.revision) continue;
			const usable = addresses.filter((a) => !a.includes(":") || routed.has(a));
			const list = usable.length ? `${usable.join("\n")}\n` : "";
			if (list !== this.lastList) {
				try {
					await this.io.write(list);
				} catch (error) {
					this.lastList = undefined;
					if (applied !== this.revision) {
						this.io.log(error);
						continue;
					}
					throw error;
				}
				this.lastList = applied === this.revision ? list : undefined;
				if (applied === this.revision) this.io.signal();
			}
		}
	}
}
