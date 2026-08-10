# proof.result-shape.conformance@1.0.0

## Guarantee

For one declared operation, one grounded result identity, and one grounded schema
identity, the proof plan binds complete populations for observed result-member
descriptors, required member descriptors, optional member descriptors, allowed
member descriptors, forbidden member descriptors, allowed shapes, and forbidden
shapes.

The plan establishes all of the following:

1. every required member descriptor is present in the observed result population;
2. every observed member descriptor belongs to the exact allowed population;
3. every member in the exact forbidden population is absent from the result;
4. the observed result shape belongs to the exact allowed-shape population and
   does not belong to the exact forbidden-shape population; and
5. the emitted result count equals the exact observed-member population
   cardinality.

A member descriptor identifies both a member and its declared type. A wrong-type
result therefore presents a different descriptor: the required typed descriptor
is missing and the observed typed descriptor is not allowed.

The verification must read the result, schema, all comparison populations, shape,
and count signal. Each verified behavior has a falsifier that observes the
controlled complement of the named comparison; status success alone cannot
satisfy the profile.

## Explicit exclusions

- Truthfulness or completeness of caller-authored schema and population bindings.
- Whether a syntactically grounded result or schema identity resolves to a real
  repository or runtime target.
- Proof that delivered test code implements the matched plan.
- Presence of optional members; the optional population declares permitted
  descriptors, not required descriptors.
- Equality of the allowed population with the union of required and optional
  populations. The allowed population is bound independently and exactly.
- Recursive validation of nested objects, collections, or member values unless
  those are represented as their own descriptors.
- Conditional and cross-member invariants.
- Business meaning, value ranges, units, normalization, or referential integrity.
- Serialization format, transport envelope, HTTP status, media type, pagination,
  and schema-version negotiation.
- Compatibility between two different result surfaces or schema versions.

## Adequacy controls required for release

Positive implementations cover unrelated object-property, Map-entry, and tuple
result domains, including a valid result that omits a declared optional member.

Implementation mutants remove a required member, add an undeclared member,
replace a required typed descriptor with a wrong-type descriptor, add an
explicitly forbidden member, select a forbidden shape, or report a wrong count.

Profile negatives include status-only and suite-covers-symbol/negation-only
verification, missing result/schema stimuli, missing comparison or read-spine
claims, wrong falsifiers, missing or collapsed grounded role bindings, weakened
types/modalities/count bindings, removed relations, and removed satisfaction
branches.

The fixed negative corpus groups independently tagged variants into semantic,
reference-role, and aggregate-constraint bases. Every declared coverage binding
has one exact variant that the canonical profile rejects and one corresponding
schema- and semantics-valid weakened profile that admits it. The witness index
records those profile patches, including the operator witness that changes
`reference:returns` to `reference:creates`. Cardinality broadenings that make the
profile semantically invalid are not claimed as critical-surface coverage.
