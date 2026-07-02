
# agent-faq

`agent-faq.v1` is the repository's machine-readable known-issues corpus for
agent sessions. It exists so recurring worker complaints can be answered by a
stable structured entry instead of being re-learned from chat history, wrapper
names, or ad hoc shell inspection.

The canonical corpus lives at `packages/wiki-core/data/agent-faq.v1.json`.
This page is the durable contract for that corpus and for the read-only
surfaces that expose it.

## Corpus Contract

The corpus is append-friendly and read-only from the agent's perspective.
Each entry is a small record with a stable `id` and the following core fields:

- `title`
- `symptom`
- `cause`
- `actor`
- `routes`

Optional fields such as `fork`, `related_codes`, `related_docs`, and
`related_records` can add context, but they do not change the entry's stable
identity or behavior. The corpus is intended to grow by adding new entries, not
by rewriting existing ones into a different contract.

## Registered-Tier Projection

Every entry carries an explicit `tier_visibility` classification
(`free_local` / `paid_cce` / `operator_only`) and FAQ output is **tier-projected**
by the resolved registered tier (see
[docs/tool-discovery.md](tool-discovery.md) "Registered-Tier Exposure And
Projection"). A missing or empty `tier_visibility` is a corpus error (fail closed),
so a new entry cannot silently default to free/local exposure.

Free/local FAQ responses show only source-available coordination entries. They must
**not** route free/local agents to CCE-only remediation tools — graph impact,
graph-impact evidence persistence, target-resolution refresh, admission-metrics
refresh, CCE admissibility probes, LOC/blast-radius/multicluster analysis, or review
evidence — as ordinary next actions. Entries whose remediation depends on those CCE
tools are classified `paid_cce` and appear only under a positively-resolved CCE-key
posture; a free/local agent either sees a free alternative or does not see the entry
at all. Consistent with `decision`/`decision`, free/local confirmed-no-Node-Engine
has no local admissibility threshold judgment to explain. The registered tier is
resolved from the canonical CCE/Node Engine key posture, never from caller input.

The important rule is simple: if the advice for a recurring issue changes, the
source of truth is the corpus data file, not this prose page.

## Read-Only Surfaces

The FAQ is surfaced through two equivalent read-only entrypoints:

- MCP `workspace_agent_faq`
- CLI parity command `wiki agent-faq`

The CLI form is the operator-parity route for the same read-only surface. In
this repository it is invoked through the wiki wrapper, for example:

```bash
npm run wiki -- agent-faq --json
```

Both surfaces are additive. They report the corpus; they do not change
dispatch, readiness, launcher behavior, or any other runtime policy.

## Adding An Entry

To add a new FAQ entry, edit only
`packages/wiki-core/data/agent-faq.v1.json`.
Do not add code, wrapper logic, or launcher behavior for a new known issue.

When authoring an entry:

- keep the `id` stable
- describe the observable `symptom` and root `cause`
- choose the responsible `actor` explicitly
- name the exact structured `workspace_*` route(s) that resolve the issue
- add `related_codes`, `related_docs`, or `related_records` only when they help
  the operator or agent recover the issue faster

If a future issue needs a new resolution path, add a new corpus entry rather
than changing the meaning of an existing one.

## Boundary

This FAQ surface is additive and read-only. It is documentation and discovery
for recurring issues, not a new authority layer. It does not alter dispatch,
readiness, review, or launcher behavior, and it does not replace the canonical
work-record or tool-discovery contracts.
