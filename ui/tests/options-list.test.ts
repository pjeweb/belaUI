import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { RelaySelection } from "../src/modules/remote/relay-selection.ts";
import { reconcileOptions } from "../src/modules/ui/options-list.ts";

function select() {
	return parseHTML(
		"<html><body><select></select></body></html>",
	).document.querySelector("select") as unknown as HTMLSelectElement;
}

test("repeated RTT labels preserve option node identity and selected value", () => {
	const element = select();
	reconcileOptions(element, [{ a: { name: "A" }, b: { name: "B" } }], "b");
	const before = Array.from(element.children);
	reconcileOptions(
		element,
		[{ a: { name: "A (30 ms)" }, b: { name: "B (50 ms)" } }],
		"b",
	);
	expect(Array.from(element.children)).toEqual(before);
	expect(element.value).toBe("b");
	expect(element.children[1]?.textContent).toBe("B (50 ms)");
});

test("option reconciliation handles reorder, removal, disable and punctuation in ids", () => {
	const element = select();
	reconcileOptions(
		element,
		[{ "a.b:c": { name: "Special" }, gone: { name: "Gone" } }],
		"a.b:c",
	);
	const special = element.children[0];
	reconcileOptions(
		element,
		[{ new: { name: "New" }, "a.b:c": { name: "Disabled", disabled: true } }],
		"a.b:c",
	);
	expect(element.children.length).toBe(2);
	expect(element.children[1]).toBe(special);
	expect((element.children[1] as HTMLOptionElement).disabled).toBe(true);
	expect(element.querySelector('[value="gone"]')).toBeNull();
});

const relays = {
	servers: { cloud: { name: "Cloud", default: true } },
	accounts: { account: { name: "Account" } },
};
const saved = { relay_server: "cloud", relay_account: "account" };
test("config-before-relays initialization restores saved cloud selection", () => {
	const state = new RelaySelection();
	expect(state.update(saved, null).server).toBe("manual");
	const restored = state.update(saved, relays);
	expect(restored.server).toBe("cloud");
	expect(restored.account).toBe("account");
});
test("frequent relay updates preserve unsaved user choices until config changes", () => {
	const state = new RelaySelection();
	state.update(saved, relays);
	state.select("manual", "manual");
	expect(state.update(saved, relays).server).toBe("manual");
	expect(state.update(saved, null).server).toBe("cloud");
});
test("removed saved account is disabled and restored when it becomes available", () => {
	const state = new RelaySelection();
	const missing = state.update(saved, { ...relays, accounts: {} });
	expect(missing.account).toBe("unavailable");
	expect(missing.accounts[1]?.unavailable?.disabled).toBe(true);
	expect(state.update(saved, relays).account).toBe("account");
});

test("each slider has its own lock button inside its nearest form group", async () => {
	const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
	const document = parseHTML(html).document;
	for (const id of ["bitrateSlider", "delaySlider", "srtLatencySlider"]) {
		const group = document.getElementById(id)?.closest(".form-group");
		expect(group?.querySelectorAll(".button-slider-lock-unlock").length).toBe(
			1,
		);
		expect(group?.querySelectorAll(".slider").length).toBe(1);
	}
	expect(
		document
			.getElementById("pipelines")
			?.closest(".form-group")
			?.classList.contains("row"),
	).toBe(false);
});
