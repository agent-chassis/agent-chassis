
# AgentChassis documentation

Canonical, durable documentation for AgentChassis. For the product overview and
public positioning, see the [root README](../README.md). Agents and agentic
tools should start at [README-agents.md](README-agents.md) for the retrieval
order and repo map.

## Getting started

- [quickstart.md](quickstart.md) — first setup walkthrough and the `bwrap`
  sandbox prerequisite.
- [package-install.md](package-install.md) — package roles and install detail.
- [local-package-install.md](local-package-install.md) — installing the
  packages from a local build.
- [adoption.md](adoption.md) — adopting the contract in a new or existing repo.

## Operating and enforcement model

- [operating-model.md](operating-model.md) — the shared-substrate vs.
  local-repo boundary, and why this repo exists.
- [enforcement-model.md](enforcement-model.md) — the two-product enforcement
  posture (deterministic sandbox vs. advisory checks) and the rationale behind
  it.
- [versioning.md](versioning.md) — the version stability contract.

## Agent interface

- [mcp-integration.md](mcp-integration.md) — wiring an MCP client over stdio.
- [mcp-operation-reference.md](mcp-operation-reference.md) — reference for the
  MCP operations agents call.
- [tool-discovery.md](tool-discovery.md) — how agents discover tools and the
  tool-authority vocabulary.

## Launcher and dispatch

- [agent-launch-quickstart.md](agent-launch-quickstart.md) — launcher and
  role-dispatch reference.
- [agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md)
  — operator entrypoints, with migration notes for retired wrapper scripts.
- [agent-launch-local-config.md](agent-launch-local-config.md) — the
  operator-owned launcher registry, read-only argv defaults, and consuming-repo
  role-guard adoption.
- [agent-launch-policy-profiles.md](agent-launch-policy-profiles.md) — optional
  org policy profile and local dispatch-readiness policy-pack override.
- [agent-launch-write-scope-preparation.md](agent-launch-write-scope-preparation.md)
  — new-directory write scopes, `bubblewrap` isolation, and prepared write roots.
- [agent-launch-conduit-diagnostics.md](agent-launch-conduit-diagnostics.md) —
  the `stdio_mcp_*` conduit failure taxonomy and operator recovery route.
- [agent-launch-confinement-mcp-conduit.md](agent-launch-confinement-mcp-conduit.md)
  — confined repository visibility, the exact host wiki-MCP FIFO conduit, and
  the unsupported Agy posture.
- [agent-launch-family-runtime-state.md](agent-launch-family-runtime-state.md) —
  per-family launcher runtime-state facts.
- [agent-launch-run-provenance.md](agent-launch-run-provenance.md) — the
  `agent-run-provenance.v1` envelope and run inspection.

## Records and coordination reference

- [work-record-ontology.md](work-record-ontology.md) — work-record schema and
  field semantics.
- [initiative-status.md](initiative-status.md) — the coordinator triage lens
  over initiatives.
- [areas.md](areas.md) — area-based wiki structure.
- [consumer-owned-docs.md](consumer-owned-docs.md) — docs owned by the consuming
  repo.
- [wiki-contract-metadata.md](wiki-contract-metadata.md) — the
  `wiki/.wiki-contract.json` schema.
