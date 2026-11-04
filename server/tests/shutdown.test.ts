import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
test("explicit shutdown awaits cleanup and preserves SIGTERM exit status", async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL("./fixtures/ipv6-shutdown.ts", import.meta.url)),
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(out).toBe("cleaned\n");
	expect(err).toBe("");
	expect(code).toBe(143);
});
