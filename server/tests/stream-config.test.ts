import { describe, expect, test } from "bun:test";
import {
	type ValidationContext,
	validateStreamConfig,
} from "../modules/streaming/config-validation.ts";

const context: ValidationContext = {
	pipeline: (id) =>
		id === "camera" ? { path: "/test/camera", asrc: true, acodec: true } : null,
	audioDevices: { USB: "usbaudio" },
	audioCodecs: { opus: "Opus" },
	savedAudioSource: "Missing",
};
const valid = {
	delay: 0,
	srt_latency: 2000,
	max_br: 5000,
	pipeline: "camera",
	asrc: "USB",
	acodec: "opus",
	srtla_addr: "receiver.invalid",
	srtla_port: 5000,
	srt_streamid: "",
};

describe("stream configuration admission", () => {
	test("normalizes numeric/string inputs without mutating the request or resolving its hostname", () => {
		const input = {
			...valid,
			delay: "-2000",
			srtla_addr: " receiver.invalid ",
		};
		const result = validateStreamConfig(input, context);
		expect(result.config.delay).toBe(-2000);
		expect(result.config.srtla_addr).toBe("receiver.invalid");
		expect(result.srtlaPort).toBe(5000);
		expect(input.srtla_addr).toBe(" receiver.invalid ");
	});
	test("accepts both audio-delay boundaries", () => {
		for (const delay of [-2000, 2000])
			expect(
				validateStreamConfig({ ...valid, delay }, context).config.delay,
			).toBe(delay);
	});
	test("rejects missing, fractional, malformed and out-of-range delays", () => {
		for (const delay of [
			undefined,
			null,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"",
			"12oops",
			0.5,
			-2001,
			2001,
			{},
			[],
		]) {
			expect(() => validateStreamConfig({ ...valid, delay }, context)).toThrow(
				"audio delay",
			);
		}
	});
	test("validates bitrate and latency before runtime changes", () => {
		for (const max_br of [undefined, "5000oops", 299, 12001, Number.NaN])
			expect(() => validateStreamConfig({ ...valid, max_br }, context)).toThrow(
				"bitrate",
			);
		for (const srt_latency of [99, 10001, "100x"])
			expect(() =>
				validateStreamConfig({ ...valid, srt_latency }, context),
			).toThrow("latency");
	});
	test("retains saved audio selection while absent, but rejects an unknown new source", () => {
		expect(
			validateStreamConfig({ ...valid, asrc: "Missing" }, context).config.asrc,
		).toBe("Missing");
		expect(() =>
			validateStreamConfig({ ...valid, asrc: "Other" }, context),
		).toThrow("audio source");
	});
	test("uses cloud endpoints/account keys and excludes unused manual settings", () => {
		const result = validateStreamConfig(
			{ ...valid, relay_server: "relay", relay_account: "account" },
			{
				...context,
				relays: {
					servers: { relay: { addr: "cloud.invalid", port: 6000 } },
					accounts: { account: { ingest_key: "synthetic-key" } },
				},
			},
		);
		expect(result.srtlaAddr).toBe("cloud.invalid");
		expect(result.streamid).toBe("synthetic-key");
		expect(result.config.srtla_addr).toBeUndefined();
		expect(result.config.srt_streamid).toBeUndefined();
	});
	test("rejects invalid pipeline and codec choices and non-object requests", () => {
		for (const input of [
			null,
			[],
			"bad",
			{ ...valid, pipeline: "missing" },
			{ ...valid, acodec: "toString" },
		])
			expect(() => validateStreamConfig(input, context)).toThrow();
	});
});
