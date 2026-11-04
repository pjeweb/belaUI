import { expect, test } from "bun:test";
import {
	Ipv6Router,
	defaultForDevice,
} from "../modules/network/ipv6-routing.ts";
const a = { address: "2001:db8::2", device: "wan0" };
const b = { address: "2001:db8:1::2", device: "wan1" };
function kernel() {
	const rules = new Map<number, string>();
	const routes = new Set<number>();
	const calls: string[][] = [];
	let failDevice: string | undefined;
	let failRemove = false;
	const router = new Ipv6Router(async (args) => {
		calls.push(args);
		if (args[0] === "-j")
			return JSON.stringify(
				args.includes("rule")
					? []
					: [
							{ dev: "wan0", gateway: "2001:db8::1" },
							{ dev: "wan1", gateway: "2001:db8:1::1" },
						],
			);
		const table = Number(args.at(-1));
		if (args.includes("replace")) {
			if (args.includes(failDevice ?? "never")) throw new Error("timeout");
			routes.add(table);
		}
		if (args.includes("add"))
			rules.set(table, args[args.indexOf("from") + 1] ?? "");
		if (args.includes("del")) {
			if (failRemove) throw new Error("permission denied");
			if (!rules.delete(table))
				throw Object.assign(new Error("No such file or directory"), {
					code: "ENOENT",
				});
		}
		if (args.includes("flush") && !routes.delete(table))
			throw Object.assign(new Error("No such process"), { code: "ESRCH" });
		return "";
	});
	return {
		router,
		rules,
		routes,
		calls,
		setFail: (device?: string) => {
			failDevice = device;
		},
		setFailRemove: (value: boolean) => {
			failRemove = value;
		},
	};
}
test("failed second route is never reported installed and retries before Stop", async () => {
	const k = kernel();
	k.setFail("wan1");
	expect(await k.router.update([a, b])).toEqual(new Set([a.address]));
	expect(k.rules.size).toBe(1);
	expect(k.routes.size).toBe(1);
	k.setFail();
	const before = k.calls.length;
	expect(await k.router.update([a, b])).toEqual(
		new Set([a.address, b.address]),
	);
	expect(
		k.calls
			.slice(before)
			.some(
				(args) => args.includes("add") && args.includes(`${b.address}/128`),
			),
	).toBe(true);
	await k.router.update([]);
	expect(k.rules.size).toBe(0);
	expect(k.routes.size).toBe(0);
});
test("missing rules and routes are already removed", async () => {
	const k = kernel();
	await k.router.update([a]);
	k.rules.clear();
	k.routes.clear();
	expect(await k.router.update([])).toEqual(new Set());
	expect(await k.router.update([a])).toEqual(new Set([a.address]));
});
test("failed cleanup remains cleanup work rather than an installed source", async () => {
	const k = kernel();
	await k.router.update([a]);
	k.setFailRemove(true);
	expect(await k.router.update([])).toEqual(new Set());
	expect(await k.router.update([a])).toEqual(new Set());
	k.setFailRemove(false);
	expect(await k.router.update([a])).toEqual(new Set([a.address]));
});
test("refresh restores a default route removed by the kernel", async () => {
	const k = kernel();
	await k.router.update([a]);
	k.routes.clear();
	await k.router.update([a]);
	expect(k.routes.size).toBe(1);
	expect(k.rules.size).toBe(1);
	expect(k.calls.filter((args) => args.includes("add"))).toHaveLength(1);
});
test("multipath default chooses the gateway on the source device", () => {
	const defaults = [
		{
			metric: 200,
			nexthops: [
				{ dev: "wan0", gateway: "2001:db8::1" },
				{ dev: "wan1", gateway: "2001:db8:1::1" },
			],
		},
	];
	expect(defaultForDevice(defaults, "wan1")).toEqual({
		gateway: "2001:db8:1::1",
		metric: 200,
	});
	expect(defaultForDevice(defaults, "wan2")).toBeUndefined();
});
test("IPv4-only empty routing updates execute no commands", async () => {
	const k = kernel();
	await k.router.update([]);
	await k.router.update([]);
	expect(k.calls).toEqual([]);
});
test("routing imports install no signal or exit handlers", async () => {
	const before = ["SIGINT", "SIGTERM", "exit"].map((name) =>
		process.listenerCount(name),
	);
	await import(`../modules/network/ipv6-routing.ts?isolated=${Date.now()}`);
	expect(
		["SIGINT", "SIGTERM", "exit"].map((name) => process.listenerCount(name)),
	).toEqual(before);
});

test("gateway cleanup conflicts retain ownership until Stop removes every table", async () => {
	let gateway = "2001:db8::1";
	let fail = false;
	const rules = new Set<number>();
	const tables = new Set<number>();
	const router = new Ipv6Router(async (args) => {
		if (args[0] === "-j")
			return JSON.stringify(
				args.includes("rule") ? [] : [{ dev: "wan0", gateway }],
			);
		const table = Number(args.at(-1));
		if (args.includes("add")) rules.add(table);
		if (args.includes("replace")) tables.add(table);
		if (args.includes("del")) {
			if (fail) throw new Error("permission denied");
			rules.delete(table);
		}
		if (args.includes("flush")) {
			if (fail) throw new Error("permission denied");
			tables.delete(table);
		}
		return "";
	});
	await router.update([a]);
	gateway = "2001:db8::3";
	fail = true;
	await router.update([a]);
	await router.update([a]);
	fail = false;
	await router.update([]);
	expect(rules.size).toBe(0);
	expect(tables.size).toBe(0);
});
test("policy tables include connected prefixes before the gateway default", async () => {
	const { planIpv6Routing } = await import(
		"../modules/network/ipv6-routing-plan.ts"
	);
	const plan = planIpv6Routing(
		[],
		[{ ...a, gateway: "2001:db8::1", prefixes: ["2001:db8::/64"] }],
	);
	expect(plan.commands[0]).toEqual([
		"-6",
		"route",
		"replace",
		"2001:db8::/64",
		"dev",
		"wan0",
		"table",
		"20000",
	]);
	expect(plan.commands[1]?.[3]).toBe("default");
	expect(plan.commands.at(-1)?.[1]).toBe("rule");
});

test("connected policy prefixes are replaced when the interface prefix changes", async () => {
	const { planIpv6Routing } = await import(
		"../modules/network/ipv6-routing-plan.ts"
	);
	const old = planIpv6Routing(
		[],
		[{ ...a, gateway: "2001:db8::1", prefixes: ["2001:db8::/64"] }],
	);
	const changed = planIpv6Routing(old.routes, [
		{ ...a, gateway: "2001:db8::1", prefixes: ["2001:db8::/80"] },
	]);
	expect(changed.routes[0]?.table).not.toBe(old.routes[0]?.table);
	expect(changed.commands[0]?.[3]).toBe("2001:db8::/80");
	expect(changed.commands.at(-1)).toEqual([
		"-6",
		"route",
		"flush",
		"table",
		"20000",
	]);
});

test("missing IPv6 FIB tables do not prevent installation after recovery", async () => {
	let fail = true;
	const router = new Ipv6Router(async (args) => {
		if (args[0] === "-j")
			return JSON.stringify(
				args.includes("rule") ? [] : [{ dev: "wan0", gateway: "2001:db8::1" }],
			);
		if (args.includes("replace") && fail) throw new Error("route timeout");
		if (args.includes("flush"))
			throw Object.assign(new Error("ip failed"), {
				code: 2,
				stderr: "Error: ipv6: FIB table does not exist.",
			});
		if (args.includes("del"))
			throw Object.assign(new Error("No such process"), { code: 2 });
		return "";
	});
	expect(await router.update([a])).toEqual(new Set());
	fail = false;
	expect(await router.update([a])).toEqual(new Set([a.address]));
});
