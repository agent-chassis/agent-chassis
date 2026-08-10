
# Adopt AgentChassis in a repository

This is the single package-owned adoption guide. It is intentionally
repo-neutral. Setup and bootstrap must not render or copy it into a consuming
repository.

Repository-specific adoption state belongs in the canonical `IN-0001` and
`WK-0001` records created in that repository. Those records—not this guide—own
the current work topology, scope, status, and acceptance criteria.

## Prerequisites

- Run adoption from the root of a Git repository.
- Use a supported Node.js and npm installation.
- Install `@agent-chassis/core` as a development dependency so the repository
  pins the tooling it uses.

```sh
npm install --save-dev @agent-chassis/core
```

## Set up the repository

Run the setup command from the repository root:

```sh
npx agent-chassis setup
```

Setup owns the mechanical first-run work: bootstrapping the wiki surfaces,
selecting the detected launcher family, creating `agent-launch.toml` when it is
absent, initializing launcher state, and printing the exact remaining commands.
It must preserve existing operator-owned configuration.

Setup creates the repository's canonical adoption initiative and work record:

- `wiki/initiatives/IN-0001.*`
- `wiki/work-records/WK-0001.json`

Read those records for the repository's actual remaining adoption work. Do not
copy lifecycle or slice descriptions from this guide into them, and do not use
this guide as authority when their current state changes.

## Review and commit setup

Review the files reported by setup, especially:

- the selected root agent-guidance file;
- `agent-launch.toml`;
- `wiki/.wiki-contract.json`;
- the seeded canonical initiative and work record;
- `.gitignore` changes and generated local metadata exclusions.

Commit the repository-owned setup surfaces before launching managed work. Do
not commit generated caches, run state, or `wiki/.wiki-mcp.json`.

## Complete adoption

Build the code index and start the seeded adoption orchestrator using the exact
commands printed by setup. The normal orchestrator entrypoint is:

```sh
npx agent-launch orchestrator IN-0001
```

The orchestrator must follow the canonical `WK-0001` contract. It should not
invent adoption work from this document or from package examples.

Run the read-only adoption check from the consumer repository when the seeded
work calls for it:

```sh
npx wiki adoption verify --dir "$PWD" --json
```

Treat the structured result as the current verification result. Fix concrete
setup or runtime blockers at their owning surface; do not rewrite the adoption
contract to absorb environment failures.

## Rerunning setup

Setup and bootstrap are idempotent. Rerunning them may refresh package-owned
templates and generated local metadata, but must not overwrite:

- root agent guidance;
- `agent-launch.toml`;
- canonical `IN-*` or `WK-*` records;
- other repository-authored documentation.

## Where information belongs

- Package installation and first-run procedure belong in this guide.
- Repository-specific adoption work belongs in `IN-0001` and `WK-0001`.
- Agent operating authority belongs in the repository's root agent-guidance
  file.
- Launcher selection and model defaults belong in `agent-launch.toml`.
- Machine-local workspace identity belongs in generated, gitignored metadata.

No consumer-local `docs/adoption.md` is generated. A consuming repository may
author its own adoption notes if it wants them, but those notes are ordinary
repository documentation and are never a bootstrap artifact or duplicate work
contract.
