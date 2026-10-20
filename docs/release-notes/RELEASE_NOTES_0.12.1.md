# AgentChassis 0.12.1 release notes

AgentChassis 0.12.1 changes what publication includes, how confined test runs treat the checkout, and which models orchestrators and agents can use.

**Publication includes later saved changes.** Publishing a work item now first commits its current saved record and authored sources, then prepares the published candidate from that state. Changes saved after a candidate was prepared or reviewed are published, where 0.12.0 refused them as drift. Examples include task completions, notes and requirement edits. Publication does not establish that the published content matches what an earlier review saw.

**Confined test runs no longer change the checkout.** Under active Linux bubblewrap confinement, each test and proof run writes to a temporary layer over the source. That layer is discarded when the run ends. This requires a non-setuid bubblewrap with temporary-overlay support; without it, tests are refused rather than run on the host. Sessions confined by macOS Seatbelt cannot run tests in this release. Unconfined sessions still run tests on the host with normal writes. The temporary layer covers only the checkout: Git metadata outside it, dependency stores, other host paths and the network keep their existing access.

**Unconfined deliveries outside write scope.** When a session runs without confinement, a delivery that changes files outside its write scope is no longer refused for that reason alone. It is still reported as not contained. Protected contract paths remain refused.

**Model providers without a launcher registration.** The launch configuration can carry native OpenCode provider settings. Any model from a provider declared there, including a local or self-hosted endpoint, can then be selected for any role without first being registered in AgentChassis. Only the forwarding of this configuration has been tested, not inference against a live custom endpoint. Gemini 4 Argon is also registered for Agy and OpenCode, also without live inference testing.

**Other changes:**

- If an assignment is edited after its worker committed, dispatch refuses to continue the worker under the outdated assignment. A recorded delivery of that work can still be integrated. Without a recorded delivery, the work is kept and dispatch stops.
- A headless Agy run can complete after a tool error when native session records confirm recovery later in the same run. Interactive Agy runs still require every step to complete cleanly.
- In reviewer and redteam sessions, code-index answers are checked against the checkout under review. Where the indexed version differs, reviewers can read the reviewed source where available.
- Go test failures are diagnosed per failing test.
- Unattended test-runtime setup accepts toolchain and per-project Python virtual-environment locations from environment variables. It reports the commands needed to install missing dependencies but does not run them. It also accepts standalone npm projects that turn off lockfiles.

## Release metadata

- Release date: 2026-10-20
- `@agent-chassis/core` 0.12.1
- `@agent-chassis/wiki-core` 0.12.1
- `@agent-chassis/wiki-mcp` 0.12.1
- `@agent-chassis/wiki-cli` 0.12.1
- `@agent-chassis/agent-launch-core` 0.12.1
- `@agent-chassis/agent-launch-cli` 0.12.1
- `@agent-chassis/controlled-contract` 0.12.1
