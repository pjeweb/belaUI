import { isIP } from "node:net";

// Reserved for belaUI IPv6 sources only: tables and priorities 20000–20999.
// IPv4 dispatcher tables and rules are untouched (all operations specify -6).
export const IPV6_ROUTING_BASE = 20000;
export const IPV6_ROUTING_LIMIT = 21000;
export type SourceRoute = {
	address: string;
	device: string;
	gateway?: string;
	prefixes?: string[];
	table: number;
};
export type DesiredSource = Omit<SourceRoute, "table">;
export type RoutingPlan = { commands: string[][]; routes: SourceRoute[] };
function valid(source: DesiredSource) {
	return (
		isIP(source.address) === 6 &&
		!source.address.includes("%") &&
		/^[a-zA-Z0-9_.:-]+$/.test(source.device) &&
		(!source.gateway || isIP(source.gateway) === 6) &&
		(source.prefixes ?? []).every((prefix) => {
			const [address, length] = prefix.split("/");
			return (
				!!address &&
				isIP(address) === 6 &&
				length !== undefined &&
				/^\d+$/.test(length) &&
				Number(length) <= 128
			);
		})
	);
}
export function removeSourceRoute(source: SourceRoute) {
	return [
		[
			"-6",
			"rule",
			"del",
			"from",
			`${source.address}/128`,
			"lookup",
			String(source.table),
			"priority",
			String(source.table),
		],
		["-6", "route", "flush", "table", String(source.table)],
	];
}
export function planIpv6Routing(
	current: SourceRoute[],
	desired: DesiredSource[],
): RoutingPlan {
	const routes: SourceRoute[] = [];
	const commands: string[][] = [];
	const used = new Set(current.map((s) => s.table));
	for (const source of desired) {
		if (!valid(source)) throw new Error("Invalid IPv6 source route");
		if (routes.some((r) => r.address === source.address)) continue;
		const old = current.find(
			(r) =>
				r.address === source.address &&
				r.device === source.device &&
				r.gateway === source.gateway &&
				JSON.stringify(r.prefixes ?? []) ===
					JSON.stringify(source.prefixes ?? []),
		);

		let table = old?.table ?? IPV6_ROUTING_BASE;
		while (!old && used.has(table) && table < IPV6_ROUTING_LIMIT) table++;
		if (table === IPV6_ROUTING_LIMIT)
			throw new Error("IPv6 source routing range exhausted");
		used.add(table);
		const route = old ?? { ...source, table };
		routes.push(route);
		for (const prefix of source.prefixes ?? [])
			commands.push([
				"-6",
				"route",
				"replace",
				prefix,
				"dev",
				source.device,
				"table",
				String(table),
			]);
		commands.push([
			"-6",
			"route",
			"replace",
			"default",
			...(source.gateway ? ["via", source.gateway] : []),
			"dev",
			source.device,
			"table",
			String(table),
		]);
		if (!old)
			commands.push([
				"-6",
				"rule",
				"add",
				"from",
				`${source.address}/128`,
				"lookup",
				String(table),
				"priority",
				String(table),
			]);
	}
	for (const old of current)
		if (!routes.includes(old)) commands.push(...removeSourceRoute(old));
	return { commands, routes };
}
