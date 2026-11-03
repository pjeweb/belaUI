import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("reserved interface names survive response serialization and toggles", async () => {
	// Isolate module mocks from the streaming tests while exercising the real handlers.
	const fixture = fileURLToPath(
		new URL("./fixtures/network-interface-message.ts", import.meta.url),
	);
	const child = Bun.spawn([process.execPath, fixture], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(stdout).toBe("network response and toggle checks passed\n");
});
