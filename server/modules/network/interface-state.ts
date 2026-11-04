import type { InterfaceAddress } from "./interface-discovery.ts";

export type NetworkInterface = {
	ipv6?: string;
	addresses?: InterfaceAddress[];
	ip?: string;
	netmask?: string;
	tp: number;
	txb: number;
	enabled: boolean;
	error: number;
};

/** Retains user exclusions across discovery gaps for this service lifetime. */
export class InterfaceState {
	interfaces: Record<string, NetworkInterface> = Object.create(null);
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
		return (
			!this.excluded.has(name) && (this.getInterface(name)?.enabled ?? true)
		);
	}

	getInterface(name: string) {
		return Object.hasOwn(this.interfaces, name)
			? this.interfaces[name]
			: undefined;
	}

	setEnabled(name: string, enabled: boolean) {
		const current = this.getInterface(name);
		if (!current) return false;
		if (enabled) this.excluded.delete(name);
		else this.excluded.add(name);
		current.enabled = enabled;
		return true;
	}
}

export function interfaceSourceChanged(
	previous: NetworkInterface | undefined,
	next: NetworkInterface,
) {
	return (
		!previous ||
		previous.ip !== next.ip ||
		previous.ipv6 !== next.ipv6 ||
		JSON.stringify(previous.addresses?.filter((a) => a.family === "inet6")) !==
			JSON.stringify(next.addresses?.filter((a) => a.family === "inet6"))
	);
}
