import { describe, expect, it } from "bun:test";
import { InterfaceState } from "../modules/network/interface-state.ts";

function connection(ip = "192.0.2.1") {
	return {
		ip,
		netmask: "255.255.255.0",
		tp: 0,
		txb: 0,
		enabled: true,
		error: 0,
	};
}

describe("interface discovery state", () => {
	it("stores discovered names without a prototype", () => {
		expect(Object.getPrototypeOf(new InterfaceState().interfaces)).toBeNull();
	});
	for (const name of ["__proto__", "constructor", "toString"]) {
		it(`rejects inherited interface name ${name} without changing its prototype`, () => {
			const state = new InterfaceState();
			state.interfaces = { cell0: connection() };
			const inherited = Reflect.get(state.interfaces, name);
			const before = Object.getOwnPropertyDescriptor(inherited, "enabled");
			try {
				expect(state.getInterface(name)).toBeUndefined();
				expect(state.setEnabled(name, false)).toBe(false);
				const after = Object.getOwnPropertyDescriptor(inherited, "enabled");
				if (before) expect(after).toEqual(before);
				else expect(after).toBeUndefined();
				expect(state.isEnabled(name)).toBe(true);
			} finally {
				if (before) Object.defineProperty(inherited, "enabled", before);
				else Reflect.deleteProperty(inherited, "enabled");
			}
		});
	}
	it("allows a discovered own interface whose name matches a prototype property", () => {
		const state = new InterfaceState();
		Object.defineProperty(state.interfaces, "__proto__", {
			value: connection(),
			enumerable: true,
		});
		expect(state.setEnabled("__proto__", false)).toBe(true);
		expect(state.getInterface("__proto__")?.enabled).toBe(false);
		expect(Object.getPrototypeOf(state.interfaces)).toBeNull();
	});
	it("preserves explicit exclusion through disappearance and an address change", () => {
		const state = new InterfaceState();
		state.interfaces = { cell0: connection() };
		state.setEnabled("cell0", false);
		state.interfaces = {};
		expect(state.isEnabled("cell0")).toBe(false);
		state.interfaces = {
			cell0: { ...connection("192.0.2.2"), enabled: state.isEnabled("cell0") },
		};
		expect(state.interfaces.cell0?.enabled).toBe(false);
		state.setEnabled("cell0", true);
		state.interfaces = {};
		expect(state.isEnabled("cell0")).toBe(true);
	});
	it("keeps automatic errors separate from user exclusions", () => {
		const state = new InterfaceState();
		state.interfaces = { wifi0: { ...connection(), enabled: false, error: 1 } };
		expect(state.isEnabled("wifi0")).toBe(false);
		state.interfaces = {};
		expect(state.isEnabled("wifi0")).toBe(true);
		expect(state.isEnabled("new0")).toBe(true);
	});
	it("rejects older discovery callbacks after a newer successful snapshot", () => {
		const state = new InterfaceState();
		const first = state.beginPoll();
		const second = state.beginPoll();
		expect(state.acceptPoll(second)).toBe(true);
		expect(state.acceptPoll(first)).toBe(false);
		expect(state.acceptPoll(second)).toBe(false);
	});
	it("accepts success while a newer poll is pending or has failed", () => {
		const state = new InterfaceState();
		const first = state.beginPoll();
		const second = state.beginPoll();
		expect(state.acceptPoll(first)).toBe(true);
		expect(state.acceptPoll(second)).toBe(true);
		const third = state.beginPoll();
		state.beginPoll(); // This request fails, so it never supplies a snapshot.
		expect(state.acceptPoll(third)).toBe(true);
	});
	it("does not carry user exclusions across a service restart", () => {
		const first = new InterfaceState();
		first.interfaces.cell0 = connection();
		first.setEnabled("cell0", false);
		expect(first.isEnabled("cell0")).toBe(false);
		expect(new InterfaceState().isEnabled("cell0")).toBe(true);
	});
});
