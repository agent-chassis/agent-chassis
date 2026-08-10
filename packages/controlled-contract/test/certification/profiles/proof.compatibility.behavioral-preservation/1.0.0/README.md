# Behavioral-preservation proof pack 1.0.0

`proof.compatibility.behavioral-preservation@1.0.0` is the v0.34
exact-bound profile for checking one caller-declared baseline behavior report
against one caller-declared candidate behavior report for the same logical
source.

## Exact declared-world guarantee

Satisfaction establishes only in the declared controlled contract that:

1. one declared logical source emits two distinct declared result surfaces;
2. each result exposes a distinct complete population of typed member
   descriptors, a distinct exact-count signal, and one explicitly selected
   canonical value;
3. the two complete member populations are equal by mutual controlled subset;
4. both member roles bind the same exact nonnegative integer and each result's
   count signal equals that integer;
5. the selected canonical value pair is related by literal controlled equality;
   and
6. one verification reads the source, both results, both populations, both count
   signals, and both selected values, while five separate verification claims
   carry controlled complements for the behaviors they verify.

The v2 admission also captures the complete bytes of both result artifacts from
two distinct caller-selected source descriptors. Their SHA-256 values must be
equal. The captured role coverage, contract, evaluation input, declaration,
certification, admission, and vocabulary identities are joined into the same
assessment context; an omitted, stale, or substituted input is a non-pass.

Mutual subset is intentional. `reference:equals` between the population
references would assert identity equality and conflict with their required
distinctness. A typed member descriptor carries the caller's logical-member and
declared-type identity; a wrong-type descriptor is therefore a different member.

## Explicit exclusions

- truthfulness or completeness of caller-authored populations;
- proof that two different source paths have different filesystem objects,
  producers, execution origins, or trustworthy baseline/candidate provenance;
- authoritative construction or existence of typed member descriptors;
- proof that runtime surfaces came from the declared logical source;
- delivered test implementation or result-value authenticity;
- field-name mapping, schema mapping, coercion, normalization, unit conversion,
  rounding, timezone conversion, or lossy serialization;
- automatic or arbitrary pairing of multiple members or canonical values;
- nested recursive value parity or optional-field semantics beyond the supplied
  complete populations;
- ordering, transport, media-type, pagination, or streaming parity;
- business semantics, referential integrity, or cross-member invariants;
- truthfulness, compatibility, or equal permissiveness of independent schemas;
  and
- applicability selection.

Version 1.0 binds exactly one caller-selected canonical value pair. It does not
zip independent value populations, infer correspondence, or normalize values.

## Controlled proof shape

The profile binds 17 reference roles and one shared integer number role. Two
complete-population bindings establish closed membership, two role-count bindings
share the exact member count, four distinct-role sets prevent collapsed proof
subjects, 14 claim patterns express source, exposure, mutual subset, count,
selected-value, and read-spine obligations, and five verification relations bind
five controlled falsifiers.

## Executable adequacy

The ordinary adequacy module exercises JSON-versus-protobuf, SQL-row-versus-search-
document, and CLI-table-versus-JSON behavior reports. It kills missing and extra members,
one-member substitution, wrong-type descriptors, wholly different same-count
populations, wrong source linkage, collapsed surfaces, count-only proof,
one-sided inspection, permissive independent schemas, and selected-value
mismatch. Fourteen missing-obligation controls and twelve exclusion controls
complete the executable declaration.

The fixed negative census classifies every semantic profile field: 87 critical
surfaces have independently authored JSON fixtures and rebound weakening
witnesses; 110 surfaces carry mechanically validated noncritical reasons.
Full-census certification rejects all 87 fixed negatives, validates all 87
weakening witnesses and their individual patch ablations, and is deterministic
across repeated runs.

The exact-binding corpus adds 12 controls covering byte equality, byte mismatch,
distinct source descriptors, omitted and extra sources, role-coverage swaps,
context splices, stale/noncanonical declarations, and source-map order. Reusing
one descriptor for both roles is rejected. Different descriptor paths are the
declared local boundary: byte-identical copies and hard links are accepted, and
neither is claimed to establish honest provenance.
