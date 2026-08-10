# AgentChassis 0.6.0

Released 2026-08-10. Adds the public controlled-contract package and its bounded MCP surface, simplifies repository adoption, and makes launcher-terminated sessions explain themselves.

| Package | Version |
| --- | --- |
| `@agent-chassis/controlled-contract` | 0.1.0 |
| `@agent-chassis/wiki-core` | 0.6.0 |
| `@agent-chassis/agent-launch-core` | 0.6.0 |
| `@agent-chassis/wiki-cli` | 0.6.0 |
| `@agent-chassis/agent-launch-cli` | 0.6.0 |
| `@agent-chassis/wiki-mcp` | 0.6.0 |
| `@agent-chassis/core` | 0.6.0 |

## Highlights

- **New public package: `@agent-chassis/controlled-contract`.** Deterministic controlled-contract validation and planning assessment, with commands for proof-intent discovery, proof-pack selection and description, binding inspection, proof-plan building, and assessment (`controlled-contract`, `controlled-contract-discover-proof-intents`, and friends). It ships typed exports and JSON schemas, and its results stay explicitly non-authoritative: no unqualified `pass`, and residue is reported rather than hidden.
- **Controlled-contract operations in the MCP server.** Agents can now author, query, select proof packs for, plan, and assess controlled contracts through bounded structured routes instead of shelling out to a CLI. Authoring and proof-plan builds are orchestrator/operator-only; reviewers and redteams get read-only routes; workers get none. Tool discovery and routing intents were extended to match, so agents pick these routes instead of generic record editors.
- **Simpler adoption.** Bootstrap no longer generates or preserves a repo-local `docs/adoption.md`. The adoption guide is now a single repo-neutral document shipped with `@agent-chassis/core`, and your repository's actual adoption state lives in the seeded `IN-0001` and `WK-0001` records. `WK-0001` now also seeds an explicit terminal whole-WK review unit, and `wiki adoption verify` is stage-aware: it gates the seeded implementation slice before first dispatch and checks only launcher prerequisites afterwards.
- **Launcher-terminated sessions now say why.** When the launcher signals a confined client, it records the originating conduit or readiness failure, the SIGTERM it sent, and any SIGKILL escalation as three separate facts, persisted with the session diagnostic and rendered on the terminal. A supervised session no longer ends showing nothing but `exit_signal: SIGTERM`.
- **Refreshed Codex role template defaults** (reviewer, orchestrator, and redteam now `gpt-5.6-sol` at high effort). Installing or updating the package never rewrites an existing `agent-launch.toml`; re-copy the template or edit your file to adopt them. Internal module refactors; public import surfaces preserved.

## Upgrading

Upgrade the six `0.6.0` packages as a set — they pin each other with matching ranges, so a partial bump will not resolve. `@agent-chassis/controlled-contract` is versioned independently and stays on `^0.1.0`; it installs transitively through `wiki-core`, so most consumers need no direct dependency. Add it explicitly only if you import its exports, schemas, or CLIs yourself.

## Fixed

- A clean MCP session shutdown is no longer misread as a failure. After client readiness, a graceful client half-close followed by a host server exiting `0` is recorded as an expected drain: no server-exit failure, no launcher termination, and no signal sent to a confined orchestrator that is still working. Previously this path could reap a healthy server and then report its own escalation as an abnormal loss.
- Terminal candidate recovery failures report their real cause. The reviewer path previously stamped every failure `terminal_candidate_recovery_failed`; it now publishes the authenticated reason plus a bounded diagnostic distinguishing an unreadable or contradictory record, an unprojectable review unit, a moved review subject, and an incomplete lifecycle contract.
- Read-only Codex role launches use the launcher-bound workspace instead of searching upward from the current directory for a repository root, and refuse clearly when that workspace has no `wiki/`. Worker resolution now also passes the working directory, so per-repo launcher config is honored.
- Managed worker dispatch refuses up front with `worker_model_unset` when no launcher-selected model was supplied, instead of proceeding with an unset model. Bootstrap console output and the printed `git add` line dropped the stale adoption-guide references, and a new FAQ entry explains that `proof_pack_binding_result_too_large` is a presentation bound — not an invalid proof plan — recovered with targeted paged queries.
