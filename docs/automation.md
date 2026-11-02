# Branches and automation

`main` is the TypeScript development branch, including the upstream changes recorded in `.github/upstream.json`. The old `override` and `ws_nodejs` branches remain intact for historical work. In particular, historical `ws_nodejs` has fork-specific commits and is not overwritten.

`upstream/ws_nodejs` is a dedicated mirror of official `BELABOX/belaUI:ws_nodejs`. The weekly **Track upstream** workflow and its manual dispatch can create or fast-forward only this mirror. They refuse diverged history. If upstream is newer than `last_ported_commit`, one tracker issue links the official comparison. Translating the JavaScript changes into TypeScript and updating the baseline belongs in a reviewed PR; the tracker never replaces the port with upstream JavaScript.

## Pull requests and main

The **Checks** workflow runs for pull requests, pushes to `main`/`override`, and manual dispatch. Its checks also form the reusable release validation:

- **Workflow security:** pinned actionlint and pedantic zizmor validate GitHub Actions and Dependabot configuration. Zizmor emits annotations without needing security-event write permissions, including on fork PRs. One documented compatibility exception retains local reusable-workflow syntax understood by actionlint 1.7.12.
- **Lint and format:** the pinned Biome configuration checks source, formatting and the upstream tracker script.
- **TypeScript:** `tsc` checks the server, actual UI application and Vite configuration through Bun 1.2.3 scripts.
- **Tests:** device-free regression tests cover streaming, networking, UI state and upstream synchronization.
- **ARM64 build and package:** after those checks pass, the backend and production UI are assembled as `belaUI.tar.xz`, with `LICENSE` and `SHA256SUMS`. The `belaui-linux-arm64` artifact is retained for fourteen days.

Check jobs use read-only repository permissions and do not retain checkout credentials. Actions are pinned to commit SHAs. Dependabot checks action updates weekly with a seven-day cooldown. The upstream tracking job grants only contents/issue writes; it runs only on `main` and executes the reviewed tracker rather than upstream source.

## Releases

Push an explicit `vMAJOR.MINOR.PATCH` tag on a commit contained in `main` to publish a release. A hyphen suffix such as `-rc.1` is accepted and published as a prerelease, never as the latest stable release.

The **Release** workflow verifies tag syntax and `main` ancestry, calls the full reusable checks/build, then downloads the artifact from that same workflow run and verifies its checksums. Only the final publishing job receives contents-write permission. That job uploads the archive, license and checksums without executing project code or the binary. A normal branch push or PR does not publish a release or deploy to an encoder.

No extra repository secret is required. The built-in job token is sufficient for release publishing and mirror/tracker maintenance. The first real tag release still requires the documented hardware qualification; workflow setup does not establish device compatibility.

## Local checks

```sh
bun install --frozen-lockfile
bun run check
bun run build
actionlint
zizmor --offline --persona pedantic .
```

Use actionlint 1.7.12 and zizmor 1.31.1 to reproduce the workflow checks. The project pins Bun 1.2.3 and Biome 1.9.4; typechecking remains explicit rather than relying on transpilation.
