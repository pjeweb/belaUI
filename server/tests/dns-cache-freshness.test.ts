import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
for (const [name, fixture, message] of [
	[
		"mixed fresh and cached DNS answers retain fresh A records",
		"dns-mixed-cache.ts",
		"mixed DNS cache checks passed",
	],
	[
		"probe resolver accepts IPv6 literals without blocking IPv4 probes",
		"bcrpt-literal.ts",
		"probe literal checks passed",
	],
	[
		"remote cached AAAA works with bonding disabled and validates mixed fresh DNS",
		"remote-cache.ts",
		"remote cache checks passed",
	],
])
	test(name ?? "cache regression", async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
		expect(stdout).toBe(`${message}\n`);
	});
