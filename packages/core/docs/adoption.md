# Set up AgentChassis in a repository

Use the [README installation steps](../README.md#install) in a new or existing
Git repository. Existing code and root agent guidance do not prevent setup.
Setup does not automatically merge instructions or migrate every obsolete
AgentChassis state.

## Preserve root guidance

Setup never creates, reads, modifies, or deletes root `AGENTS.md` or `CLAUDE.md`.
It seeds `wiki/templates/AGENTS.md.boilerplate.md` for you to review:

- If root `AGENTS.md` is absent, create it from the template. Otherwise, add only
  missing AgentChassis guidance to your existing instructions. Preserve existing
  content and reconcile conflicting rules; do not append the entire template
  again on reruns.
- For Claude, add `@AGENTS.md` on its own line in root `CLAUDE.md` only if that
  include is missing. Create the file if needed. Keep all existing instructions;
  the file does not have to contain only the include.

`AGENTS.md` holds repository policy. Generic role guides ship in
`@agent-chassis/agent-launch-core` and reach sessions through launcher startup
prompts.

## What setup and reruns do

Setup runs static wiki bootstrap, creates `agent-launch.toml` from the selected
CLI template only when absent, initializes the launcher registry, and checks
local test runtimes. Review existing launcher defaults yourself; setup does not
replace them. See the [quickstart](quickstart.md) for configuration and
[local runtime setup](local-test-runtime-setup.md) for dependency corrections.

The packaged choices are `--agent claude`, `--agent codex`, `--agent opencode`
and `--agent agy`. Explicit selection skips harness detection. Exactly one
detected CLI selects automatically; several prompt interactively. Without a TTY,
absent or ambiguous detection prints explicit recovery choices and skips the
TOML copy. `--dry-run` creates no TOML. Existing mixed-family role selections
remain byte-for-byte unchanged.

Registered model examples are `opus` for Claude, `gpt-5.6-sol` for Codex,
`google-vertex/gemini-3.8-flash` for OpenCode (`medium`), and
`gemini-3.8-flash-low` for Agy (`low`). The new-family templates enable
`high_priority_role_guide = true` for orchestrator, worker, reviewer and redteam.
OpenCode requires `rg` on `PATH` and direct Vertex authentication: set
`GOOGLE_APPLICATION_CREDENTIALS` in the launch environment to an existing
service-account JSON file with `project_id`. TOML `[vertexai] credentials_file`
alone does not configure this route. Agy requires its installed, authenticated
native CLI. OpenCode still refuses schema-constrained workers with
`opencode_native_schema_unavailable`; setup support does not provide complete
paid-CCE worker support.

Ordinary setup calls `init-config` unconditionally. Its existing owner refuses
an already present registry; setup does not force, reset or merge it. Preserve
that registry and use `npx agent-chassis setup --test-runtimes` to finish or
repeat the runtime step. Preserving TOML does not prove full rerun success.

Bootstrap preserves existing `wiki/schema.md`, `wiki/conventions.md`, and
`wiki/index.md`, and retains local vocabulary and inference-path entries in
`wiki/.wiki-contract.json`. It refreshes generated wiki views, templates, local
workspace metadata, and caches, and adds required ignore entries. A rerun is not
a no-op; review the diff before committing.

Fresh bootstrap creates canonical `wiki/initiatives/IN-0001.json` as an
in-progress placeholder and generates its Markdown projection. On rerun, it
preserves a valid existing canonical `IN-0001.json` and regenerates the projection
from it. It creates no `WK-0001`; that identifier remains available for the first
real work record.

## Obsolete or invalid AgentChassis state

Installing into an existing code repository is different from migrating obsolete
AgentChassis records. Bootstrap refuses an invalid canonical `IN-0001.json`. It
also refuses an `IN-0001.md` projection without its canonical JSON and reports
migration guidance. It does not convert that Markdown automatically. Follow the
reported correction and the [versioning policy](versioning.md); do not assume a
setup rerun will convert arbitrary older state.

There is no adoption-verification gate or intermediate adoption work record.
After reviewing and committing setup, start an interactive session:

```sh
npx agent-launch orchestrator IN-0001
```

Use the placeholder to define your first objective. If `IN-0001` already contains
your work, continue from its existing context. A code index is optional;
[quickstart](quickstart.md#4-review-and-commit-setup) describes when to build one.
