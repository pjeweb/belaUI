import { expect, test } from "bun:test";
import syncUpstream from "../../.github/scripts/sync-upstream.cjs";

const ported = "a".repeat(40);
const latest = "b".repeat(40);
function fixture({
	current = ported,
	baseline = ported,
	upstream = latest,
	mirrorStatus = "ahead",
	missingMirror = false,
	issue = undefined as
		| { number: number; body: string; user: { type: string } }
		| undefined,
} = {}) {
	const mutations: Array<{ type: string; values: Record<string, unknown> }> =
		[];
	const github = {
		rest: {
			git: {
				getRef: async ({ owner, ref }: { owner: string; ref: string }) => {
					if (owner !== "BELABOX" && missingMirror)
						throw Object.assign(new Error("missing mirror"), { status: 404 });
					expect(ref).toBe(
						owner === "BELABOX"
							? "heads/ws_nodejs"
							: "heads/upstream/ws_nodejs",
					);
					return {
						data: { object: { sha: owner === "BELABOX" ? upstream : current } },
					};
				},
				createRef: async (values: Record<string, unknown>) => {
					mutations.push({ type: "createRef", values });
				},
				updateRef: async (values: Record<string, unknown>) => {
					mutations.push({ type: "ref", values });
				},
			},
			repos: {
				compareCommitsWithBasehead: async ({ owner }: { owner: string }) => ({
					data: {
						status:
							owner === "BELABOX"
								? baseline === upstream
									? "identical"
									: "ahead"
								: mirrorStatus,
						ahead_by: 2,
					},
				}),
			},
			issues: {
				listForRepo: () => {},
				create: async (values: Record<string, unknown>) => {
					mutations.push({ type: "create", values });
				},
				update: async (values: Record<string, unknown>) => {
					mutations.push({ type: "update", values });
				},
			},
		},
		paginate: async () => (issue ? [issue] : []),
	};
	return {
		run: () =>
			syncUpstream(
				{
					github,
					context: { repo: { owner: "example", repo: "encoder" } },
					core: { info: () => {} },
				},
				baseline,
			),
		mutations,
	};
}

test("fast-forwards the mirror without force and opens a tracker for untranslated changes", async () => {
	const f = fixture();
	await f.run();
	expect(f.mutations.map((value) => value.type)).toEqual(["ref", "create"]);
	expect(f.mutations[0]?.values.force).toBe(false);
	expect(f.mutations[0]?.values.ref).toBe("heads/upstream/ws_nodejs");
	expect(f.mutations[1]?.values.body).toContain(`${ported}...${latest}`);
});
test("refuses a diverged mirror without creating an issue or overwriting history", async () => {
	const f = fixture({ mirrorStatus: "diverged" });
	await expect(f.run()).rejects.toThrow("refusing to overwrite");
	expect(f.mutations).toEqual([]);
});
test("does not change an up-to-date mirror and closes a completed bot tracker", async () => {
	const f = fixture({
		baseline: latest,
		current: latest,
		issue: {
			number: 10,
			body: "<!-- belaui-upstream-tracker -->",
			user: { type: "Bot" },
		},
	});
	await f.run();
	expect(f.mutations).toEqual([
		{
			type: "update",
			values: {
				owner: "example",
				repo: "encoder",
				issue_number: 10,
				state: "closed",
			},
		},
	]);
});
test("does not overwrite a human issue with the same marker", async () => {
	const f = fixture({
		current: latest,
		issue: {
			number: 10,
			body: "<!-- belaui-upstream-tracker -->",
			user: { type: "User" },
		},
	});
	await f.run();
	expect(f.mutations[0]?.type).toBe("create");
});
test("updates one existing bot tracker rather than creating duplicate notifications", async () => {
	const f = fixture({
		current: latest,
		issue: {
			number: 10,
			body: "<!-- belaui-upstream-tracker --> old baseline",
			user: { type: "Bot" },
		},
	});
	await f.run();
	expect(f.mutations.length).toBe(1);
	expect(f.mutations[0]?.type).toBe("update");
	expect(f.mutations[0]?.values.issue_number).toBe(10);
});

test("creates only the dedicated mirror when it does not exist", async () => {
	const f = fixture({ missingMirror: true });
	await f.run();
	expect(f.mutations[0]).toEqual({
		type: "createRef",
		values: {
			owner: "example",
			repo: "encoder",
			ref: "refs/heads/upstream/ws_nodejs",
			sha: latest,
		},
	});
});
