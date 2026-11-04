import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("modem profile generation applies each family through the APN settings path", async () => {
	const fixture = fileURLToPath(
		new URL("./fixtures/ipv6-modem-profile.ts", import.meta.url),
	);
	const child = Bun.spawn([process.execPath, fixture], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
	expect(stdout).toBe("modem profile checks passed\n");
});

test("sender source file retains IPv4 and writes plain IPv6 fallback addresses", async () => {
	const fixture = fileURLToPath(
		new URL("./fixtures/ipv6-source-file.ts", import.meta.url),
	);
	const child = Bun.spawn([process.execPath, fixture], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
	expect(stdout).toBe("source file checks passed\n");
});

test("operator-profile copy preserves the configured IP family", async () => {
	const fixture = fileURLToPath(
		new URL("./fixtures/operator-ip-family.ts", import.meta.url),
	);
	const child = Bun.spawn([process.execPath, fixture], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
	expect(stdout).toBe("operator profile checks passed\n");
});
