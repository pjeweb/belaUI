export type NetworkInterface = {
	ip?: string;
	netmask?: string;
	tp: number;
	txb: number;
	enabled: boolean;
	error: number;
};

/** Retains user exclusions across discovery gaps for this service lifetime. */
export class InterfaceState {
	interfaces: Record<string, NetworkInterface> = {};
	private excluded = new Set<string>();
	private poll = 0;
	private appliedPoll = 0;

	beginPoll() {
		return ++this.poll;
	}

	acceptPoll(poll: number) {
		if (poll <= this.appliedPoll) return false;
		this.appliedPoll = poll;
		return true;
	}

	isEnabled(name: string) {
		return !this.excluded.has(name) && (this.interfaces[name]?.enabled ?? true);
	}

	setEnabled(name: string, enabled: boolean) {
		if (enabled) this.excluded.delete(name);
		else this.excluded.add(name);
		const current = this.interfaces[name];
		if (current) current.enabled = enabled;
	}
}
