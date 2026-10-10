# AgentChassis 0.10.0

AgentChassis 0.10.0 consolidates orchestration tooling and adds clearer tracking of work, evidence, delivery, and native usage.

## Simpler orchestration tooling

Sixteen task-oriented operations replace the previous shared agent tool families. Orchestrators discover current capabilities and follow returned next steps, bringing work authoring and execution under a common interaction model.

## Work authoring and guidance

Requirements, evidence plans, and review judgments can be saved together. Revision checks expose concurrent edits, ambiguous proof choices remain unresolved, and review judgments stay linked to captured findings. Design assessment distinguishes authored validity from evidence that the implementation works.

A new worked example guides orchestrators through preparing work and its evidence. Confined Claude and Codex sessions receive role-guide reminders after compaction, subject to client hook policy.

## Explicit delivery and integration

Managed runs preserve original results independently of observation, with authenticated originals readable after restart. Integration is a separate action on the selected delivery, keeping a completed agent run distinct from integrated work. Publication supports local, Git, and hosted destinations while leaving landing and work completion separate.

Direct live Codex workers are retired in favor of orchestrator-managed dispatch; direct live Claude workers remain available.

## Native testing

A dedicated orchestrator test operation shares prepared runtimes with proof execution and worker commands. Ordinary test results do not grant proof credit, and a successful process exit alone does not establish proof success.

Python runtime setup now recognizes dependencies from `pyproject.toml` when requirement files are absent, checking the existing installation.

## Native usage accounting

Claude and Codex launches retain native usage records and run totals, accounting for cached input, resumed sessions, and managed retries. Pending checkpoints preserve observations before a run settles. Missing records leave totals explicitly incomplete; Claude cost figures remain client estimates rather than billed spend.

## Model routing and proxy support

A new Vertex Gemini Flash route uses the Codex client and local LiteLLM gateway. Proxy configuration now survives the launch chain, including confined sessions and dispatched roles, with a bypass for the local gateway.

## Release metadata

Release date: 2026-10-10

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.10.0 |
| `@agent-chassis/wiki-core` | 0.10.0 |
| `@agent-chassis/wiki-cli` | 0.10.0 |
| `@agent-chassis/wiki-mcp` | 0.10.0 |
| `@agent-chassis/agent-launch-core` | 0.10.0 |
| `@agent-chassis/agent-launch-cli` | 0.10.0 |
| `@agent-chassis/controlled-contract` | 0.10.0 |
