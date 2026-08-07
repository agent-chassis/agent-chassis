# AgentChassis 0.5.5

_Released 2026-08-06._ Work records can be checked before they are written, managed workers can run their own declared tests, and an operator can merge the reviewed pull request from the CLI.

All six packages ship at `0.5.5`:

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.5.5 |
| `@agent-chassis/wiki-core` | 0.5.5 |
| `@agent-chassis/wiki-cli` | 0.5.5 |
| `@agent-chassis/wiki-mcp` | 0.5.5 |
| `@agent-chassis/agent-launch-core` | 0.5.5 |
| `@agent-chassis/agent-launch-cli` | 0.5.5 |

## Highlights

- **Check a work record before you write it.** The new `workspace_preflight_dispatch` tool takes a proposed, unpersisted record or slice body and returns the same readiness projection you would get after persisting it — without touching canonical records. Admission reports one blocked control at a time, so you can now see the next constraint before a write instead of after a refusal.
- **Managed workers can run their unit's declared tests.** `workspace_worker_run_declared_test` runs the declared Node tests for the dispatched unit launcher-side, against the run's own worktree, and returns the output. The unit and worktree come from the run, not from the call, the repository is mounted read-only, and the result is advisory — it does not satisfy review or authorize integration.
- **Merge the reviewed pull request from the CLI.** `agent-launch forge-merge WK-####` takes only the WK id and merges the exact reviewed candidate head into the configured base branch; a remote conflict refuses rather than rebasing or force-updating. Pair it with the new optional record-level `completion_policy: forge_confirmed_merge`, which keeps a parent WK from reaching `done` until that merge actually lands.
- **Run monitoring tells you what to do next.** Run status, run wait, and slice integration results now carry a bounded `closeout_continuation`: the remaining ordered steps plus a `current_safe_call` naming only the step that is safe right now, with an explicit `decision_required` flag when a review disposition is still outstanding.
- **Far less context spent per call.** Code-index symbol, definition, callers, and callees results are compact by default with `verbose: true` for the full envelope; the tool catalog, agent FAQ, and initiative-status action and consistency channels are byte-bounded with exact total/returned/omitted counts, so you always know what was left out.

## Upgrading

Upgrade the whole `@agent-chassis` set together — the packages depend on each other at exact minor versions, and mixing 0.5.4 and 0.5.5 packages is refused rather than run. If you use the shipped launcher config templates, re-copy them: the default role-to-model assignments changed.

## Fixed

- Declared read and write scope paths now resolve against the commit your worktree is actually cut from — the WK branch tip, or the configured base for a new WK — instead of the landing checkout. Scopes pointing at paths created by an already-integrated prerequisite no longer refuse dispatch as nonexistent.
- Terminal review and forge handoff no longer refuse over dependency or test availability. A dependency tree that is absent, stale, or disagrees with the landing checkout, a missing install marker, and an absent declared test now change only what advisory evidence exists; none of them blocks review or publication.
- Tool results no longer repeat the full payload as display text alongside `structuredContent`. Because the inline budget now counts the payload once, results that previously spilled to a file stay inline.
- Dispatch validation no longer silently assumes an implementation readiness axis when a record's intended role is absent or unrecognized. It refuses with a typed blocker that names the observed value and asks for an explicit `dispatch_role`.
- Managed dispatch failures that previously surfaced as opaque refusals — a parent WK still in whole-WK review, and corrective continuation on an unreconciled parent/slice status pair — now return typed blockers carrying the exact unit and subject needed to recover.

Internal module refactors.
