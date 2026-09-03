
# Start AgentChassis in a new repository

This guide covers a new repository with no existing root agent guidance or
AgentChassis adoption state. Existing-repository adoption, merging, migration,
compatibility, and rerun behavior are deferred.

## Install and run setup

From the new repository root:

```sh
npm install --save-dev @agent-chassis/core
npx agent-chassis setup
```

Setup bootstraps the wiki surfaces, selects or prompts for the Claude or Codex
launcher template, creates `agent-launch.toml` when absent, and runs
`npx agent-launch init-config`.

Setup never creates, reads, modifies, or deletes root `AGENTS.md` or
`CLAUDE.md`. It prints these operator-owned commands exactly:

```sh
cat wiki/templates/AGENTS.md.boilerplate.md >> AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
```

Run both commands before staging. `AGENTS.md` is the canonical agent guidance;
`CLAUDE.md` is exactly the one-line bridge to it. The setup output then stages
both files:

```sh
git status --short
git add AGENTS.md CLAUDE.md wiki .gitignore agent-launch.toml
git commit -m "bootstrap AgentChassis wiki adoption"
```

## Bootstrap result

Fresh bootstrap creates `wiki/initiatives/IN-0001.md` as an in-progress
placeholder for the repository's first real work. It does not create
`wiki/work-records/WK-0001.json`; `WK-0001` remains available as the first
allocator-backed work-record identifier.

The fresh path has no adoption-verification gate, AGENTS-authoring worker,
customization review, seeded adoption tracker, or other adoption lifecycle.
The legacy `wiki adoption verify` implementation remains available for
compatibility, but setup and fresh bootstrap do not invoke, advertise, or
require it.

## Start the first work

After committing the setup surfaces, build the code index and proceed directly
to the placeholder initiative:

```sh
npx wiki code-index build --json
npx agent-launch orchestrator IN-0001
```

The operator defines the repository's first real work in `IN-0001`. There is no
intermediate adoption work record to complete.
