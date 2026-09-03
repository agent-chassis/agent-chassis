# Integration prefix safety proof pack 1.0.0

`proof.integration.prefix-safety@1.0.0` establishes a local, declared-world
proof over the complete case population produced by the package-owned
`integration-prefix-census.v1` transformer.

## Exact guarantee

Every independently integrable prefix mechanically derived from one captured
complete declared DAG and integration-unit partition has one case for every
declared execution path and required branch. The exact derived case population
is bound into the profile. Every case must carry a preserved-state claim, the
aggregate preservation result must record that population, and a verification
must read the exact DAG, units, path requirements, census, every case, and the
aggregate result. A positive non-preservation result is the controlled
falsifier.

This means a target-present branch declared in the captured execution-path
source cannot be replaced by a status-only or generic coverage assertion: its
derived case is mechanically part of the required role population and needs its
own preserved-state claim.

An atomic producer/consumer integration unit is legitimate. It produces no
producer-only prefix because the transformer enumerates integration units, not
arbitrary slices.

## Release controls

The ordinary executable adequacy run has 18 controls: three cross-domain
positives, three branch-sensitive mutants, six profile rejections, and six
explicit boundary demonstrations. The full negative corpus contains 44 fixed
counterexamples and 44 re-digested weakening witnesses. Both indexed and
full-census runs must pass without diagnostics.

The v2 admission additionally binds the exact bytes of the DAG, integration
units, and execution-path requirements to the package-derived census. Its
`cases` population is projected from the verified census bytes rather than
copied from the evaluation input. Twelve exact controls cover four positive
captures, omission/substitution/duplication of a derived case, each missing
source, source-descriptor splicing, and result-census splicing. The aggregate
assessment must report structural, profile-discrimination, and exact-binding
axes independently; it never promotes runtime evidence.

## Explicit exclusions

- truth or authority of the caller-supplied DAG, integration-unit partition,
  execution-path list, and required-branch list;
- discovery of production paths or branches absent from those sources;
- truthfulness of authored preservation claims and reference grounding;
- execution, deployment, or runtime behavior outside the captured artifacts;
- concurrency, rollback, rollout orchestration, and current-landing policy;
- proof-pack applicability, evidence authority, CCE consequence, or admission
  beyond this local package result.

The deterministic transformer fails closed above 20 integration units or
100,000 derived cases; it never truncates the proof population.
