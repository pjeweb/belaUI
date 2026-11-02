import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootAutostart } from "../modules/streaming/boot-autostart.ts";

test("cold boot starts once; service crash/update restarts do not start again", () => {
	const directory = mkdtempSync(join(tmpdir(), "belaui-boot-test-"));
	const marker = join(directory, "restarted");
	let starts = 0;
	try {
		bootAutostart(
			true,
			() => {
				starts++;
			},
			marker,
		);
		bootAutostart(
			true,
			() => {
				starts++;
			},
			marker,
		);
		expect(starts).toBe(1);
		rmSync(marker);
		bootAutostart(
			true,
			() => {
				starts++;
			},
			marker,
		);
		expect(starts).toBe(2);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("enabling autostart after this service boot takes effect on the next cold boot", () => {
	const directory = mkdtempSync(join(tmpdir(), "belaui-boot-test-"));
	const marker = join(directory, "restarted");
	let starts = 0;
	try {
		bootAutostart(
			false,
			() => {
				starts++;
			},
			marker,
		);
		bootAutostart(
			true,
			() => {
				starts++;
			},
			marker,
		);
		expect(starts).toBe(0);
	} finally {
		rmSync(directory, { recursive: true });
	}
});
