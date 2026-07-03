<!-- wiki: id=WK-0001 relation=tracks -->
# Adoption — {{REPO}}

This page is the local operator guide for `{{REPO}}`'s adoption of the shared
AgentChassis wiki/agent contract. It is **bootstrap-seeded**: the one-line
`wiki bootstrap` wrote it from a package template and will **preserve your
edits** on rerun (it is only created when missing). Adapt it freely for this
repo's real operating notes.

## What bootstrap created

Running `wiki bootstrap` from this repo root seeded the local wiki contract and
adoption surfaces when they were missing, and refreshes generated/local
artifacts on every run:

- `wiki/schema.md`, `wiki/conventions.md`, `wiki/index.md`, and the generated
  wiki views (`catalog.md`, `now.md`, `inbox.md`, `backlog.md`, `archive.md`)
- `wiki/initiatives/IN-0001.md` — this repo's owned adoption plan
- `wiki/work-records/WK-0001.json` — the canonical adoption tracker work record
- `wiki/templates/AGENTS.md.boilerplate.md` — a helper template to review/adapt
  into the repo's own root `AGENTS.md` (bootstrap does **not** create
  `AGENTS.md`, so root `AGENTS.md` may not exist yet)
- `docs/adoption.md` — this page (created from a template, preserved on rerun)
- `wiki/.wiki-contract.json` — local contract metadata
- `wiki/.wiki-mcp.json` — see [Local MCP metadata](#local-mcp-metadata) below
- `.cache/wiki-search/index.json` plus `.gitignore` entries for generated caches

Bootstrap is static seeding only. It does not write global MCP client config,
build the graph-backed code-index sidecar, or claim this repo is agent-operable.
A missing root `AGENTS.md` is reported as non-gating advisory readiness context,
not an adoption blocker; missing or invalid launcher config
(`agent-launch.toml` role defaults or `.agent-launch` init-config), however, does
keep adoption verify `blocked`.

## Installing and invoking the CLI

The tooling is the published `@agent-chassis/wiki-cli` package (it exposes the
`wiki` bin). The canonical zero-install command form names the package and the
bin explicitly so it resolves without a local `package.json` script:

```bash
npx -p @agent-chassis/wiki-cli wiki <subcommand> --dir "$PWD"
```

If this repo adds a `wiki` npm script (`"wiki": "wiki"`), the
`npm run wiki -- <subcommand>` form is an optional shorthand. The bare
`npx @agent-chassis/wiki-cli <subcommand>` form is unreliable (the bin name
differs from the package name) — prefer the `-p` form above.

See [docs/local-package-install.md](local-package-install.md) for registry,
auth, and install details.

## Verifying first-run readiness

After the adoption work is recorded (below), run the read-only structured
readiness check from this repo's own context:

```bash
npx -p @agent-chassis/wiki-cli wiki adoption verify --dir "$PWD" --json
# optional shorthand, only if this repo defines a `wiki` npm script:
npm run wiki -- adoption verify --dir "$PWD" --json
```

`adoption verify` runs five required read-only checks — `wiki-retrieval`,
`work-records`, `generate-lint`, `graph-impact`, and `dispatch-preflight` — plus
non-gating informational entries (root `AGENTS.md` presence, the bootstrap
`wiki/.wiki-mcp.json` alias, and this `docs/adoption.md`). It persists no
evidence.

### Interpreting the verdict

- **`ready`** (`agent_operable: true`, exit 0): every required check passed. Only
  then treat the repo as agent-operable.
- **`blocked`** (`agent_operable: false`, nonzero exit): at least one required
  check did not pass. Each non-passing check carries a structured `blocker` code
  and a `remediation` string; the JSON envelope still prints on stdout. Resolve
  the named blockers and re-run.

A freshly bootstrapped repo is reported `blocked`, not `ready`, until the
operator first-run launcher prerequisites are present and the adoption review
records the verification result — successful tooling output alone is not
adoption completion.

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

## Recording adoption review status

The seeded `WK-0001` tracker is review-only. It has a findings-only
`adoption-verify` slice that checks whether this repo is ready to be treated as
agent-operable; it does not carry worker-owned implementation slices for
first-run setup. In particular, launcher config is an operator first-run
prerequisite and root `AGENTS.md` is recommended advisory operating context: run
`npx agent-chassis setup`, copy/review the appropriate
`agent-launch.<claude-or-codex>.toml` template to `agent-launch.toml`, run
`agent-launch init-config`, and review/adapt
`wiki/templates/AGENTS.md.boilerplate.md` into root `AGENTS.md`, before launching
the seeded IN-0001 orchestrator.

`adoption verify` checks launcher config as a readiness blocker and reports root
`AGENTS.md` presence as advisory context. A bare bootstrapped repo stays
`blocked` until the operator first-run launcher setup is present and the required
read-only checks pass; it is not blocked on implementation-slice bookkeeping in
`WK-0001`. Record the `adoption-verify`
review slice as `done` only after the review reports `ready`, or as `blocked`
with the concrete structured blocker from the verification output.

`docs/adoption.md` is bootstrap-generated, so it is not a worker-authored
implementation slice — `adoption verify` confirms its presence informationally.

## Canonical work layers

Retrieval is a wiki/docs problem first. The canonical layers in this repo are:

- `wiki/work-records/WK-*.json` is the **canonical work-record layer** for `WK-*`
  work — the authoritative, schema-validated work-item contract.
- `wiki/initiatives/IN-*.md` is the initiative coordination layer.
- `wiki/decisions/DEC-*.md` records durable decisions.
- `wiki/sources/SRC-*.md` records provenance and evidence.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/inbox.md`, `wiki/backlog.md`, and
  `wiki/archive.md` are generated views, not canonical state.

If this repo carries legacy `wiki/issues/WK-####.md` pages, treat them only as
historical Markdown issue context, not as the canonical executable work layer —
migrate actionable items into `wiki/work-records/WK-*.json`.

## Local MCP metadata

`wiki/.wiki-mcp.json` is a **bootstrap-generated, gitignored** local workspace
declaration (schema `wiki-mcp-workspace.v1`). Bootstrap regenerates it on every
run — it refreshes `current.root` to this repo's resolved path and preserves an
operator-chosen `current.alias`. It is local metadata, not a committed wiki
surface and not a worker-owned file: `git add wiki` does not stage it. Review
the recorded `current.alias` and set a deliberate operator alias only if the
default repo-derived alias is not what workspace-scoped MCP lookups should use.
Bootstrap never edits global MCP client settings.
