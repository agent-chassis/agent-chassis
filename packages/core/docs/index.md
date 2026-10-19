
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
- [vertex-ai-inference.md](vertex-ai-inference.md) — run Codex inference through
  the local LiteLLM gateway to Vertex AI.

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
  — confined repository visibility, Git metadata projection, the normative
  launcher agent session contract, and the separate host test capability.
- [agent-launch-mcp-conduit-lifecycle.md](agent-launch-mcp-conduit-lifecycle.md)
  — the host wiki-MCP local socket conduit: admission, readiness, teardown,
  client registrations, and the unsupported Agy posture.
- [agent-launch-conduit-authority-and-review-sources.md](agent-launch-conduit-authority-and-review-sources.md)
  — minted conduit authority, review checkout capture, the frozen worker
  assignment, and terminal candidate validation.
- [agent-launch-git-status-interception.md](agent-launch-git-status-interception.md)
  — the orchestrator `git status` adaptation under the private-family overlay.
- [agent-launch-worker-test-runtimes.md](agent-launch-worker-test-runtimes.md)
  — the toolchain and dependency projection for a managed worker's commands.
- [agent-launch-conduit-capture-and-probes.md](agent-launch-conduit-capture-and-probes.md)
  — optional transcript capture, the metrics destination, and the test-only
  confined-worker probe.
- [test-proof-runtime-identity.md](test-proof-runtime-identity.md) — saved
  proof meaning, runtime binding, candidate binding, and provider families.
- [test-proof-execution.md](test-proof-execution.md) — host test and proof
  execution, transformed proof copies, and compiler caches.
- [test-proof-runtime-environments.md](test-proof-runtime-environments.md) —
  readiness as configuration and environment routing.
- [test-proof-observation.md](test-proof-observation.md) — the observation
  protocol, reach binding, family limits, and module-fault providers.
- [test-proof-results.md](test-proof-results.md) — proof outcomes, capability
  limitations, and verification timing.
- [test-proof-diagnostics.md](test-proof-diagnostics.md) — failure diagnostics,
  run records, and retained evidence.
- [junit-test-result-parser.md](junit-test-result-parser.md) — the shared
  JUnit/XUnit report parser.
- [agent-launch-family-runtime-state.md](agent-launch-family-runtime-state.md) —
  per-family launcher runtime-state facts.
- [agent-launch-run-provenance.md](agent-launch-run-provenance.md) — the
  `agent-run-provenance.v1` envelope and run inspection.

## Specification and authoring

- The launcher supplies the session’s generated guide and authoring vignette, from a user request to an authored worker assignment.
- [mcp-controlled-contract-operations.md](mcp-controlled-contract-operations.md) —
  typed requirements, compilation, unresolved meaning and the observation boundary.
- [acceptance-coverage-mcp.md](acceptance-coverage-mcp.md) — obligations, criterion
  associations, proof selection and explicit exceptions.

Compilation checks supplied meaning, not omitted requirements, truthful
observations or delivered correctness. Design assessment, executed test evidence,
assertion adequacy, integration and landing are separate facts. Source-repository
decisions and roadmaps are not public package prerequisites; use these public
contracts and the consumer repository's own accepted policy.

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
