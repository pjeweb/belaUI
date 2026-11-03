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
		first.setEnabled("cell0", false);
		expect(new InterfaceState().isEnabled("cell0")).toBe(true);
	});
});
