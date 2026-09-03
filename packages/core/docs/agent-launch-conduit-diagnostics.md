# Host wiki-MCP Conduit Diagnostics

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the per-role host wiki-MCP conduit, its typed `stdio_mcp_*`
failure taxonomy, the orchestrator session diagnostic fields, and the operator
recovery route for a consumed or failed conduit. The conduit contract itself is
in [mcp-integration.md](mcp-integration.md).

Every confined Codex or Claude role receives exactly one launcher-owned host
wiki-MCP server through two named FIFOs bound into the final bubblewrap namespace.
The server and its dependencies remain on the host; the sandbox contains only the
two fixed relay paths and the pinned base-system copy relay. The launcher verifies
the exact role-derived tool list after the real client completes MCP `initialize`
and `tools/list`, then unlinks the FIFO names.

Conduit construction, host-server startup, client readiness, namespace, and
cleanup failures use the producer-complete public `stdio_mcp_*` taxonomy
documented in [MCP integration](mcp-integration.md#transport). These
failures never degrade to an optional MCP server. Failures found before spawn or
readiness refuse model work; failures found after readiness resolve the separate
always-live conduit failure channel, trigger bounded exactly-once teardown, and
publish a typed terminal outcome. Interactive orchestrator server loss is
failure-shaped while the orchestrator process remains live, even when client
transport close was observed first. Only launcher-observed orchestrator process
terminality authorizes expected interactive cleanup; one-shot worker, reviewer,
and redteam expected drain remains successful.

Orchestrator `session.json` records a bounded `stdio_mcp_reason` and
`stdio_mcp_detail` before terminal publication. The detail identifies readiness,
mid-session server loss, relay restart, cleanup, or reaping using launcher-owned
tokens only; it contains no prompt, credentials, environment, raw process
output, prose, or stack trace. If this diagnostic cannot be persisted, the
launcher fails closed with `stdio_mcp_session_diagnostic_persistence_failed`.

Every client-lifecycle shape raises the same typed code, so
`stdio_mcp_client_readiness_failed` alone does not identify a cause: a close
before `initialize`, a duplicate close, malformed initialize or `tools/list`
evidence, an out-of-order `tools/list`, and evidence after terminal close all
reach it. The detail therefore carries three further launcher-owned tokens —
`lifecycle_reason`, `lifecycle_phase`, and `lifecycle_event_class` — plus
`launcher_terminated_client`. The reason and phase are chosen by the launcher's
own transition site; the event class is resolved from the producer's
`schema_version` through a closed map and is `unrecognized` for anything outside
it, so no producer string is ever copied into the record. A value outside the
controlled vocabulary is dropped to `null` rather than truncated or escaped.
The same tokens are rendered on the interactive terminal.

A malformed controlled event carries one further launcher-owned token,
`lifecycle_validation_rule`, naming the validation rule that refused it:
`unpermitted_event_key`, `missing_required_event_key`, `field_value_not_exact`,
`event_not_plain_object`, `schema_version_not_string`, or `phase_not_permitted`.
It exists because "the producer sent a key this build does not know" and "the
producer sent a value this build does not accept" are different failures, and
only the first is the signature of a producer/consumer grammar drift. It names
the rule and nothing else: no producer key name, value, message, stderr, prompt,
environment value, credential, token, path, or stack is reachable through it, and
a value outside the closed set is dropped to `null`.

A schema-GENERATION incompatibility is a different failure from malformed event
content and keeps its own typed code, `stdio_mcp_lifecycle_protocol_incompatible`,
with the bounded coherent-build recovery. Malformed content stays
`stdio_mcp_client_readiness_failed` with the reason and rule above. An operator
never has to tell the two apart by reading a message.

Both are reported next to the two protocol generations. The launcher RETAINS the
negotiated producer generation in its own lifecycle state at the accepted server
registration — after it has been proven equal to the launcher's own constant —
and reports it, with the consumer generation, on every later typed lifecycle
failure. This is deliberate: most lifecycle events carry no generation field at
all, so a diagnostic that projected the generation out of the failing event
reported `lifecycle_protocol_generation: null` for exactly the failures where an
operator most needs to know which two builds were talking. `producer_protocol_
generation` is `null` only when no registration was ever accepted, which is
itself the fact worth reporting.

A launcher-issued signal always carries authorship. Readiness has two
continuations that terminate the confined client outright — a readiness failure
and a failed namespace-ready retirement — and both are direct `SIGKILL`s with no
`SIGTERM` before them. Each authors the initiation record before the signal
leaves, under the initiating fact `client_readiness_failed` or
`namespace_ready_failed`, so a session can never end showing `exit_signal:
SIGKILL` with no author. A direct kill is reported as an issued `SIGKILL`, never
as an escalation. First cause still wins: if the bounded drain supervisor
already opened a record for that conduit, a later direct kill adds only its
outcome slot, and cleanup, delivery, escalation, persistence, and rendering
failures stay additive.

When a conduit failure or a host-server exit arms the launcher's bounded
terminal drain and that drain actually signals the confined client, the launcher
retains one immutable initiation record before the first signal leaves. It names
the launcher's own terminal supervisor as the issuer, the stable initiating fact
(the failure settlement, or an expected drain, abnormal loss, or failed
observation of the server exit), and the originating typed conduit code — or
states explicitly that no cause is available, which is what a teardown before any
client authenticated reports rather than inventing one. The same supervisor then
fills exactly two write-once outcome slots, SIGTERM delivery and the optional
SIGKILL escalation. Cleanup, signal-delivery, escalation, persistence, and
rendering failures are additive evidence: none of them may replace the first
cause. The record is associated with the live child handle, never a pid; its
write side is private to launcher supervision and is deliberately absent from the
frozen conduit binding, which publishes only the bounded read projection.

That projection is persisted on `stdio_mcp_detail.launcher_termination` before
terminal publication and rendered on the interactive terminal, so a supervised
session never ends showing only `exit_signal: SIGTERM` for a signal this launcher
sent. The rendering states the underlying conduit or readiness failure, the
launcher-issued SIGTERM, and any launcher-issued SIGKILL escalation as three
separate facts, in launcher-owned bounded tokens only. A session whose sole
diagnostic is the launcher's own termination reports the reason
`stdio_mcp_launcher_terminated_client`; a typed conduit failure always outranks
it. Both interactive orchestrator families reach this through the one shared
supervisor: Claude hands it the conduit its own launch created, exactly as Codex
does, and a persisted conduit diagnostic still forces a failed terminal status.

Recovery for a consumed or failed conduit is to end the affected session, repair
the named host-server, bubblewrap, cleanup, or persistence prerequisite indicated
by the typed phase, and restart or resume through the normal launcher entrypoint.
A consumed per-dispatch FIFO stream is never refreshed, reconnected, or reused.
Do not increase `startup_timeout_sec` for post-readiness loss: that budget governs
only initialize plus `tools/list` and cannot restore a conduit that already
failed. Never widen repository visibility or add another transport.
