
# Per-Family Launcher Runtime State

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the runtime-state facts for the supported Codex and Claude
families, the four runtime-state classes used to describe them, and the explicit
fail-closed Agy posture. The launcher lifecycle is converged; supported-family
runtime state remains family-specific.

## Family Runtime State

The launcher **lifecycle** is converged — one shared
`superviseChildLaunch` child supervision / bounded capture / final-result path
used by supported families on the launcher-owned in-process path.
Runtime state is **not** converged. Codex's private `CODEX_HOME` and Claude's
credential/config mount are app-specific runtime facts, not a shared runtime-state
implementation. Agy has no supported confined executor or registration adapter;
the shared interface refuses it before launch and does not provision Gemini state.

The shared part is the **vocabulary** used to classify per-family state, not a
shared code path. Each family's runtime state falls into one of four classes:

- **operator-owned source** — per-user state the operator
  authenticated/installed on the host; the launcher reads it (directly or by
  read-only mount/symlink) but never writes it.
- **launcher-owned per-run** — transient state the launcher mints per launch
  under its own runtime base; isolated per worker and safe to delete.
- **read-only mount** — host paths exposed to the worker bwrap namespace
  read-only (`--ro-bind-try`), never `--bind`.
- **writable runtime state** — host paths the worker may write during the run.

### Per-family runtime state

**Codex** (`setupCodexRuntimeHome`, `codex-role.mjs`):

- The launcher mints a private `CODEX_HOME` (`<runtime-base>/codex-home`) per
  launch under the runtime base (`CODEX_ORCH_RUNTIME_DIR` for orchestrated
  dispatch, otherwise the per-repo `runtimeDirFor` path). This is
  launcher-owned per-run state.
- Per-user source state is exposed by **symlink** from the operator source
  home into that private home, read-through by intent: `auth.json`,
  `version.json`, `models_cache.json`, `config.toml`, `skills`, `memories`,
  `sessions`. The source home is `CODEX_SOURCE_HOME` when set and non-empty,
  otherwise `~/.codex` (operator-owned source).
- Writable per-run directories created in the private home: `log`, `sessions`,
  `tmp`, `shell_snapshots`, `rules` (launcher-owned per-run). `sessions` is the
  one overlap: it is symlinked from the source home when that source exists and
  is otherwise created as a per-run directory.
- **Result source is `finalPath`**: the final answer is read from `final.md`
  under `<CODEX_HOME>/tmp/<run-dir>/`, written via Codex
  `--output-last-message`. This `finalPath` / private-`CODEX_HOME` pair is a
  kept Codex-specific fact, not permission to keep a separate launcher
  lifecycle or capture pipeline.

**Claude** (`workspace-agent-dispatch-claude-executor.mjs`):

The Claude executor's runtime paths are **derived from launcher-owned
host-home facts**, not a fixed `/home/user` prefix. The launcher
reads the host user home from a trusted source (the OS passwd entry for the
effective user via `os.userInfo().homedir`, never caller-supplied `HOME`,
`XDG_*`, inline env, or `PATH` manipulation) and derives the narrow runtime
facts below from it, so a macOS host home such as `/Users/<user>` or a
non-default Linux home such as `/home/<user>` yields equivalent narrow
approvals. The `$HOME` / `~` notation below is explanatory shorthand for that
launcher-owned operator host home; it is not an agent-provided policy input.

- The worker bwrap exposes the OAuth credential file
  `~/.claude/.credentials.json` as a single read-only leaf-file bind
  (`--ro-bind-try <file> <file>`), drawn from a closed allowlist
  (`CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES`) — operator-owned source,
  read-only mount.
- The versioned Claude install directory (`~/.local/share/claude`,
  `CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS`) is bound read-only so the binary is
  reachable, and the executable resolves under `~/.local/bin/claude`.
- Runtime approval stays narrow: the broad host home (`$HOME`), the `~/.claude`
  directory itself, `~/.config` (including `~/.config/gcloud`), and credential
  parent directories such as `~/gcp-credentials` are **never** mounted, even
  though the narrow runtime leaves above resolve under that host home.
- **Result source is `stdout`**.

**Agy**:

Agy is unsupported for confined worker, reviewer, redteam, and orchestrator
launches. Selection fails closed before model spawn. The launcher creates no
wiki-MCP transport, repository write bind, Gemini credential/config bind, broad
`~/.gemini` writable state, or result-capture lifecycle for Agy. Future support
must reuse the same host-server and named-FIFO conduit interface; it cannot add a
second transport.

### State-class summary

| Family | operator-owned source | launcher-owned per-run | writable runtime state | result source |
| --- | --- | --- | --- | --- |
| Codex | `CODEX_SOURCE_HOME` (`~/.codex`) entries symlinked read-through | private `CODEX_HOME` = `<runtime-base>/codex-home` (`log`/`sessions`/`tmp`/`shell_snapshots`/`rules`, `final.md`) | per-run dirs inside the private `CODEX_HOME` | `finalPath` (`--output-last-message`) |
| Claude | `~/.claude/.credentials.json`, `~/.local/share/claude` (read-only, host-home-derived) | run dir (stdout capture) | none in family-runtime mounts | `stdout` |
| Agy | unsupported | none | none | none; launch fails closed |

In this table `~` / `$HOME` denotes the launcher-owned operator host home that
the launcher discovers from trusted host facts (macOS `/Users/<user>`, Linux
`/home/<user>`); it is platform-neutral explanatory notation, not a fixed
`/home/user` path and not an agent-provided `HOME`/`XDG`/`PATH` value. The
launcher derives the narrow runtime leaves above from that host home and
refuses the broad host home and credential/config parents.

### Codex source-home assumptions

The Codex source home is resolved from `CODEX_SOURCE_HOME` (when set and
non-empty) or `~/.codex`. The symlinked name-set above is hardcoded and
**unvalidated**: a non-default Codex install that does not present those exact
names under the source home gets a private `CODEX_HOME` missing the
corresponding symlink, with no structured setup blocker. A stable
setup-blocker for non-default installs (validating the expected source-home
name-set and refusing with a structured diagnostic) is **not** implemented by
this docs/tests slice and must be split into a code slice after the
`codex-role.mjs` seam extraction — docs and tests alone do not implement it.

### Forbidden-token naming constraint

Do not introduce structured launch fields (launch-plan keys, work-record
fields, or run-status fields) whose names contain the literal `CODEX_HOME` or
`codex_home_overlay`. Those tokens can trip forbidden-token scans tied to the
removed prelude overlay. Documenting the env var `CODEX_HOME` in prose
(as above) is fine; minting a JSON field named after it is not.
