# AgentChassis 0.12.2 Release Notes

AgentChassis 0.12.2 fixes a packaging error in 0.12.1 that prevented agent sessions from starting.

In 0.12.1, the `@agent-chassis/core` package shipped a documentation manifest whose version did not match the package version. The launcher checks that these versions match before starting an agent session, so installed agent sessions failed at startup. In 0.12.2, the two versions match. If you use 0.12.1, upgrade to 0.12.2.

## Release metadata

- Release date: 2026-10-20
- `@agent-chassis/core`: 0.12.2
- `@agent-chassis/agent-launch-cli`: 0.12.2
- `@agent-chassis/agent-launch-core`: 0.12.2
- `@agent-chassis/wiki-cli`: 0.12.2
- `@agent-chassis/wiki-core`: 0.12.2
- `@agent-chassis/wiki-mcp`: 0.12.2
- `@agent-chassis/controlled-contract`: 0.12.2
