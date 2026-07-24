
# MCP dispatch runtime contract

`workspace_agent_dispatch` and its monitor routes are backed by one
launcher-owned in-process runtime. The runtime freezes the selected family,
role, work record or slice, managed worktree binding, read and write authority,
model registration adapter, host wiki-MCP server, named-FIFO conduit, and
lifecycle owner before spawning the role.

## Supported families

Confined Claude and Codex roles are supported when their runtime and bubblewrap
contracts validate. Worker, reviewer, and redteam sessions use the same R union
W namespace construction and write-scope enforcement; reviewers and redteam
have no writable repository paths. Claude preserves native-edit permission
settings and settings masking. Codex preserves its isolated runtime home and
launcher-generated configuration overrides. Agy remains unsupported and fails
closed.

## Launch and monitoring

`start_launch` validates readiness and starts the selected family executor
directly. `probe_run` reads the in-memory launcher run state directly. Run IDs
and monitor handles are launcher-minted correlation values and never accepted
as caller authority. Cancellation or any client, relay, host-server, or model
exit tears down the same per-dispatch lifecycle.

Managed worktrees are provisioned in-process from canonical launcher roots.
After an exact-slice worker terminates, the runtime prepares the retained slice
review surface and parks until the separate `workspace_integrate_committed_slice`
coordinator continuation completes. The server derives the exact target and CCE
owns every configured organization-policy decision; paid-tier presence alone
configures no gate. No transport response or orchestrator request can substitute
repository truth, binding identity, CCE authority, or compare-and-swap results.

Exact-slice findings-only review is plural. Every valid reviewer or policy-allowed
redteam dispatch for the same exact committed target is independently admissible
and receives distinct run identity, monitoring state, and an append-only receipt.
Active reviews and receipt history never block another review. Evidence is retained
per run and exact target; target movement preserves old evidence as inapplicable.

Findings and clean output are advisory evidence with no admission, deferral, or
veto authority, and disagreement remains visible. The orchestrator may disposition
comments and request integration, but the request is not authorization. A configured
CCE gate fails closed on missing, unavailable, malformed, unratified, denied, or
target-mismatched evidence; no configured gate follows decision free-substrate
behavior and reports non-audit posture honestly.
Worker and reviewer concurrency is expected; attempt isolation plus exact ref/status
CAS provide collision safety rather than singleton lifecycle consumption.

## Wiki-MCP boundary

See [MCP integration](mcp-integration.md). One host wiki-MCP process directly
terminates two named FIFOs bound into the client's bubblewrap namespace. The
client uses a pinned copy-only relay and completes initialize plus tools/list
against the exact role tool profile. No executable MCP runtime is mounted into
the sandbox.

## Trusted operation ownership

| Operation | Owner |
| --- | --- |
| `start_launch` | launcher runtime, in-process |
| `probe_run` | launcher runtime, in-process |
| `provision_worktree` | launcher runtime, in-process |
| `prepare_slice_review_surface` | launcher runtime, in-process |
| `integrate_slice` | launcher runtime, in-process |
| `commit_slice` | host wiki-MCP server, in-process and closed-input |
| `wk_forge_handoff` | launcher-owned host executor, invoked in-process |

Every failure is returned in the structured dispatch or runtime-blocker
taxonomy. There is no compatibility route to another process boundary.

`wk_forge_handoff` receives backend-resolved exact candidate state plus
exact-candidate-bound advisory review evidence. Clean output does not authorize
publication, findings do not veto it, and missing or mixed review output decides
nothing. CCE alone decides a configured organization-policy gate bound to exact
`C/L/W`; missing, unavailable, malformed, unratified, denied, or target-mismatched
CCE evidence fails closed. Paid-tier presence alone configures no gate. With no
configured gate, decision free-substrate publication proceeds with an explicit
non-audit posture. Candidate, frozen parent, WK tip, record, candidate ref, remote
identity, branch CAS, and exact PR invariants remain mandatory, and the exact
candidate is never reconstructed. Landing-ref movement after construction does
not invalidate the candidate or block publication; merge readiness belongs to
the configured merge actor and CCE policy.

Loss of process memory, a monitor handle, or a prior in-memory binding does not
invalidate the terminal cycle. On restart, trusted runtime re-derives canonical
frozen `L` from C's verified sole parent, re-derives `W` and unique `B`, and
deterministically derives `C`. It verifies the pre-existing candidate ref/object,
expected tree, sole parent `L`, and unchanged `W`, then
mints a fresh non-authorizing runtime projection and reruns exact-candidate
validation. Recovery reads the construction-time contract digest from immutable
`C` commit metadata, reconstructs the complete payload from that digest plus
server-derived `L/W/B`, expected tree, fixed launcher identity, epoch timestamps,
message bytes, and trailing newline, and hashes those exact bytes in the repository
object format. It does not substitute a digest recomputed from the W record or
the merge-result record in C's tree, invoke `commit-tree`, create a Git object, or move a ref.
Missing, ambiguous, moved, or inconsistent Git facts refuse;
historical worker attempts and reviewer monitor state are irrelevant.

## Dispatch-readiness generated write surface

Graph-index refresh may use the fixed eight exclusively claimed candidate names
`.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. An existing persistent shared lock
prevents candidate attempts; slot exhaustion falls back to an independent
atomic build. Candidate files are retained but never reused or authoritative.
