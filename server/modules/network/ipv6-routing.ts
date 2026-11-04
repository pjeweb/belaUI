import { execFileSync } from "../../helpers/exec.ts";
import {
	IPV6_ROUTING_BASE,
	IPV6_ROUTING_LIMIT,
	type SourceRoute,
	planIpv6Routing,
} from "./ipv6-routing-plan.ts";

let current: SourceRoute[] = [];
let recovered = false;
function recover() {
	if (recovered) return;
	const rules = JSON.parse(execute(["-j", "-6", "rule", "show"])) as Array<{
		src?: string;
		table?: number;
		priority?: number;
	}>;
	for (const rule of rules) {
		const table = Number(rule.table);
		if (
			table >= IPV6_ROUTING_BASE &&
			table < IPV6_ROUTING_LIMIT &&
			table === rule.priority &&
			rule.src
		) {
			execute([
				"-6",
				"rule",
				"del",
				"from",
				rule.src,
				"lookup",
				String(table),
				"priority",
				String(table),
			]);
			execute(["-6", "route", "flush", "table", String(table)]);
		}
	}
	recovered = true;
}
function execute(args: string[]) {
	return execFileSync("ip", args, {
		encoding: "utf8",
		timeout: 2000,
		stdio: ["ignore", "pipe", "pipe"],
	});
}
// Complete routing before publishing the source file or signalling the sender.
export function updateIpv6Routing(
	sources: Array<{ address: string; device: string }>,
) {
	if (!sources.length && !current.length) return new Set<string>();
	if (sources.length) recover();
	const defaults = sources.length
		? (JSON.parse(execute(["-j", "-6", "route", "show", "default"])) as Array<{
				dev: string;
				gateway?: string;
				metric?: number;
			}>)
		: [];
	const desired = sources.flatMap((source) => {
		const route = defaults
			.filter((r) => r.dev === source.device)
			.sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0))[0];
		return route ? [{ ...source, gateway: route.gateway }] : [];
	});
	const plan = planIpv6Routing(current, desired);
	try {
		for (const args of plan.commands) execute(args);
		current = plan.routes;
	} catch (error) {
		// Retain partial state for shutdown and the next attempt.
		current = [
			...new Map(
				[...current, ...plan.routes].map((r) => [r.table, r]),
			).values(),
		];
		cleanup();
		throw error;
	}
	return new Set(desired.map((s) => s.address));
}
function cleanup() {
	const failed = new Set<number>();
	for (const args of planIpv6Routing(current, []).commands) {
		try {
			execute(args);
		} catch {
			failed.add(Number(args[args.length - 1]));
		}
	}
	current = current.filter((r) => failed.has(r.table));
}
process.once("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => {
		cleanup();
		process.exit(0);
	});
