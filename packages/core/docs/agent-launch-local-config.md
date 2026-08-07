# Launcher Local Configuration

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the operator-owned launcher registry written by
`init-config`, the read-only argv defaults used by findings-only roles, and
the role-guard adoption contract for a consuming repository. Direct WK
dispatch itself is documented in
[agent-launch-quickstart.md](agent-launch-quickstart.md).

Write the default operator-owned launcher registry:

```bash
npm run agent-launch -- init-config
```

This creates the workspace-local launcher state under the active workspace
(the repository carrying the canonical `wiki/` + `docs/` markers):

- `<workspace>/.agent-launch/launchers.v1.json`
- `<workspace>/.agent-launch/role-guard-secret.key`
- `<workspace>/.agent-launch/role-guard-nonces/`

Launcher authority state is workspace-local (not a machine-global `~/.config`
location) so it persists across launcher/session restarts in runtimes where
the user `HOME` is ephemeral but the workspace persists. The `.agent-launch/`
directory is git-ignored. Resolution never consults `HOME`, `XDG_CONFIG_HOME`,
or `XDG_STATE_HOME`; the active workspace is the trusted launcher/MCP-supplied
workspace dir, or the repo root discovered from the process working directory.

The default profiles target:

- `claude` using the workstation-authenticated CLI plus prompt content over argv and stdout capture
- `codex exec` using prompt content over argv plus `-o <response_path>`

If an existing operator config still uses `["claude", "--bare"]`, rerun:

```bash
npm run agent-launch -- init-config --force
```

or update `base_argv` manually to `["claude"]`.

## Policy profiles and dispatch-readiness thresholds (optional)

Two optional launcher policy inputs — the Chassis Control Engine
org policy profile and the local source-available dispatch-readiness
policy-pack override — are documented in
[agent-launch-policy-profiles.md](agent-launch-policy-profiles.md).
Threshold verdicts are Chassis Control Engine-owned on the CCE path; after
decision the local/free path measures and forwards carrier facts but renders no
local admissibility threshold judgment. The source-available local policy-pack
override is retained only as inert config/evidence hygiene.

## Claude read-only argv

Redteam and code-review runs use the registry's `read_only.argv_suffix`. For
Claude, the default is:

```json
["--permission-mode", "default", "--disallowedTools", "Edit Write NotebookEdit"]
```

Earlier defaults used `["--permission-mode", "plan"]`, but Claude Code's plan mode submits its final content through the `ExitPlanMode` tool call. In non-interactive `--print` + `--output-format text` mode that tool call is not streamed to stdout, so the launcher would capture an empty response and silently mark the run `completed`. The launcher now fails closed on empty response bodies regardless, but operators should still move off `plan` to get useful findings output. If your existing operator config still uses `plan`, rerun `init-config --force` or update `read_only.argv_suffix` manually.

Managed implementation workers and findings-only reviewers also receive the real
Claude `Bash` tool through `permissions.allow` and `--allowedTools`; it is absent
from both deny layers. Codex receives its real `exec_command` surface. Bwrap, not
command parsing, confines worker repository reads to frozen `R union W` and writes
to `W`. Native WebFetch/WebSearch denials remain, but the current `shareNet:true`
posture means shell-visible network binaries can connect; network/proxy confinement
is separate work.

## Consuming repo role guard adoption

The shared role guard is adopted by each consuming repository; the launcher
package supplies the evaluator, config schema, CLI contract, and launcher-owned
role metadata, while the consuming repo supplies policy and hook installation.

A consuming repo:

- add a repo-owned `.agent-role-guard.json` policy file using the schema and
  launcher contract shipped with `agent-launch`
- update its `AGENTS.md` to describe `AGENT_ROLE`, `AGENT_WK`,
  `AGENT_OPERATOR_WRITE_SCOPE`, and the repo's worker `write_scope` rules
- require implementation `WK-*` records to carry exact `write_scope`
  frontmatter before workers modify files
- wire only adapter surfaces that can present a concrete candidate action to
  the guard, such as path lists, structured diffs, or raw argv with explicit
  provenance
- document every unimplemented adapter surface as unguarded

The role-guard CLI surface exposes check commands; repo hooks and
wrappers should invoke the relevant check command at the point where they
observe the candidate action:

- `agent-launch role-guard check-write` for explicit path lists
- `agent-launch role-guard check-diff` for structured create, modify, delete,
  rename, and copy payloads
- `agent-launch role-guard check-command` for raw argv command checks

Those checks must receive the repo root, config path, candidate action payload,
and explicit provenance for role, WK, operator write scope, and trusted context.
Ambient shell variables are transport only; they do not grant authority unless
the caller supplies an accepted trust source. Generic Codex and Claude hook
coverage is not provided by the shared tool until a consuming repo installs a
supported adapter with a documented payload and provenance row.
