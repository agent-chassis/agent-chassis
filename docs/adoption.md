# Adoption Flow

This document describes how a new or existing repository should adopt the shared wiki contract.

## New Repository Adoption

1. Consume this repository in a form that preserves access to the shared `packages/wiki-core/contract/` directory and preferred interface layer.
2. Choose the appropriate repo profile:
   - `standard` for app/library/engine repos that use `docs/`
   - `research` for research-corpus repos that keep durable synthesis in typed wiki namespaces
3. From the target repo root, run the repo's documented bootstrap command.
   For a normal operational adoption, first install the core package as a dev
   dependency:
   `npm install --save-dev @agent-chassis/core`.
   Then run `npx wiki bootstrap --profile <profile>` after the registry mapping
   and token setup in [docs/local-package-install.md](local-package-install.md).
   The zero-install form
   `npx -p @agent-chassis/wiki-cli wiki bootstrap --profile <profile>` is
   bootstrap-only and does not pin the local MCP server or launcher entrypoints.
   Bootstrap
   defaults the repo identifier to the target directory basename; pass
   `--repo <id>` only when an explicit override is needed.
   Treat that one-line bootstrap as static setup and instruction seeding only:
   it copies the shared adoption guidance, seeds the target repo's owned
   `IN-0001` work, prepares cache/ignore scaffolding, generates the gitignored
   repo-local `wiki/.wiki-mcp.json` workspace declaration, and builds the initial
   lexical wiki search index. It does not write global MCP client config, and it
   does not otherwise configure or verify the target repo's MCP transport,
   dispatch, graph-impact, graph-backed code index, preflight, or readiness
   state.
4. If the repo uses typed extension namespaces, declare them during bootstrap or sync with `--extensions orgs,people,...`.
5. Commit the created core surfaces and synced templates.
   The bootstrap is idempotent and non-overwriting: if `IN-0001`, seeded work records, or repo-specific edits already exist, rerunning it preserves those artifacts and only fills in missing bootstrap surfaces.
6. Write or update the consumer-owned repo guidance:
   - `wiki/schema.md`
   - `wiki/conventions.md`
   - `wiki/index.md`
   - any repo-local extension schema docs or core-surface `README.md` files
7. Add repo-local `AGENTS.md` guidance that tells agents to use wiki/docs retrieval first. Start from the bootstrap-seeded `wiki/templates/AGENTS.md.boilerplate.md` helper template (a local install helper, not operating authority).
8. Declare any local `topics` and repo-local `docs/**` inference defaults in `wiki/.wiki-contract.json`.
   The target repo owns the seeded `IN-0001` work and must run its own setup and verification from its own context after bootstrap seeding.
9. Make sure those local docs describe the adopted runtime and repo-specific operating choices, not a stale bootstrap state.
10. Start creating records with `wiki create <type> <title>`.
11. Author retrieval facets narrowly:
   - rely on path and template defaults for `canonicality`, `maintenance_mode`, `knowledge_role`, and default `retrieval_role`
   - author `topics`, `lifecycle`, `retrieval_visibility`, and `evidence_stage` only where repo-local judgment is needed
12. Run `wiki lint` and `wiki sync-contract --check` in CI to keep the repo aligned with the shared contract.
13. Add `wiki build-search-index` and `wiki search` scripts/checks when the repo
    wants to refresh and exercise shared retrieval tooling after wiki content
    changes. Bootstrap creates the initial lexical search index.

The supported install path is the packaged `@agent-chassis` tooling described
in [docs/local-package-install.md](local-package-install.md). Consuming
repositories install `@agent-chassis/core` (or the underlying packages
individually) rather than depending on a local `file:` checkout of this
repository.

For agent-heavy consumers, the preferred steady state is to point the MCP client
at the installed `wiki-mcp` binary and let agents call structured wiki tools
rather than shelling out through the CLI.

Important operational note:

- this is a spawned-per-session `stdio` MCP integration
- consuming repos do not need to host or maintain a network service
- the MCP client simply launches the local command when needed

## One-Line Bootstrap: Static IN-0001 Seeding

The one-line bootstrap is a single operator command run from the new repo root.
Use the installed local CLI for normal operational adoption:

```bash
npx wiki bootstrap --profile <profile>
```

The bootstrap-only zero-install package path from
[docs/local-package-install.md](local-package-install.md) is:

```bash
npx -p @agent-chassis/wiki-cli wiki bootstrap --profile <profile>
```

If the repo has installed `@agent-chassis/wiki-cli` as a dev dependency and
added the recommended `wiki` script, use:

```bash
npm run wiki -- bootstrap --profile <profile>
```

When `--repo` is omitted, bootstrap defaults the repo identifier to the target
directory basename. Pass `--repo <id>` only when the repo needs a different
identifier.

Treat it as **static setup and instruction seeding only**. It copies the shared
adoption surfaces, writes the target repo's own `IN-0001` adoption plan from a
repo-neutral seed contract (`wiki-bootstrap-seed.v1`, defined in
`packages/wiki-core/src/index.mjs`), prepares local cache/ignore scaffolding,
generates the gitignored repo-local `wiki/.wiki-mcp.json` workspace declaration,
and builds the initial lexical wiki search index. It does **not** write global
MCP client config, and it does **not** otherwise configure, invoke, or verify
the target repo's MCP transport, dispatch, graph-impact, graph-backed code
index, coordination preflight, or readiness state. After seeding, the target
repo owns running every check itself, from its own context.

### What bootstrap seeds

Bootstrap writes these surfaces when they are missing (`create_if_missing`):

- `wiki/schema.md` — consumer-owned core schema guidance
- `wiki/conventions.md` — consumer-owned operating conventions
- `wiki/index.md` — consumer-owned wiki index guidance
- `wiki/catalog.md` — top-level retrieval entrypoint
- `wiki/initiatives/IN-0001.md` — the owned adoption plan
- `docs/adoption.md` — the operator adoption guide, rendered from the
  `packages/wiki-core/templates/adoption.md.template.md` package template with
  the repo identifier substituted in. Unlike the other create-if-missing core
  surfaces, it is a repo-adapted operator guide, and a customized copy is
  preserved on rerun.

Bootstrap also syncs the record templates and the
`wiki/templates/AGENTS.md.boilerplate.md` install helper into `wiki/templates/`
on every run (refreshed to track the installed package). The boilerplate helper
is a template to review/adapt when authoring the repo's own `AGENTS.md` — it is
not repo-local operating authority, and bootstrap never creates the root
`AGENTS.md`, so root `AGENTS.md` may not exist yet after bootstrap.

`wiki/.wiki-contract.json` is resynced on every bootstrap run. It is written
unconditionally, but any user-authored `vocab.topics.local` entries and
`inference.paths` defaults from the previous version are preserved.

Bootstrap also creates local generated-artifact prerequisites:

- `.cache/wiki-search/`
- `.cache/repo-code-index/`
- `wiki/.wiki-mcp.json` — the generated, gitignored repo-local wiki-mcp
  workspace declaration (schema `wiki-mcp-workspace.v1`). Bootstrap regenerates
  it on every run: it refreshes `current.root` to the resolved repo directory
  and preserves an existing operator `current.alias`. It is a local artifact,
  not a committed wiki surface, and is listed here alongside the other generated
  artifacts rather than among the committed core surfaces above.
- idempotent root `.gitignore` entries for those cache paths and for
  `wiki/.wiki-mcp.json`
- the initial lexical search index at `.cache/wiki-search/index.json`

Because `wiki/.wiki-mcp.json` is gitignored, `git add wiki` does not stage it;
only the new `.gitignore` entry is committed. Do not commit the declaration.

`AGENTS.md` is **not** written by bootstrap. Authoring it is recommended
operator first-run setup — agents benefit from the repo-local operating
contract — but a missing root `AGENTS.md` is reported as non-gating advisory
context and does not by itself block launching the seeded `IN-0001`
orchestrator.

`docs/adoption.md` **is** written by bootstrap — it is rendered from the
`adoption.md.template.md` package template using `create_if_missing` semantics,
so a fresh repo starts with a repo-adapted operator guide and a customized copy
is preserved on rerun. The `adoption-verify` review confirms its presence
informationally.

The seeded `IN-0001` separates the work the target repo **authors** from the
read-only checks the `WK-0001#adoption-verify` review **confirms**. The two are
not the same, and the read-only verification checks are **not** dispatchable
worker tasks.

**Required read-only verification checks — performed by the
`WK-0001#adoption-verify` review, not dispatched workers (`required_checks`):**

- wiki search/read/get-record checks
- work-record load/validate/dispatch-readiness checks
- generate/lint validation
- read-only graph-impact checks (no graph-evidence persistence)
- dispatch/preflight verification

Before launching the seeded `IN-0001` orchestrator, complete these first-run
steps. Launcher config is a required dispatch-preflight prerequisite; the others
are recommended advisory context:

1. **Add repo-local AGENTS guidance (recommended)** — review/adapt
   `wiki/templates/AGENTS.md.boilerplate.md` into root `AGENTS.md` and replace
   placeholders with repo-local structured tool and retrieval details. A missing
   root `AGENTS.md` is advisory and does not block adoption verify on its own.
2. **Install launcher config** — copy or review the detected
   `agent-launch.<claude-or-codex>.toml` template to `agent-launch.toml`, run
   `agent-launch init-config`, and review/commit the bootstrap-created files.
3. **Document local adoption choices** — bootstrap seeds `docs/adoption.md` from a
   package template (create-if-missing) covering the bootstrap path, package
   install, and adoption-verify usage. Optionally customize that seeded guide with
   repo-specific operating notes; do not author it from scratch.

The five read-only verification checks above are **not** seeded as owned work and
must **not** be dispatched as implementation workers. The single findings-only
`WK-0001#adoption-verify` review slice runs `wiki adoption verify`, which
exercises all five read-only checks (wiki-retrieval, work-records, generate-lint,
graph-impact, and dispatch-preflight) and confirms the bootstrap-generated
`wiki/.wiki-mcp.json` declaration as non-gating informational context. The
graph-impact check is read-only and persists no graph evidence to any work
record. See [After Seeding: Required Next Steps](#after-seeding-required-next-steps)
for how a coordinator records the verification result.

If adoption verify reports `operator_first_run_prerequisites_missing` for
launcher config (`agent-launch.toml` role defaults or `.agent-launch`
init-config), hold orchestrator launch until it is resolved: run
`npx agent-chassis setup`, rerun adoption verify, and proceed after required
checks pass. A missing root `AGENTS.md` is reported as non-gating advisory
context instead of a blocker — recommend reviewing/adapting
`wiki/templates/AGENTS.md.boilerplate.md` into root `AGENTS.md`.

The seed contract in `packages/wiki-core/templates/IN-0001.adoption-seed.json`
(rendered by `packages/wiki-core/src/index.mjs`) remains the authoritative source
for this content; the list above is the operator-facing synthesis.

### Idempotency and non-overwrite

Bootstrap is idempotent and non-destructive. Rerunning it on a repo that already
has `IN-0001`, seeded work, or repo-specific edits:

- does not duplicate the `IN-0001` initiative or its seeded work,
- preserves repo-specific edits to seeded files,
- does not clobber existing canonical records, and
- only fills in bootstrap surfaces that are still missing.

### Non-goals

The bootstrap explicitly does **not**:

- invoke MCP, dispatch, graph impact, preflight, or repo-code-index operations
  against the target repo,
- claim the target repo is fully agent-operable after seeding,
- overwrite repo-specific edits or silently clobber existing canonical records,
- require duplicate `IN-0001` or duplicate seeded work when rerun.

### After Seeding: Required Next Steps

Bootstrap writes wiki core surfaces, seeds `IN-0001` adoption work, generates the
gitignored repo-local `wiki/.wiki-mcp.json` declaration, and seeds
`docs/adoption.md` from a package template. The seeded `WK-0001` tracker is
review-only: it carries the single findings-only `adoption-verify` review slice
and no worker-owned implementation setup slices. `AGENTS.md`, launcher config,
`wiki/.wiki-mcp.json`, and `docs/adoption.md` are not `WK-0001` implementation
slices. `adoption verify` checks launcher setup as an operator first-run
prerequisite, and confirms `AGENTS.md` presence, `wiki/.wiki-mcp.json`, and
`docs/adoption.md` informationally:

**1. AGENTS.md (recommended)** — bootstrap does not create `AGENTS.md`.
Configuring it is recommended repo-local operating context; a missing root
`AGENTS.md` is advisory and does not block adoption verify:

1. Read the bootstrap-seeded `wiki/templates/AGENTS.md.boilerplate.md` helper
   template (a local install helper, not operating authority).
2. Adapt it for this repo: replace `[repo-name]` and add repo-local
   structured-tool and retrieval details. Do not leave placeholders in the
   installed file.
3. Commit the result as `AGENTS.md` at the repo root.

`AGENTS.md` is repo-specific operating authority; it must not be generated
automatically or deferred to a worker that needs that authority before dispatch.

### First-run setup loop

Root `AGENTS.md` may not exist yet in a freshly bootstrapped repo. Authoring it
is recommended repo-local operating context, but its absence is advisory and
does not block adoption verify on its own; missing or invalid launcher config
does block.

1. Run:

   ```bash
   npx wiki adoption verify --dir "$PWD" --json
   ```

2. If the result is `blocked` on operator-owned launcher prerequisites
   (`operator_first_run_prerequisites_missing` naming `agent-launch.toml` role
   defaults or `.agent-launch` init-config), report the blockers and ask the
   operator to complete setup.
3. The operator should run:

   ```bash
   npx agent-chassis setup
   ```

   Then review/adapt `wiki/templates/AGENTS.md.boilerplate.md` into root
   `AGENTS.md` (recommended advisory context). Do not install the helper
   unchanged; the installed file is repo-specific operating authority.
4. Rerun adoption verify after setup.
5. Proceed once the required checks pass.

**2. Launcher config** — bootstrap and postinstall guidance tell the operator to
copy or review the detected `agent-launch.<claude-or-codex>.toml` template to
`agent-launch.toml`, run `agent-launch init-config`, review/commit the
bootstrap-created files, build the code index, and only then launch
`agent-launch orchestrator IN-0001`. Launcher setup is an operator first-run
prerequisite, not a worker-owned setup slice.

**3. MCP workspace declaration** — bootstrap generates the repo-local
`wiki/.wiki-mcp.json` declaration (schema version `wiki-mcp-workspace.v1`),
recording the repo alias and fully resolved root. It is a generated, gitignored
local artifact that bootstrap regenerates and root-refreshes on every run; it is
not committed. What remains is operator review, not creation: confirm the
recorded `current.alias` is the alias repo-scoped MCP calls such as
`workspace_coordination_preflight({repo:<alias>})` should use, and set a
deliberate operator alias if the default repo-identifier alias is not what you
want. The declaration records local alias/root state only; bootstrap does not
write global MCP client settings, and agents and orchestrators do not edit
`~/.codex/config.toml` or other global MCP client settings as part of this
adoption step. If runtime support for the
declaration is not yet available in the consuming repo, use the documented
environment-based MCP alias setup as the operator-owned compatibility path.
Reviewing this declaration is **not** a separate dispatchable work item: the
`adoption-verify` review slice confirms it informationally (it checks that
`wiki/.wiki-mcp.json` exists, carries schema `wiki-mcp-workspace.v1`, resolves
`current.root` to the repo root, and uses a repo-derived `current.alias` unless a
deliberate operator alias was chosen), and that non-gating check never flips the
`ready` verdict on its own.

### Recording adoption verification

The seeded `WK-0001` tracker is review-only. It does not require implementation
slice bookkeeping for first-run setup. Instead, `wiki adoption verify` reports a
freshly bootstrapped repo as `blocked` until the operator first-run prerequisites
exist and the required read-only checks pass. The findings-only
`adoption-verify` review slice records that verification result.

### Operator shell setup vs. agent authority

`wiki bootstrap` is an **operator shell command**: a human runs it once from the
new repo root to seed static files. It is setup, not agent dispatch authority,
and it performs no agent role call. Seeding a repo does not make that repo
agent-operable.

After bootstrap, the seeded `IN-0001` checklist is executed from the target
repo's own context using that repo's documented **structured tools** (MCP first,
CLI as operator fallback). Agents in the consuming repo must use those structured
tools for the verification checks; the one-line bootstrap neither grants nor
substitutes for that authority. Command forms shown here are operator setup
examples, not agent execution authority for the seeded checks.

## Existing Repository Adoption

1. Inventory existing `docs/` and `wiki/` content.
2. Map current records into the shared core surfaces and declared extension namespaces.
3. Normalize overlapping core IDs and filenames where needed:
   - `WK-*` for issues
   - `IN-*` for initiatives
   - `DEC-*` for decisions
   - `SRC-*` for sources
   - slug-based files for areas
4. Run `wiki sync-contract --repo <org/repo> --profile <profile> [--extensions ...]` to copy the shared templates, ensure missing core files, and update local contract metadata.
5. Run `wiki lint` and fix surfaced drift.
6. Introduce `wiki generate` to populate the shared non-canonical views: `catalog.md`, `now.md`, `inbox.md`, `backlog.md`, and `archive.md`.
7. Optionally adopt the shared lexical search path with `wiki build-search-index` and `wiki search`.

`wiki sync-contract` is non-destructive for consumer-owned `wiki/schema.md`, `wiki/conventions.md`, and `wiki/index.md`. It preserves existing files and only creates them when missing.

Consuming repos should treat those preserved files as local operating guidance that must be maintained deliberately. See [docs/consumer-owned-docs.md](consumer-owned-docs.md).

See [docs/wiki-contract-metadata.md](wiki-contract-metadata.md) for the local metadata shape used to declare topics and `docs/**` inference defaults.

## Recommended Adoption Order

Prefer gradual adoption:

1. bootstrap surfaces
2. sync templates
3. start linting
4. migrate existing records
5. add generation once the repo wants the shared retrieval and queue views

This keeps the contract stable while avoiding a big-bang migration.

## CI Expectations

At minimum, consuming repositories should run:

- `wiki lint`
- `wiki sync-contract --check`

Later, they may also run:

- `wiki generate`
- `wiki build-search-index`

The goal is to detect drift early without forcing a shared content store.

See [docs/mcp-integration.md](mcp-integration.md) for the agent-facing integration model.
