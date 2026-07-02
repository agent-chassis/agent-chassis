# @agent-chassis/agent-launch-core
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/agent-launch-core` is the launcher substrate: the family-neutral worker / reviewer
/ redteam dispatch path, worker-admission evidence preparation and the hosted admission-service
binding, sandbox / host-write authority, and launcher-minted config and runtime
state. It is a neutral multi-system substrate — family / app / model are operator-declared
(never hardcoded, no privileged default). Enforcement semantics (`admit` / `needs_review` /
`reject`) are owned by the hosted policy/admission service; this package prepares evidence and launches, it does not own
the policy decision.

## Exports

- `packages/agent-launch-core/src/index.mjs` — public export surface.
- `packages/agent-launch-core/src/lib/` — dispatch, worker-admission, Chassis Control Engine client,
  sandbox / host-write authority, and config / runtime-state libraries.

Agent-authored environment is not policy authority: runtime env a tool needs is
launcher-minted from canonical config, never inline `VAR=value` / alternate `HOME`/`XDG_*`.

## Package Role

This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [enforcement-model.md](../../docs/enforcement-model.md)
- [agent-launch-quickstart.md](../../docs/agent-launch-quickstart.md)
