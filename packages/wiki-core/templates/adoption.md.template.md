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
- `wiki/templates/AGENTS.md.boilerplate.md` — a helper template to adapt into the
  repo's own root `AGENTS.md` (bootstrap does **not** create `AGENTS.md`)
- `docs/adoption.md` — this page (created from a template, preserved on rerun)
- `wiki/.wiki-contract.json` — local contract metadata
- `wiki/.wiki-mcp.json` — see [Local MCP metadata](#local-mcp-metadata) below
- `.cache/wiki-search/index.json` plus `.gitignore` entries for generated caches

Bootstrap is static seeding only. It does not write global MCP client config,
build the graph-backed code-index sidecar, or claim this repo is agent-operable.

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
adoption slice statuses below are recorded — successful tooling output alone is
not adoption completion.

## Recording adoption slice status

The seeded `WK-0001` tracker carries the implementation work this repo must
complete itself (its root `AGENTS.md`) plus a findings-only `adoption-verify`
review. A successful worker run is **not** by itself proof that a slice is done:
the operator or initiative orchestrator must record each `WK-0001` implementation
slice `done` — or `blocked` with a concrete blocker — through the structured
work-record tools (set-status / set-closure). `adoption verify`'s `work-records`
check fails with an `adoption_status_bookkeeping_incomplete` blocker while any
implementation slice is still `todo`/`review`, so a bare bootstrapped repo stays
`blocked` until that bookkeeping is recorded. The `adoption-verify` review slice
itself may stay open while the review runs.

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
