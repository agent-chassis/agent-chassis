# AgentChassis 0.5.4

_Released 2026-07-24_

This release gets work moving again at the two places it used to stall: dispatch no longer waits on parent-WK review planning, and the terminal review candidate no longer depends on a moving `main`. Handoff now opens the pull request itself, and a restarted orchestrator converges by simply re-issuing the same dispatch. The six workspace packages are bumped `0.5.3 → 0.5.4`, with cross-package pins moved to `^0.5.4`: `@agent-chassis/agent-launch-cli`, `@agent-chassis/agent-launch-core`, `@agent-chassis/core`, `@agent-chassis/wiki-cli`, `@agent-chassis/wiki-core`, `@agent-chassis/wiki-mcp`.

## Highlights

- **Parent review planning no longer blocks implementation dispatch.** Launching an implementation slice previously refused unless its parent WK already carried acceptance criteria, validation, and exactly one predeclared whole-WK review unit. Those are coordination decisions, not technical prerequisites for spawning a confined worker, so they are now surfaced as observable facts your coordinator (or a configured policy engine) may weigh — never as a local veto.
  - One parent-level fact still gates dispatch: the parent must carry a canonical initiative, because the exact branch namespace the launch commits into is derived from it. That refusal names a single repair — `assign_work_record_to_initiative` — and returns before anything is provisioned or spawned.
- **The terminal review candidate is now independent of the landing branch.** The candidate under whole-WK review is built as a deterministic squash of the accumulated WK branch onto the fork point that branch was cut from, carrying the branch's exact tree.
  - The current tip of `main` is never read, merged, or compared, so activity on `main` can no longer fail candidate construction, invalidate finished validation and review, or block publication.
  - Git and your configured merge actor own merge readiness, exactly as they do for a hand-written branch.
- **Publication handoff opens the pull request.** Handoff now observes the exact base/head proposal set for the candidate and creates the pull request when none exists, recovering an already-open or already-merged one instead of filing a duplicate.
  - The candidate commit is published byte-for-byte — never rebased, squashed, or amended — and a PR that is open but conflicting is still a successful handoff, because merging, approval, and conflict resolution stay with your forge and your human merge actor.
  - Ambiguous or identity-mismatched proposal state refuses rather than guessing.
- **Managed dispatch converges after a restart.** A coordinator that lost its process memory no longer needs the old monitor handle or an operator repair step: it re-issues the same dispatch for the same canonical subject.
  - A still-live attempt is returned as a continuation with its run and monitor identity re-exposed rather than being duplicated; a committed delivery continues from canonical Git state; a proven-dead attempt that delivered nothing is retired and the subject becomes launchable again. Accumulated history is no longer ambiguous by count alone.
- **MCP tools advertise their real input schemas.** Tools whose inputs carry cross-field guards used to publish as taking no arguments, even though every field was still enforced at call time — clients and models saw an empty contract and had to guess. All tools now publish their full properties and strictness on `tools/list`, and every guard rejects exactly the inputs it rejected before.

## Upgrading

Upgrade the whole `@agent-chassis/*` set to `0.5.4` together — the packages import each other and mixed versions are unsupported. Installing `@agent-chassis/core` pulls the set in at aligned `^0.5.4`.

## Fixed

- A worker whose authorized edits net out to no change now publishes a real, authenticated commit and takes the ordinary delivery path. Previously it was indistinguishable from a worker that never committed at all. The reverse case is now equally clear: a worker that changed files but never committed is reported as an unpublished delta and retired into a retryable state, with every unpublished byte left untouched in its worktree.
- A dead worker is no longer reported as still running. Worker liveness is now read from the run's own sandbox identity instead of the launcher process, which is a long-lived coordinator that legitimately outlives the work it started.
- A slice branch left ahead of, or diverged from, its expected base now refuses at the very start of provisioning — before any worktree is created, the work record is committed, or a binding is written — instead of after setup work had already been done.
- A technical failure while building or recovering the review candidate now reports its real cause with the underlying Git detail, rather than being reported as a candidate mismatch. No reviewer is spawned and no fallback candidate is substituted.

Internal module refactors; public import surfaces preserved.

## Package versions

All at `0.5.4`: `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, `@agent-chassis/core`.
