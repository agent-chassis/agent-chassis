# proof.scope.write-confinement@1.0.0

## Guarantee

For one declared execution, every member of the caller-declared observed mutation
population belongs to the caller-declared authorized target population. Both
populations are complete only with respect to those caller declarations. The
execution is linked to the observed population, and one verification reads the
execution and both populations, verifies the subset behavior, and carries the
controlled `reference:not_subset_of` falsifier.

Both member populations use `zero_or_more`. An explicitly empty observed
population is therefore valid against a nonempty authorized population, and both
populations may be explicitly empty. Exact cardinality and membership are still
required for each declared population.

The profile evaluates at `pre_dispatch`. It certifies the discrimination and
structure of a proposed proof plan; it does not represent captured post-delivery
evidence or runtime observation.

## Explicit exclusions

- Truthfulness, authority, or completeness of the caller-declared authorized
  population.
- Observation completeness beyond the caller-declared observed population.
- Snapshot producer provenance or a launcher-owned observation boundary.
- Causal attribution of a mutation to the declared execution.
- Undiscovered, transient, reverted, retry, concurrent, thread, process, or
  namespace mutations outside the caller declaration.
- Runtime target existence, resolution, or truth.
- Prevention or rollback of an unauthorized mutation.
- Exact binding between a contract, execution, snapshot, and population.

This pack must not be described as proving write confinement in runtime reality.
It proves only subset membership over two explicit caller-declared populations.

## Adequacy controls required for release

Positive controls cover filesystem paths, database records, and Kubernetes
resources, plus an empty observed population and both populations empty.

Mutants add an unauthorized mutation, compare a nonempty observed population
with an empty authorized population, substitute members without changing count,
mismatch either declared count, omit an observed or authorized member while
retaining the old count, and replace an authorized member at the same count.

Plan rejections cover missing or mismatched population evidence, a wrong
execution/population link, a missing or replaced subset behavior, status-only or
missing verification reads, wrong or unscoped falsifiers, missing verification
relations, missing bindings, and collapsed population identities.

The three fixed-negative JSON files are independent release inputs. They do not
contain the candidate profile. Every critical binding has one canonical
rejection and one schema- and semantics-valid re-digested weakened-profile
survivor. Indexed and full-census certification must both pass with exact static
dependency closure and deterministic result bytes.
