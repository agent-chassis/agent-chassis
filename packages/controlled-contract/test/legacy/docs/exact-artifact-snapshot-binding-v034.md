# Exact Artifact and Snapshot Binding v0.34

> Experimental free-tier substrate. This mechanism binds evaluation to exact
> captured bytes. It does not establish evidence provenance, authorize work,
> admit CCE policy, or make filesystem paths authoritative.

## Decision

The v0.34 binding surface is split into a pure evaluator and an outer capture
runner:

- `experimental/exact-binding-v034.mjs` validates an immutable binding set
  without filesystem access. Even a satisfied direct result is marked
  `admission.kind: unadmitted_direct`.
- `experimental/exact-binding-runner-v034.mjs` captures artifact or canonical
  snapshot bytes, derives their SHA-256 identities, and passes the resulting
  binding set to the pure evaluator. Its outer envelope is marked
  `local_exact_byte_capture`, while the nested result remains unadmitted.

The machine-readable carriers are defined in
`schema/controlled-contract-exact-binding.experimental.v0.1.schema.json`.
This is a separate extension schema: the existing v0.2 verification-profile
schema and current proof-pack profile bytes and digests are unchanged. Combining
this carrier with the general verification-profile result in a later unified
schema would be an explicit schema and profile-digest migration, not a silent
widening of the existing evaluator.

## Profile requirements

An exact-binding profile extension declares `exact_binding_requirements`. Each
requirement has one stable `requirement_id`, one binding kind, optional
profile-pinned `expected_content_sha256`, and exact role coverage with one
projection per role. `distinct_capture_requirement_sets` can additionally
require named requirements to come from different captures.

The extension is a closed object. It accepts only the exact-binding requirement
fields plus the optional v0.2 `schema_version`; unknown fields at the extension,
requirement, or role-coverage level are invalid. The matching closed evaluation-
input extension contains only `reference_bindings`, whose entries contain only
`role` and `reference_ids`. Runtime validation and the extension schema enforce
the same shapes. A malformed or schema-forbidden profile or reference binding
produces an `invalid` pure evaluation instead of being ignored or escaping as a
raw type error.

Supported binding kinds are:

- `artifact_bytes`;
- `complete_reachability_snapshot`; and
- `observed_execution_mutation_snapshot`.

Supported projections are:

- `artifact_subject`;
- `snapshot_subject`; and
- `snapshot_population`.

Every requirement matches exactly one binding by `requirement_id`. Required
role coverage must exactly equal the evaluation input's reference IDs. Extra
coverage, an undeclared reference, an orphan binding, a wrong kind or projection,
or an alias to a different reference cannot satisfy the extension.
`artifact_subject` and `snapshot_subject` coverage each carry exactly one
reference ID. A `snapshot_population` may carry an empty reference-ID array when
the captured complete population is empty; no other projection admits an empty
array.

A profile-pinned digest is part of the profile bytes and is therefore included
in the profile digest that binds the evaluation context. A digest supplied in a
capture request is only an equality precondition checked against freshly
captured bytes. Neither form substitutes for captured evidence.

## Pure evaluation

The pure API is:

```js
evaluateExactBindingsV034({
  profile,
  evaluation_input,
  contract_reference_ids,
  input_digests: {
    contract_sha256,
    profile_sha256,
    evaluation_input_sha256
  },
  binding_set
})
```

It imports only `node:crypto`. It validates binding structure, the three input
context digests, requirement-to-binding coverage, known contract references,
profile-pinned content digests, and distinct capture sets. It does not read a
path or execute a resolver.

Missing required bindings are `indeterminate`. Malformed, duplicate, stale-
context, or splice-shaped inputs are `invalid`. Deterministic kind, coverage,
projection, digest, orphan, and distinct-capture failures are `unsatisfied`.

## Exact capture

The outer API is:

```js
runExactBindingEvaluationV034({
  contract_bytes,
  profile_bytes,
  evaluation_input_bytes,
  capture_requests,
  captured_byte_checks,
  hooks
})
```

The runner hashes the raw contract, profile, and evaluation-input bytes and
places all three digests in the binding-set context. This prevents a valid set
from being spliced into a different evaluation.

For an artifact request, the runner:

1. resolves the canonical capture root;
2. opens the requested final component once with `O_NOFOLLOW`;
3. requires a regular file and uses `/proc/self/fd/<fd>` to prove that the
   opened object is inside the capture root;
4. reads from that same descriptor; and
5. rejects changes to device/inode, mode, size, or mtime during the read.

A pathname replacement after open cannot replace the captured bytes. Mutation
of the opened inode during capture is refused. Final-component symlinks are
refused. Intermediate symlinks are tolerated only when open-descriptor identity
proves confinement. If that identity cannot be established, capture fails
closed.

Captured bytes stay in a closure and each checker receives a copy. This permits
a captured-byte comparison such as the P8 baseline/candidate equivalence check
without allowing the checker to mutate the retained capture. The result repeats
the check mode, result, expectation when applicable, requirement IDs, and pass
state. A required check must declare `expected_result` (its input mode defaults
to `required`); a false or other unexpected value can never pass merely because
the expectation was omitted. A checker with no pass/fail effect must explicitly
declare `mode: "informational"`; its envelope has `passed: null` and no
`expected_result`.

Check results and expectations must be JSON-domain values. The runner rejects
internal-slot and non-JSON values such as `Date`, typed objects, non-finite
numbers, accessors, sparse arrays, symbols, and cycles. It canonical-clones both
values, compares canonical bytes so object-key order has no effect, and deeply
freezes the isolated clones. Later mutation of a checker-owned result or
caller-owned expectation cannot mutate the envelope.

## Canonical snapshot bytes

Artifact identity is SHA-256 over verbatim file bytes. Paths, timestamps,
reference identity prose, text decoding, and newline conversion do not enter the
content identity.

Snapshot identity is SHA-256 over UTF-8 canonical JSON without a BOM or trailing
newline. Object keys are ordered by JavaScript code-unit order. Domain strings
are NFC-normalized and NUL is refused. Unknown fields are refused.

For complete reachability snapshots, nodes are sorted by `node_id` and edges by
`(from,to,kind)`. Duplicate normalized node IDs, node reference IDs, and edges
are refused; every edge must name present nodes; and `complete` must be literal
`true`. `snapshot_subject` is derived from `snapshot_reference_id`, while
`snapshot_population` is derived from every captured node's
`node_reference_id`.

For observed execution mutation snapshots, mutations are sorted by
`mutation_reference_id`. Duplicate mutation reference IDs are refused.
Create/update/delete digest shapes are enforced, including refusal of no-op
updates, and `complete` must be literal `true`. `snapshot_subject` is derived
from `execution_reference_id`, while `snapshot_population` is derived from every
captured mutation's `mutation_reference_id`.

Callers supply only the requested snapshot role projections. They cannot supply
an independent population list that differs from the canonical captured bytes.

## Binding and result identity

The canonical binding set contains its version, the three input digests, and
bindings sorted by `binding_id`. Each binding repeats its requirement and
capture IDs, kind, media type, content digest, byte length, and exact role and
reference coverage. `binding_set_sha256` covers that complete canonical set.

Role coverage is canonicalized before `capture_id` derivation as well as before
binding-set hashing. Equivalent role and reference ordering therefore produces
the same capture ID, public binding, and binding-set digest.

Both the outer envelope and nested pure result repeat the canonical bindings and
binding-set digest. Paths and private capture observations are omitted from the
public result. The outer admission marker explicitly states that filesystem
paths and caller-reported digests are not authoritative.

JSON Schema validates the envelope carrier but cannot prove equality between
its repeated fields. Consumers must also call
`validateExactBindingRunnerEnvelopeV034(envelope)`. The semantic validator
recomputes the binding-set digest from outer `inputs` and `bindings`, checks the
outer digest and canonical bindings against the nested evaluation, checks both
authority/admission markers, re-derives required check pass states, and
re-derives outer satisfaction. A structurally valid cross-run splice therefore
fails semantic validation.

## Validation

Run the functional, adversarial, and strict-schema tests with:

```sh
node --test \
  packages/controlled-contract/test/exact-binding-v034.test.mjs \
  packages/controlled-contract/test/exact-binding-v034.pressure.test.mjs \
  packages/controlled-contract/test/exact-binding-v034.schema.test.mjs
```

The tests cover P8 byte comparison, P11 graph snapshots, P13 mutation
populations, deterministic multi-artifact capture, profile-pinned digests,
missing and stale bindings, binding-set splicing, role/reference aliasing,
caller-digest injection, symlink escape, same-inode mutation, concurrent
pathname replacement, canonical reordering and canonical check comparison,
strict carrier validation, malformed-input totality, result isolation,
cross-run envelope splicing, and the pure module's lack of filesystem imports.

## Remaining trust boundary

This substrate proves which bytes were evaluated. It does not prove that an
untrusted producer described reality honestly.

- P8 still needs an authoritative baseline selector, such as a profile-pinned
  digest or trusted artifact resolver. A mislabeled baseline is captured and
  revealed accurately, but its semantic provenance is not inferred.
- P11 still needs a trusted graph producer to prove that the captured graph is
  executable and exhaustive. Requiring `complete: true` cannot discover an
  omitted node or edge.
- P13 still needs a trusted observation boundary to prove that the mutation
  population is exhaustive for the named execution.
- A behavioral captured-byte checker remains executable evidence whose code
  identity and adequacy must be bound by the consuming proof pack.
- Artifact capture assumes an honest local kernel and filesystem. Mutation that
  preserves inode, size, and mtime is outside the detector's boundary.

These are evidence-provenance boundaries. They do not justify moving filesystem
access into the pure evaluator.
