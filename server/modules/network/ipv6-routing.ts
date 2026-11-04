import { execFileP } from "../../helpers/exec.ts";
import { logger } from "../../helpers/logger.ts";
import {
	type DesiredSource,
	IPV6_ROUTING_BASE,
	IPV6_ROUTING_LIMIT,
	type SourceRoute,
	planIpv6Routing,
	removeSourceRoute,
} from "./ipv6-routing-plan.ts";

export type RouteExecutor = (args: string[]) => Promise<string>;
type DefaultRoute = {
	dev?: string;
	gateway?: string;
	metric?: number;
	nexthops?: Array<{ dev: string; gateway?: string }>;
};
export function defaultForDevice(defaults: DefaultRoute[], device: string) {
	return defaults
		.flatMap((route) => [
			...(route.dev === device
				? [{ gateway: route.gateway, metric: route.metric }]
				: []),
			...(route.nexthops ?? [])
				.filter((hop) => hop.dev === device)
				.map((hop) => ({ gateway: hop.gateway, metric: route.metric })),
		])
		.sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0))[0];
}
function alreadyRemoved(error: unknown) {
	const e = error as { code?: string; stderr?: string; message?: string };
	return (
		e?.code === "ENOENT" ||
		e?.code === "ESRCH" ||
		/No such (?:file or directory|process)|FIB table does not exist/.test(
			e?.stderr ?? e?.message ?? "",
		)
	);
}
/** Owns only completed installations; failed partial installations remain cleanup work. */
export class Ipv6Router {
	private current: SourceRoute[] = [];
	private pendingCleanup: SourceRoute[] = [];
	private recovered = false;
	constructor(
		private execute: RouteExecutor,
		private log: (error: unknown) => void = () => {},
	) {}
	private async remove(source: SourceRoute) {
		let failed = false;
		for (const args of removeSourceRoute(source)) {
			try {
				await this.execute(args);
			} catch (error) {
				if (!alreadyRemoved(error)) {
					this.log(error);
					failed = true;
				}
			}
		}
		return !failed;
	}
	private async recover() {
		if (this.recovered) return;
		const rules = JSON.parse(
			await this.execute(["-j", "-6", "rule", "show"]),
		) as Array<{ src?: string; table?: number; priority?: number }>;
		for (const rule of rules) {
			const table = Number(rule.table);
			if (
				table >= IPV6_ROUTING_BASE &&
				table < IPV6_ROUTING_LIMIT &&
				table === rule.priority &&
				rule.src
			) {
				const source = {
					address: rule.src.replace(/\/128$/, ""),
					device: "",
					table,
				};
				if (!(await this.remove(source))) this.pendingCleanup.push(source);
			}
		}
		this.recovered = true;
	}
	async update(
		sources: Array<{ address: string; device: string; prefixes?: string[] }>,
	) {
		if (!sources.length && !this.current.length && !this.pendingCleanup.length)
			return new Set<string>();
		if (sources.length) await this.recover();
		const pending: SourceRoute[] = [];
		for (const source of this.pendingCleanup)
			if (!(await this.remove(source))) pending.push(source);
		this.pendingCleanup = pending;
		const defaults = sources.length
			? (JSON.parse(
					await this.execute(["-j", "-6", "route", "show", "default"]),
				) as DefaultRoute[])
			: [];
		const desired: DesiredSource[] = sources.flatMap((source) => {
			const route = defaultForDevice(defaults, source.device);
			return route ? [{ ...source, gateway: route.gateway }] : [];
		});
		// Reserve incomplete removals too, so their tables cannot be re-used prematurely.
		const plan = planIpv6Routing(
			[...this.current, ...this.pendingCleanup],
			desired,
		);
		const installed: SourceRoute[] = [];
		for (const source of plan.routes) {
			if (
				this.pendingCleanup.some(
					(p) => p.table === source.table || p.address === source.address,
				)
			)
				continue;
			const commands = plan.commands.filter(
				(args) =>
					args.includes(String(source.table)) &&
					args[2] !== "del" &&
					args[2] !== "flush",
			);
			try {
				for (const args of commands) await this.execute(args);
				installed.push(source);
			} catch (error) {
				this.log(error);
				if (!(await this.remove(source))) this.pendingCleanup.push(source);
			}
		}
		for (const old of this.current)
			if (!installed.includes(old) && !(await this.remove(old)))
				this.pendingCleanup.push(old);
		this.current = installed;
		return new Set(
			installed
				.filter(
					(source) =>
						!this.pendingCleanup.some((p) => p.address === source.address),
				)
				.map((s) => s.address),
		);
	}
}
const router = new Ipv6Router(
	async (args) => (await execFileP("ip", args, { timeout: 2000 })).stdout,
	(error) => logger.error(error),
);
export const updateIpv6Routing = (
	sources: Array<{ address: string; device: string; prefixes?: string[] }>,
) => router.update(sources);
