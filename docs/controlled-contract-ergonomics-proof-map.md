# Controlled-contract ergonomics: contract and proof-obligation map

This document specifies the behavior and verification design for [work record](../wiki/work-records/work record.json). Its seven acceptance criteria expand into 45 atomic obligations. Row numbers correspond to obligation labels `OBL-WK2520-001` through `OBL-WK2520-045`.

Work status, review dispositions, validation results and runtime incidents belong in the work record and its evidence records.

## Design boundaries

Use the existing [controlled-contract operations](mcp-controlled-contract-operations.md), [measurement definitions](agent-tool-compliance-and-surface-rationalization.md), and committed-index contract in [decision](../wiki/decisions/decision.json). Preserve the incumbent semantic, projection, snapshot, publication, proof, receipt, recovery and graph owners. work record owns its correctness and closure obligations; work record owns proof-definition/execution changes.

## Proof interpretation

Candidate intent names below refer to the `controlled-proof-intent.*` catalog. Each binding must use the selected pack's exact capability and limitations. Behavioral-preservation requires equal captured bytes and cannot prove token reduction. Single-winner-effect covers exactly two overlapping attempts and cannot alone prove arbitrary fan-out. An explicit gap identifies a requirement for which a suitable binding or measurement must still be established.

Every runtime-test obligation requires a scoped registered-route test, an observable, a falsifier that fails the actual assertion, declared/observed inventory and provider-bound execution/traversal evidence where supported. Analysis obligations require captured artifacts and explicit uncertainty. Source-module entries identify candidate implementation boundaries; the work record owns executable scope.

## Acceptance 1: assessment

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 1. Complete journey accounting | Count all observed calls, successful and failed, with phase/outcome and explicit unobserved phases. | Reconcile retained request/result sequence with ledger; dropping one success or failure must fail completeness. | result-shape-conformance |
| 2. Cost attribution | Separate semantic judgments, mechanical calls, retrieval, cold discovery and coordinator mistakes. | Classify each step with evidence; changing a caller mistake to required tool overhead must fail classification. | explicit_gap:semantic cost classification |
| 3. Evidence identity | Bind observations to the actual runtime/client/source identities and distinguish historical traces. | Mixed runtime or unrelated WK evidence must be excluded from current rates. | direct-source-authentication-provenance |
| 4. Missing evidence stays missing | No success rate or token claim from failure-only or missing capture. | Remove success denominator or model-facing capture; result remains unevaluable with exact missing evidence. | result-shape-conformance |
| 5. Incumbent mechanism inventory | Locate existing producer and consumer owners and capability limits before choosing changes. | Trace each proposed change to an owner; a duplicate owner or unverified capability is an unresolved gap. | explicit_gap:owner inventory inspection |

Candidate subject boundary: `wiki/work-records/work record.json`. Individual row overrides: none. Method: analysis; this does not claim execution.

## Acceptance 2: authoring

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 6. Meaning once | Retain each accepted semantic answer through all mechanically determined follow-through. | One coherent answer reaches intended current owner state; a repeated identical answer creates no duplicate meaning. | idempotent-effect-nonduplication |
| 7. Deterministic continuation | Backend performs safely determined subsequent operations through incumbent owners. | A known deterministic prerequisite does not become another authored question; instrument owner calls. | integration-prefix-safety |
| 8. Ambiguity boundary | Ask only for genuinely missing meaning and never invent a selection. | Two admissible semantic choices cause an explicit question; unique choice causes supported continuation. | result-shape-conformance |
| 9. Incremental edit | Changing one requirement preserves unrelated meaning and uses incumbent source evolution. | Compare all unaffected contract nodes and mappings; stale or incompatible mapping is explicit. | bounded-interval-nonmutation |
| 10. Batch atomicity | A bounded semantic batch either publishes its intended complete population or reports the incumbent failure outcome. | Invalid member and injected between-effect failures cannot yield unreported partial success. | atomic-failure-boundary |
| 11. Recoverable progress | Effect-free failure retains answers where incumbent semantics allow retry; retry converges without duplicate publication. | Inject before-write refusal, retry through returned route, and verify one successful effect. | retry-convergence + idempotent-effect-nonduplication |
| 12. Outcome uncertainty | Unestablished effects do not reopen publication; established effects survive response-rendering failure truthfully. | Inject after-write/receipt/presentation faults; return established or unknown effect separately from settlement, with no blind replay. | supplementary-failure-isolation + idempotent-effect-nonduplication |

Candidate subject boundary: `packages/wiki-core/src/operations/controlled-contract/design-workbench-operations.mjs`. Individual row overrides: none. Method: test_execution; this does not claim execution.

## Acceptance 3: results

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 13. Actionable first response | Default result includes the current semantic question, required input shape and executable primary continuation. | Fresh contract and next-question stages require no fetch solely to learn the only actionable answer. | result-shape-conformance |
| 14. Durable outcome receipt | Report written/no-op/refused/unknown effects and owner receipt independently of presentation success. | Compare returned effect facts with trusted owner receipt at every failure boundary. | visibility-after-durable-settlement |
| 15. Alternative completeness | A ranked primary action never conceals the complete set of alternatives. | Enumerate all alternatives through incumbent complete route; totals and membership must match. | lossless-projection |
| 16. Executable next call | Every advertised continuation has all server-known arguments and identifies only genuinely authored inputs. | Invoke advertised continuation unchanged apart from required semantic answers; stale/invalid paths return typed recovery. | result-shape-conformance |
| 17. Compact review result | Ordinary review monitoring avoids repeated full advisory text while retaining exact text and provenance through complete retrieval. | Reconstruct exact original result once; repeated full payload copies must be detected by measured projection. | lossless-projection |
| 18. Lifecycle composition | Combine only mechanical disposition/closure follow-through that existing authority allows. | Independent decisions remain explicit; composed writes preserve scopes/CAS/receipts and expose partial or unknown outcomes. | atomic-failure-boundary |

Candidate subject boundary: `packages/wiki-core/src/operations/controlled-contract/design-workbench-operations.mjs`. Individual row overrides: Compact review result: `packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs`; Lifecycle composition: `packages/wiki-core/src/operations/work-record-contract-edit.mjs`. Method: test_execution; this does not claim execution.

## Acceptance 4: measurement

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 19. Paired benchmark | Use identical semantic task/outcome on pinned baseline and candidate runtimes across add/edit/recover journeys. | Reject changed task, missing journey, changing client projection or unrelated historical baseline. | explicit_gap:paired benchmark analysis |
| 20. Actual token accounting | Measure exact model-visible inputs and outputs with recorded client/model/tokenizer and channel projection. | Independently recount captured representation; transport bytes or presumed dual-channel duplication cannot pass. | explicit_gap:client model-facing capture |
| 21. Calls and repetition | Compare required calls, retrieval calls and repeated semantic inputs separately from payload size. | Count every call and repeat in both traces; include refused writes and recovery, exclude unrelated coordinator work explicitly. | explicit_gap:workflow cost analysis |
| 22. Useful improvement | Both token cost and required call count must improve without lost outcomes or information. | Numeric thresholds remain to be bound from baseline; a smaller response with added retrieval cost cannot pass aggregate comparison. | explicit_gap:numeric thresholds unbound |
| 23. No local policy | Performance thresholds are measured acceptance, never new admission or runtime refusal rules. | Inspect changed routes and negative cases for unauthorized threshold-based refusals. | forbidden-operation-noninvocation |

Candidate subject boundary: `wiki/work-records/work record.json`. Individual row overrides: none. Method: analysis; this does not claim execution.

## Acceptance 5: retrieval

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 24. Lossless reconstruction | Compact output plus disclosed detail recovers the exact complete semantic source. | Compare reconstructed population and selected values, including omitted large fields. | lossless-projection |
| 25. Exact page traversal | Visit every ordered occurrence once with one terminal page and correct total/returned/remaining counts. | Empty/single/multipage/oversized-member cases and duplicate/drop/reorder mutations discriminate failure. | complete-pagination-traversal |
| 26. Snapshot consistency | Pagination across source changes uses the incumbent snapshot policy without mixing versions. | Mutate source between pages; immutable snapshot stays fixed, authenticated stale mutation continuation refuses. | mutation-consistent-pagination |
| 27. Unavailable snapshot recovery | Unknown, expired, cross-WK and restart-lost state never produces an unusable recovery instruction. | Exercise each case; preserve exact required retained input and avoid invented retry paths. | refusal-before-effects |
| 28. Large semantic row | Large rows expose enough task input without forcing field-by-field assembly of one coherent answer. | Inspect and answer a row whose current default projects a field inventory; preserve lossless detail for remaining data. | result-shape-conformance |
| 29. Truthful omissions | Every omission or redaction has correct count and enumerated reason, without a completeness gate based on arbitrary byte caps. | Remove/mislabel omission or introduce forbidden data; gate rejects the loss, not an arbitrary payload-size target. | lossless-projection |
| 30. One projection owner | Reuse current state/count projection, snapshot, vocabulary and next-call owners. | Architecture/source inspection plus route traversal reveals any duplicated state derivation, codec or public front door. | forbidden-operation-noninvocation |

Candidate subject boundary: `packages/wiki-core/src/operations/controlled-contract/design-workbench-operations.mjs`. Individual row overrides: none. Method: test_execution; this does not claim execution.

## Acceptance 6: index

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 31. Fresh reuse | A valid graph for captured committed HEAD is reused without rebuild. | Repeat consumer calls at same HEAD; count builder starts and unchanged artifact identity. | bounded-state-stability |
| 32. Automatic rebuild cases | Missing, other-commit, corrupt and incompatible-generator/schema caches rebuild automatically and the consumer continues. | Exercise each distinct state against shared builder; no normal stale-index operator handoff remains. | readiness-before-success |
| 33. Captured HEAD | Resolve commit once for a consumer operation; a later HEAD change cannot relabel the captured graph. | Move HEAD during ensure/query and verify fixed-basis result or typed failure. | exact-ownership-isolation |
| 34. Dirty independence | Dirty, deleted and untracked worktree paths do not affect or block the committed graph. | Compare clean/dirty cases at same commit; emitted basis does not imply dirty edits were indexed. | bounded-state-stability |
| 35. Equivalent build coalescing | Equivalent concurrent requests share one build/publication without stale or partial results. | Two overlapping consumers plus multi-consumer stress: one elected effect, all consistent consumers. | single-winner-effect + idempotent-effect-nonduplication |
| 36. Different-commit isolation | Concurrent requests for different commits cannot consume one another's cache identity. | Interleave two captured HEAD requests and verify distinct correct graph bindings. | exact-ownership-isolation |
| 37. Atomic cache publication | Failed/interrupted build cannot publish partial/incompatible cache as usable. | Inject build/write/rename failures and verify only complete prior or complete new artifact may be consumed. | atomic-failure-boundary |
| 38. Real failure reporting | Failed rebuild reports typed mechanical or returned-policy failure and required action, without stale substitution or blind retry. | Inject generator absence, permission/disk failure and unstable source; preserve first cause and supported recovery. | failure-settlement-and-cleanup |
| 39. Owner and surface conformance | Every selected graph-dependent consumer uses the shared ensure/query owner and consistent docs/discovery/FAQ. | Complete consumer inventory plus registered-route tests; old overlay/operator-refresh assumptions cannot survive in affected surfaces. | explicit_gap:consumer inventory and scope unresolved |

Candidate subject boundary: `packages/wiki-core/src/operations/authoring-ergonomics.mjs`. Individual row overrides: none. Method: test_execution; this does not claim execution.

## Acceptance 7: authority

| Row | Obligation | Planned proof and negative control | Candidate intent or gap |
| --- | --- | --- | --- |
| 40. Source and CAS fencing | Stale, cross-WK, cross-focus or cross-generation semantic answers cannot mutate the wrong current source. | Race and substitution cases verify refusal before protected effects. | refusal-before-effects |
| 41. Replay and winner isolation | Duplicate/replayed/concurrent continuation attempts obey incumbent exactly-once/single-use semantics. | Distinguish idempotent replay from single-use refusal; test winner/loser and effect-free failed attempt behavior. | idempotent-effect-nonduplication + single-use-replay-refusal |
| 42. Protected write scope | Authoring and cache recovery mutate only their declared canonical or ignored-cache resources. | Complete observed mutation population must stay within authorized targets, including failure cleanup. | write-confinement |
| 43. No fabricated proof | Authoring, candidate packs and incomplete tests provide no proof, audit, readiness or completion credit. | Absent runtime IDs/receipts/provider capability remain not proven or explicit gaps. | result-shape-conformance |
| 44. Local evidence boundary | Client capture remains local work evidence and identifiable data never enters admission metrics. | Inspect and exercise capture-to-metrics serialization with forbidden transcript/path/digest sentinels. | forbidden-operation-noninvocation |
| 45. Lifecycle sufficiency | Complete controlled requirements/proof map, truthful remaining gaps and exact scopes precede implementation shaping. | Require exact readiness route; missing scopes/test mechanisms/measurements remain unresolved rather than opted out. | implementation-readiness |

Candidate subject boundary: `packages/wiki-core/src/operations/controlled-contract/design-workbench-operations.mjs`. Individual row overrides: Local evidence boundary: `packages/agent-launch-cli/src/lib/stdio-mcp-transcript-capture.mjs`. Method: test_execution; this does not claim execution.

## Proof binding requirements

- Bind each obligation to an exact mechanism and suitable proof-pack component, with its capability limits recorded. Keep analysis, generic test validity and requirement-specific behavior distinct.
- Specify implementation/test loci, test identities, observables, falsifiers, inventory and traversal requirements before claiming executable proof coverage.
- Inventory graph-dependent consumers and verify both their use of the shared owner and the owner's behavior.
- Compare equivalent add/edit/recover tasks on identified baseline and candidate implementations. Capture actual requests/results and verify durable outcomes, preservation of unrelated meaning and exactly-once correction.
- Record the observed client/model/tokenizer and channel projection for token measurements. Transport bytes and predefined step lists cannot establish model-visible token improvements.
- Evaluate implementation scope against module-size and refactoring requirements. Candidate module paths do not establish scope feasibility.

## Ergonomics design requirements

| Surface | Required behavior | Obligations |
| --- | --- | --- |
| Actionable responses | Return a complete semantic question, operative input schema and executable primary continuation together; preserve counted retrieval of alternatives. | 13, 15, 16, 28 |
| Input constraints | Expose nested shapes, batch limits, identifier formats, atomicity and method-partitioning constraints before submission. Refusals identify the rejected constraint, effect state and supported correction. | 8, 10, 11, 13, 16, 29 |
| Incremental authoring | Preserve accepted and unrelated meaning while remaining requirements are authored. Avoid premature proof-selection requirements and repeated semantic input. | 6, 7, 9, 10 |
| Mechanical continuation | Execute safely determined publication and compilation through existing owners; preserve per-operation receipts, source fencing and failure boundaries. | 6, 7, 12, 18, 40, 41 |
| Obligation populations | Support multiple atomic obligations per acceptance criterion through existing atomic batch mechanisms. | 7, 10, 16 |
| Contract inspection | Provide a joined requirement, verification and obligation view with exact identities and complete detail retrieval. | 5, 13, 24, 30 |
| Recovery | Route to the actual semantic prerequisite; report operation-local refusal, durable effects and supported recovery consistently. | 11, 12, 14, 16, 29, 43 |
| Shared context | Avoid repeated full advisory text and repeated mapping context while preserving exact per-item retrieval and accounting. | 17, 24, 25, 30 |
| Code index | Automatically ensure the shared committed index and continue. Preserve captured-HEAD consistency, coalescing and atomic publication; report actual rebuild failures. | 31–39 |
| Measurement | Derive costs from executed journeys, distinguish observations from attribution, and compare equivalent outcomes without substituting bytes or synthetic sequences for token measurements. | 1–4, 19–23 |
