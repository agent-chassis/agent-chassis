# AgentChassis 0.7.0

Controlled contracts graduate to a stable v1 family, coverage and runtime proof become first-class MCP routes, and launcher model selection becomes explicit.

**Released:** 2026-09-03

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.7.0 |
| `@agent-chassis/wiki-cli` | 0.7.0 |
| `@agent-chassis/wiki-core` | 0.7.0 |
| `@agent-chassis/wiki-mcp` | 0.7.0 |
| `@agent-chassis/agent-launch-cli` | 0.7.0 |
| `@agent-chassis/agent-launch-core` | 0.7.0 |
| `@agent-chassis/controlled-contract` | 0.7.0 (was 0.1.0) |

`@agent-chassis/controlled-contract` moves from 0.1.0 to 0.7.0 so all seven packages
version together; the jump tracks the set and is not a signal of scope on its own.

## Highlights

- **Author contracts against the stable v1 family.** The published root and subpaths now
  support the native `controlled-acceptance-contract.v1` carrier, vocabulary, and
  verification profile. The contract checker validates against v1, and stable entrypoints
  reject experimental, mixed, partial, and unknown contract identities before doing any
  semantic work. Root exports that carried the experimental v0.34 suffix are replaced by
  their v1 counterparts.

- **A re-versioned and much larger proof-profile catalog.** Every shipped proof profile is
  republished at a new major version, and the catalog gains whole new families covering
  direct-source provenance, caller-authority confinement, pagination traversal, snapshot
  consistency and cursor refusal, declared-boundary and declared-limit policy, sound
  negative observation, forbidden non-invocation, lexicographic ordering, supplementary
  isolation, and test validity. Implementation readiness and idempotency each gained a new
  major, and every profile now ships an evaluation-input template.

- **Coverage, authoring, and runtime proof are callable over MCP.** New routes let an agent
  create, upsert, patch, rebase, remove, describe, and query acceptance coverage and
  obligation coverage; build and continue a proof-authoring skeleton; plan, apply, and query
  a contract refactor; assess integration test design; and prove one integrated slice at
  runtime. A separate verify-proof route runs a canonically selected proof population and
  returns an advisory satisfied / unsatisfied / not-executable outcome or a typed refusal.

- **Assessment output is paged instead of dumped.** Contract assessment now returns a
  summary envelope with per-collection counts plus a typed continuation, and you page
  through the detail with a dedicated assessment-query route. Results are explicitly
  read-only and grant no admission, certification, or dispatch authority.

- **Validators compile once and are reused from a cache.** JSON Schema validators are
  generated and published as verified artifacts under a cache directory in your repository
  root, keyed by toolchain and per-group schema identity. Editing a schema recompiles only
  that group. Two package scripts warm the cache ahead of time or verify that an exact
  artifact already exists; neither is a startup prerequisite.

- **Named subpath exports replace wildcards.** The contract package no longer exports
  wildcard subpaths. Named entry points now cover the verification profile, test proof,
  runtime evidence, bounded diagnostics, artifact-set provenance, assessment recovery, the
  validator cache, the vocabulary, and each shipped schema individually. Deep wildcard
  imports must be repointed at the named subpath.

- **Review attestation settles itself.** Recording a review attestation is no longer a tool
  you call: the attestation is derived and published during original review settlement, and
  the manual MCP route has been removed. Existing callers should drop the call.

- **Search works without a prebuilt index.** Read-only search no longer refuses when no
  lexical index exists. It builds the repository's complete corpus in memory and answers the
  query in the same call, and reports which state it served from. Persisting the index is now
  an optional optimization rather than a prerequisite.

- **Launcher model selection is explicit.** The registry no longer carries a default model
  per app, and the silent retry that dropped an unrecognised model hint is gone. `--model`
  now selects a registered model, `--app` asserts the app derived from it, and an
  unregistered model fails with a refusal instead of quietly falling back to a profile
  default.

- **Tool exposure follows the access policy on every profile.** The `full` and `operator`
  tool profiles no longer bypass the shipped session-role access policy. A tool is exposed
  only when the policy both declares a disposition for it and grants it to the resolved
  role, so what a session sees is now the same question for every profile. Write-capable
  tools also state their write semantics directly in the tool description.

- **New routes for watching and reconciling work in-session.** You can list the runs this
  server minted and pick a recognised monitor handle from them, read and advance
  terminal-review candidate state, and batch-check up to 100 previously observed work-record
  digests for staleness — each result distinguishing unchanged, changed, absent, and
  unreadable, with overflow reported rather than dropped.

- **Shipped docs travel with the install, and setup leaves your root guidance alone.** When
  the MCP server is started through the umbrella package's bins, it now receives a
  documentation bundle resolved from that package's own location, so a nested, non-hoisted
  install serves exactly the docs shipped beside it; a standalone server start advertises no
  documentation it cannot read. Setup no longer creates, reads, modifies, or deletes a root
  `AGENTS.md` or `CLAUDE.md` — it prints the commands for you to run.

Internal module refactors; public import surfaces preserved.

## Upgrading

- Upgrade all seven packages together. They cross-depend on `^0.7.0`, and mixing 0.6.x with
  0.7.0 will not resolve.
- Any `^0.1.0` pin on `@agent-chassis/controlled-contract` becomes `^0.7.0`.
- **`wiki adoption verify` has been removed.** Delete it from scripts, CI steps, and
  runbooks; the command and its readiness envelope no longer exist. Bootstrap no longer
  seeds an adoption tracker work record either — a fresh bootstrap creates only an
  in-progress first-work placeholder, and existing-repository adoption is deferred.
- Repoint imports of the experimental v0.34 contract exports at their v1 counterparts, and
  replace wildcard subpath imports of schemas, profiles, examples, or the vocabulary with
  the named subpaths.
- Drop any call to the removed review-attestation MCP route.
- Where a launcher invocation relied on `--app` alone to pick a model, name a registered
  model explicitly.

## Fixed

- Initiative status resolved its shipped taxonomy data relative to the caller's working
  directory, so it failed when run from anywhere but a repository root; it now loads that
  data from the installed package. A repository with no work-records directory returns an
  empty result instead of erroring.
- Work-record scans now consider only canonical `WK-####.json` files in the work-records
  directory, so stray, renamed, or backup JSON files no longer surface as duplicate
  identifier claims. A corpus that changes mid-scan is reported rather than silently
  captured in part.
- An oversized MCP response that cannot be persisted for ranged retrieval now returns a
  typed refusal naming the cause and the size that could not be stored, instead of an
  unlabelled failure. It is explicit that the response was neither truncated nor silently
  dropped.
- A launcher child terminated by a signal now reports that signal and re-raises it, instead
  of reporting an empty exit status and appearing to succeed.
- A persisted lexical search index that is truncated, structurally invalid, or not a
  contained regular file is now refused with build remediation instead of being parsed as if
  it were valid.
- Backend refusals keep their own identity as they surface through dispatch, rather than
  being remapped onto a small set of generic dispatch blockers; blocker entries also carry
  structured recovery guidance naming the exact route and arguments to use.
