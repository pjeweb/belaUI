# Upstream synchronization

This implementation targets official [BELABOX/belaUI `6659308`](https://github.com/BELABOX/belaUI/tree/665930824abd6e74638f4b4726b84fc9a88cfb60), using shared baseline `c7c39faa475b392b4212fbdbc0d52f264dff3984`. The twenty intervening upstream commits are accounted for below. This records source parity; device qualification is separate.

| Upstream commits | Behavior | Disposition |
|---|---|---|
| `4a1669c`, `d42ba56` | Slider locks, automatic relocking, dark-mode colors | Ported |
| `a9f7e9c` | BCRPT, relay RTT labels, protocol 15, incremental dropdown updates | Ported |
| `974c5c4` | Low-MTU detection and reduced encoder packet size | Ported; requires compatible executables |
| `24cdbf5` | Validation, configuration and asynchronous startup separation | Ported with explicit cancellation and process ownership |
| `c1f5ba6` | Saved autostart setting, boot retry, protocol 16 | Ported |
| `9a1ebfd` | Disable Wi-Fi scan while disconnected | Ported |
| `a42c042` | JavaScript semicolon | Already covered by TypeScript imports |
| `95a34b1`, `fb7f469` | Probe configuration retry and cached DNS | Ported |
| `20bd02d`, `7dc786d` | Suppress autostart on service restart; form overflow | Ported |
| `d516d33` | Rockchip audio aliases only on rk3588 | Ported |
| `a038bdc`, `5697c67`, `c69dac0`, `ea0d444` | Compact statistics, total first, optional layout, connection counts | Ported |
| `1ee2272`, `524f7d0` | Stable Action 6 and Pocket 4 audio names | Ported |
| `6659308` | Guard interfaces removed during gateway probes | Already covered |

## Preserved behavior and additional fixes

Local SRTLA destinations still use matching-subnet interfaces, including receivers reached through the encoder's hotspot. This selection is independent of whether that interface is enabled for WAN bonding. Duplicate-IP interfaces are excluded. WAN destinations use enabled, usable paths.

Manual startup fails before spawning when there are no eligible paths. During an active handover, an empty list is written and the sender is reloaded; the listener remains installed so later interface changes can recover it. Stop removes that listener and invalidates pending preparation without waiting for a resolver or file operation to finish. Admission remains locked until owned child shutdown and cleanup finish. Late success or failure belongs to its original attempt and cannot change a newer stream.

Each startup attempt generates pipeline files in its own temporary directory, removed after failed/cancelled preparation or child shutdown. Explicit WAN-interface exclusions survive discovery gaps by interface name for the service lifetime; accepted enable clears the exclusion. New names and service restarts retain the usual defaults. Discovery results cannot overwrite a newer successful snapshot; a pending or failed newer poll does not block useful results.

Invalid audio delay is rejected using the parsed result. Configuration validation is side-effect free, accepts numeric or decimal-string inputs, and keeps manual hostnames in saved settings for later DNS resolution. Audio preparation reports failures to its caller without inventing a WebSocket.

The process supervisor handles synchronous and asynchronous spawn errors and restarts, cancels all restart timers at Stop entry, stops the encoder before its sender, and escalates to SIGKILL after five seconds if a child does not exit. Shutdown observes direct-child exit even if another process holds its pipes open. Interface and bitrate reloads signal only owned children, continuing after individual signal failures. This does not supervise descendants or guarantee termination of kernel-uninterruptible tasks. Probe configuration updates are serialized and obsolete DNS results are discarded. Probe output supports split/coalesced JSON lines and rejects malformed or invalid-schema messages.

## Runtime requirements

- `bcrpt` is expected at `/usr/bin/bcrpt`, or under the directory configured by `setup.bcrpt_path`. It reads `/var/run/bcrpt/source_ips`, `server_ips`, and `key`; the service needs permission to maintain these files. The key file is written with mode 0600 and is never sent to browsers.
- The encoder must support the standalone `-r` option. A probe MTU below **1336** latches reduced packet sizing for subsequent encoder launches. The UI does not install or upgrade the encoder or probe binary.
- Probe targets are cleared while streaming and regenerated after Stop. Fresh DNS results are validated through the existing cache; cached results remain usable during a resolver outage.
- The default remote protocol is **16**. An explicit `setup.remote_protocol_version` override is preserved.
- Autostart is off unless the saved setting is explicitly true. Its UI asks for confirmation when enabling it. Invalid saved configurations are not retried; transient preparation failures are. Stop or a manual start cancels pending boot retries.
- `/tmp/belaui_restarted` suppresses autostart after a service crash, update or ordinary restart. The target OS must clear `/tmp` at cold boot. Enabling the setting takes effect on a subsequent cold boot, not an ordinary service restart.

## Validation

Use the pinned Bun 1.2.3 toolchain:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

`check` runs server and actual UI application/config typechecks, device-free regression tests, and pinned Biome checks. `build` compiles the Linux ARM64 backend, builds the UI and assembles `dist/`. CI runs the same checks and build. Generated binaries and UI bundles remain ignored.

Tests cover invalid input, start admission and cancellation, stale preparation success/errors across a newer start, pipeline cleanup, boot retries, boot/restart markers, local/hotspot routing, interface discovery ordering/exclusions, child restart and ordered/forced shutdown, scoped reload signals, probe payloads and reload races, split/invalid probe output, dropdown identity/selection and slider markup. Child-process controls include real harmless processes as well as synthetic event fixtures.

Before deployment on recoverable media, verify:

1. Installed OS, encoder, sender and probe versions, executable options and boot-cleared marker storage.
2. Cold boot online/offline, DNS-cache fallback, delayed audio, Stop during preparation and service/update restart.
3. Local/hotspot receivers and WAN targets across loss, replug, address changes and handover recovery.
4. Real probe RTT/MTU output and a reduced-MTU link, including the encoder's `-r` behavior.
5. Narrow/touch UI behavior, sliders and new audio-device rules on the relevant hardware.

Legacy Moblink integration remains a separate compatibility surface.
