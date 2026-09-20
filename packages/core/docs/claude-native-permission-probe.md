# Claude native permission configuration and empirical tests

Ordinary managed Claude worker/reviewer launch and headless orchestrator launch
apply launcher-owned native permission settings. They do not start an auxiliary
model-driven permission self-test, consult a positive-test cache, or require
synthetic reports or canaries. Applied configuration is not empirical
certification of installed Claude behavior.

## Ordinary launch

`workspace-agent-claude-launch-preflight.mjs` owns settings artifact minting and
validation. The managed executor supplies already-selected role, scope and MCP
profile facts. The headless orchestrator uses its distinct settings builder and
mints exactly once, after the conduit's tool profile is frozen. Shared artifact
validation checks a successful mint and nonempty settings path/root; each route
retains its own failure projection. Plan construction and dry-run output only
project headless settings and do not mint a test-only artifact.

Native settings isolation, scope/confinement, credential and network
configuration, configured executable checks and identity rechecks, MCP readiness,
requested-agent supervision and post-run scope verification remain in their
existing owners. Settings setup failures still refuse before requested-agent
spawn with `claude_native_permission_settings_unavailable` or the producer's
specific setup reason. Other genuine failures retain their stage-specific
ordinary diagnostics. No behavioral test outcome participates in launch.

Redteam remains settings-free and probe-free. Interactive orchestrator and
current resume behavior remain interactive; resume uses the shared command
runner without adding headless settings. `launchTransportInjected` retains its
independent conduit-routing behavior. There is no permission-probe bypass flag,
compatibility alias, optional product diagnostic route or verifier injection.

See executor design,
[launch/admission](mcp-dispatch-launch-and-admission.md#configured-readiness-and-native-permission-diagnostics)
and [enforcement model](enforcement-model.md) for the retained launch boundaries.

## Explicit empirical integration testing

`tests/integration/workspace-agent-claude-native-permissions-live.test.mjs`
requires `RUN_LIVE_CLAUDE_PERMISSION_TESTS=1` before binary discovery, version
invocation or model execution. Binary availability alone is not opt-in. The
normal hermetic validation run leaves it unset and skips both live tests.
Running the opted-in suite requires Claude credentials and network access and
may incur model costs.

`tests/integration/claude-native-permission-harness.mjs` is the sole retained
empirical harness/process helper. It has no positive cache and no production
imports or launch authority. Its process outcomes, complete output capture,
filesystem observations and diagnostics are test evidence. A clean exit alone
is insufficient: missing reports remain missing, observation/read errors remain
unevaluable, and false checks remain false. Canary absence is a harness
observation; it does not independently establish that the model attempted a
forbidden operation. Authentication-like prose does not establish an
authentication failure.

Hermetic tests exercise settings and actual launch orchestration through
controlled process seams, asserting requested-agent spawn and zero auxiliary
processes or report/canary I/O. In-memory negative controls reinsert a probe or
report dependency and must fail the same launch witness. Setup-failure,
settings-isolation, scope, executable, conduit and supervision tests remain
separate from empirical testing.

## Historical evidence and current test consumers

work record and work record records, proof carriers, review findings and receipts retain
their historical identities unchanged. work record does not close work record or grant
new proof credit to old module bindings. The five production-only probe causes
and their operational FAQ entry are retired because they have no production
emitter; ordinary launch diagnostics remain available.

The current forbidden-operation fixture still observes
`runNativePermissionProbeProcess` and the two general-supervisor exports, with
its runner binding updated to the integration helper. The provider suite copies
that helper into its test snapshot. These current tests grant no canonical
proof credit and do not rewrite historical bindings. The generic
[runtime identity contract](test-proof-runtime-identity.md#forced-operation-invocation)
continues to own provider semantics.
