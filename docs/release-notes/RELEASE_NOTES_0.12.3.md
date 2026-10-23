AgentChassis 0.12.3 fixes worker recovery and test diagnostics, and adds control over code-index build memory.

- **Recover failed deliveries.** A worker can regain its ability to finish when the retained delivery transaction proves that nothing was published or that publication was fully undone. Uncertain delivery effects still prevent recovery.
- **Resume integration cleanup.** Recovery can finish worker retirement and checkout cleanup after candidate preparation has already completed. It preserves completed steps; if the selected candidate has changed, it requires a new selection.
- **Review saved designs directly.** Design reviews can explicitly select the saved design and use a source checkout as supporting context, avoiding an unintended review of implementation changes.
- **Keep complete test diagnoses.** Failure reports that exceed the inline response limit remain available through complete retained reads. Recognized native text reports associate failures with their own exception details and locations, and can identify loading errors before tests start. Node TAP reports preserve exception types and distinguish negative zero in assertions.
- **Configure code-index build memory.** Commit `code_index.build_heap_mib` in the repository's `agent-launch.toml` to set the preparation process's V8 old-space ceiling. A new committed value applies to subsequent launches without restarting the host. The default on 64-bit hosts is 8192 MiB; this setting does not reserve RAM or cap total process memory.
- **Run with GPT-6.1 Sol.** `gpt-6.1-sol` is registered for Codex with high reasoning effort by default.

### Release metadata

Release date: 2026-10-23.

All seven packages are version **0.12.3**: `@agent-chassis/core`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/wiki-core`, `@agent-chassis/wiki-mcp`, and `@agent-chassis/controlled-contract`.
