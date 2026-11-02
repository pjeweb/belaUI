const { readFileSync } = require("node:fs");

const source = { owner: "BELABOX", repo: "belaUI" };
const branch = "ws_nodejs";
const mirrorBranch = "upstream/ws_nodejs";
const marker = "<!-- belaui-upstream-tracker -->";
const title = "Port latest upstream belaUI changes";

module.exports = async function syncUpstream(
	{ github, context, core },
	baseline,
) {
	const { owner, repo } = context.repo;
	const ported =
		baseline ??
		JSON.parse(readFileSync(".github/upstream.json", "utf8"))
			.last_ported_commit;
	if (!/^[0-9a-f]{40}$/.test(ported))
		throw new Error("Invalid last ported upstream commit");
	const { data: upstream } = await github.rest.git.getRef({
		...source,
		ref: `heads/${branch}`,
	});
	const latest = upstream.object.sha;
	const { data: changes } = await github.rest.repos.compareCommitsWithBasehead({
		...source,
		basehead: `${ported}...${latest}`,
	});
	if (!["ahead", "identical"].includes(changes.status))
		throw new Error(
			"Upstream history moved behind or diverged from the ported baseline",
		);
	let mirror;
	try {
		({ data: mirror } = await github.rest.git.getRef({
			owner,
			repo,
			ref: `heads/${mirrorBranch}`,
		}));
	} catch (error) {
		if (error.status !== 404) throw error;
		await github.rest.git.createRef({
			owner,
			repo,
			ref: `refs/heads/${mirrorBranch}`,
			sha: latest,
		});
	}
	if (mirror && mirror.object.sha !== latest) {
		const { data: comparison } =
			await github.rest.repos.compareCommitsWithBasehead({
				owner,
				repo,
				basehead: `${mirror.object.sha}...${latest}`,
			});
		if (comparison.status !== "ahead")
			throw new Error("Upstream mirror diverged; refusing to overwrite it");
		await github.rest.git.updateRef({
			owner,
			repo,
			ref: `heads/${mirrorBranch}`,
			sha: latest,
			force: false,
		});
	}
	const issues = await github.paginate(github.rest.issues.listForRepo, {
		owner,
		repo,
		state: "open",
		per_page: 100,
	});
	const existing = issues.find(
		(issue) =>
			!issue.pull_request &&
			issue.user?.type === "Bot" &&
			issue.body?.includes(marker),
	);
	if (ported === latest) {
		if (existing)
			await github.rest.issues.update({
				owner,
				repo,
				issue_number: existing.number,
				state: "closed",
			});
		core.info("The TypeScript port is current with official upstream.");
		return;
	}
	const body = `${marker}\nThe official upstream has ${changes.ahead_by} commits after the last ported baseline. The \`${mirrorBranch}\` mirror has been fast-forwarded.\n\n- Last ported: BELABOX/belaUI@${ported}\n- Latest: BELABOX/belaUI@${latest}\n- Compare: https://github.com/BELABOX/belaUI/compare/${ported}...${latest}\n\nReview and translate the changes into the TypeScript modules on \`main\`, preserve local receiver/handover behavior, run CI, then update \`.github/upstream.json\` in the same PR. This tracker does not merge JavaScript source into the port automatically.`;
	if (existing) {
		if (existing.body !== body)
			await github.rest.issues.update({
				owner,
				repo,
				issue_number: existing.number,
				title,
				body,
			});
	} else await github.rest.issues.create({ owner, repo, title, body });
};
