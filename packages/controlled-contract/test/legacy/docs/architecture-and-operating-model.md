# Controlled Contracts: Architecture and Operating Model

> **Experimental internal architecture.** This document explains the tracked
> `packages/controlled-contract` package and the design direction carried by
> `initiative`, `work record`, and `work record`. It records mechanical capabilities and
> experimental interpretations. It is not CCE policy, dispatch authority,
> evidence sufficiency, or an adoption decision.

## Executive thesis

An AI coding contract should be more than prose that a worker interprets. It
should also have a closed, machine-readable representation whose omissions,
contradictions, dependencies, proof obligations, and unresolved meaning can be
examined deterministically.

The controlled-contract system is an experiment in building that
representation. Its central move is not to replace prose with a model-generated
summary. It is to constrain contractual statements to a controlled grammar,
compile those statements into a graph, preserve anything the grammar cannot
represent as explicit residue, and then run mechanical analysis over the graph.

The system has reached three distinct capabilities:

1. **Representation.** Controlled claims and relations can encode a substantial
   fraction of real acceptance-contract content while making unsupported
   meaning explicit.
2. **Contract arithmetic.** A native graph can expose missing verification,
   incomplete policy populations, cycles, dependencies, disconnected concerns,
   and aggregate proof structures.
3. **Planning review.** An orchestrator can propose a slice graph and ask the
   assessor whether it preserves the contract DAG, what serialization it adds,
   whether its units fit a supplied execution profile, and how it differs from
   an independently generated anonymous comparison.

The third capability is deliberately phrased as review rather than generation.
An informed orchestrator proposes the plan. Exact graph facts try to falsify it.
The anonymous partitioner is only an optional counterproposal; it is never the
source of slicing authority.

## The five questions the architecture separates

The system began with five questions that are often collapsed into one vague
idea of “structured requirements.” They are separate engineering problems.

### Ontology: what concepts exist?

The ontology names the kinds of things the language can discuss. Current
examples include:

- behavior, evidence, and verification claims;
- modalities such as `MUST` and `MUST_NOT`;
- references to repository paths, symbols, work records, decisions, runs, and
  other controlled identities;
- relations such as `verifies`, `depends_on`, `precedes`, `refines`,
  `derives_from`, `replaces`, and `satisfies`;
- controlled propositions over subjects, operators, operands, and applicability
  contexts;
- closed sets and ordered sequences;
- annotations for nonoperative provenance or rationale;
- residue for operative or contextual source meaning that remains outside the
  controlled representation.

An ontology alone is only a list of nouns and relations. It does not say which
combinations are legal.

### Grammar: what statements can be made?

The grammar defines legal proposition families. Examples include:

```text
operation A MUST returns configuration B
test T MUST verifies behavior C
component X MUST_NOT depends_on component Y
state S MUST has_property P
```

The grammar controls the shape of claims rather than merely suggesting field
names. Operator and operand families must agree. A reference-valued operator
cannot silently accept a number; a numeric range cannot contain several
unrelated ranges in one claim; a verification claim must identify a controlled
falsifying proposition.

### Schema: is one expression structurally legal?

JSON Schema constrains the serialized carrier. It makes many malformed outputs
impossible during constrained generation:

- required arrays cannot be empty;
- enum fields cannot contain invented values;
- claim families expose only their legal fields;
- operand tokens are drawn from invocation-bound terminals;
- collections and relations have required identities and endpoints.

Schema validity is necessary but not sufficient. JSON Schema can prove that a
field contains a legal operator token. It cannot prove that the operator is the
right interpretation of the source contract.

### Operational meaning: what does a consumer do with it?

Mechanical consumers calculate facts:

- claim and relation integrity;
- verification coverage;
- closed-set coverage;
- dependency cycles and topological order;
- cohesive behavior components;
- complexity and parallelism;
- preservation or reversal of dependencies in a proposed plan;
- execution-profile fit.

Policy consumers may later map those facts to `allow`, `refuse`,
`review_required`, or `indeterminate`. That mapping is not part of the free
mechanical substrate.

### Evidence binding: is the declared proposition true?

Evidence binding asks whether a named test ran, whether the result belongs to
the exact delivery, whether the check targets the required behavior, and
whether its falsifier makes the check fail. This is different from declaring a
verification edge.

The current prototype can represent verification and falsifying propositions.
It cannot establish that a delivered test is behaviorally sensitive. A test can
exist, run, pass, and still pass when the defect is reintroduced. That remains a
post-delivery evidence and review problem.

## Architectural overview

The current system is easiest to understand as a sequence of layers:

```text
prose acceptance contract
        |
        v
schema-constrained controlled representation
        |
        +----> explicit annotations
        |
        +----> explicit residue
        |
        v
deterministic compiler and identity binding
        |
        v
native claim/relation carrier
        |
        v
exact contract DAG facts
        |
        +----> local policy-population experiment
        |
        +----> exact behavior decomposition
                    |
                    +----> orchestrator-proposed plan assessment
                    |
                    +----> optional anonymous comparison partition
```

The vertical path is progressively more mechanical. The side branches consume
facts for different purposes and must not be confused with one another.

## Layer 1: prose remains the source contract

The controlled representation does not retroactively make poor prose good. The
orchestrator remains responsible for specifying the intended behavior,
boundaries, dependencies, and proof obligations accurately.

Prose is retained for three reasons:

1. It is the author-facing form from which the controlled representation is
   derived or against which it is checked.
2. It carries rationale and historical context that may not belong in worker
   instructions but still matters to review.
3. It is the evidence against which translation loss can be audited.

The design goal is not “accept any prose.” It is “make unsupported or ambiguous
meaning visible so the author can repair the contract.”

## Layer 2: the controlled grammar

### Claims

The canonical claim kinds are:

- `behavior`: the delivered system does something or has a property;
- `evidence`: a required artifact exists;
- `verification`: a check or inspection must be performed.

Each claim has one modality. Polarity belongs entirely to modality; there is no
separate constraint kind.

### Closed-world `MUST`

A fully structured `MUST` closes the allowed value set of one solution slot:

```text
(subject, predicate, applicability context) -> allowed values
```

This matters because an exclusionary statement may already be implied. If a
slot says the active production transport `MUST` be FIFO, adding a separate
`MUST_NOT` for every alternative selector or fallback can be redundant.

Closure applies only when the complete slot is controlled. A normalized modal
on unresolved prose does not create exclusionary authority.

### References and identities

Claims are useful only when subjects and operands have controlled identities.
The binding layer distinguishes:

- repository paths and qualified code symbols;
- durable record and decision identities;
- invocation-bound source phrases;
- runtime parameters;
- collections and requirement sets.

An addressable token is not proof that the referenced object exists in the
repository. Identity binding and authoritative resolution are separate.

### Relations

Relations serve different purposes and therefore cannot all imply cohesion:

- `refines` between behavior claims defines authored behavioral cohesion in the
  current decomposition experiment;
- `depends_on` and `precedes` define directed behavioral order;
- `verifies` connects a verification claim to behavior without merging their
  implementation concerns;
- traceability relations preserve provenance and design lineage without
  manufacturing implementation dependencies.

This separation was learned empirically. Treating a broad verifier as cohesive
can fuse unrelated behaviors, hide valid dependency cuts, and even create a
cycle in the contracted quotient graph although the source claim graph is
acyclic.

## Layer 3: schema-constrained generation and compilation

### Why constrained output is useful

Constrained decoding ensures that the model can communicate only through legal
carrier shapes. It prevents syntactic improvisation and makes invalid field
combinations unavailable at generation time.

The schema is part of inference context. Field names, enum values, and
descriptions therefore affect both transport complexity and model behavior.

### Readable operators

Earlier compact variants exposed opaque `o###` operator codes to reduce Vertex
constraint complexity. After the grammar itself was simplified, an experiment
showed that readable values such as `reference:replaces` passed transport on a
fixed difficult cohort and consumed fewer prompt tokens than the opaque form,
which required an embedded codebook.

The current v0.33 surface therefore uses readable operators. An opaque storage
code could still be derived after generation if a real storage requirement
appears, but the model should not resolve unnecessary semantic indirection.

### Intrinsic vocabulary foundation

The parallel v0.34 path makes every proposition term inseparable from its
normative definition, signature, normalization, multiplicity, complement,
algebraic traits, mechanical-support status, and applicability. Contract and
proof-profile schemas, carrier indexes, and complement checks are projections
of that one immutable artifact. Missing semantics invalidate the vocabulary;
absence never silently means `none`, and a declared-only trait cannot be
reported as an executed mechanical check.

Agents may query exact definitions or a digest-bound advisory subset rather
than loading the artifact. Those views cannot enter validation. The contract
and profile evaluators always consume the complete vocabulary. Frozen v0.33
contracts and v0.1 proof profiles retain their compatibility path.

Counterfactual is not an applicability mode on this path. A proposition becomes
counterfactual by occupying a verification claim's falsifier role; its ordinary
applicability still states when, before, or under what controlled condition the
falsifier applies.

The vocabulary and carrier do not prove that a hand-authored profile entails
the guarantee named by the profile. Implemented packs therefore carry a second
release gate: an executable adequacy contract with positive implementations,
required mutant kills, profile-level rejections, explicit exclusions, and
domain-neutral fixtures executed against different storage architectures. A
generic loader binds that declaration to its guarantee and canonical profile
digest; the executable module independently names the exact profile digest its
controls cover. A generic runner requires a machine-readable outcome for every
declared control and joins observed mutant behavior back to profile evaluation.
This is separate from schema validity and deterministic pattern matching.

### The compiler remains decisive

Constrained output does not prove semantic correctness. The deterministic
compiler still checks:

- operator and operand compatibility;
- source binding;
- reference grounding;
- range and cardinality shape;
- falsifier discrimination;
- relation integrity;
- residue derivation.

A legal payload may select the wrong operands or reverse the direction of
`replaces`. Those are translation failures, not schema-validity failures.

## Residue: the exact remainder, not an error bucket

Residue is source meaning not represented by an admitted controlled claim or
relation. It is deliberately a dumping ground for the remainder, but not an
undifferentiated backlog of missing vocabulary.

One residue span may be:

- nonoperative rationale, provenance, or a section heading;
- meaning already stored in `read_scope`, `write_scope`, `depends_on`, or
  another authoritative carrier;
- a model translation failure where a valid encoding already exists;
- a compiler, binding, or segmentation defect;
- a defective or underspecified source contract;
- legitimate operative meaning that needs a general vocabulary primitive.

The correct design question is not “how do we drive residue to zero?” It is
“what caused this exact remainder, and which layer owns the correction?”

### Residue corrections already made

The tracked compiler now prevents several misleading forms of residue:

- duplicate entries for the same source span are collapsed while diagnostic
  reasons remain attached;
- uppercase prose is not automatically treated as an identity;
- apostrophes do not create cross-span string literals;
- headings and list items segment structurally;
- semicolon-linked parts of one obligation remain together;
- enumerated operands remain visible even when their candidate claim is
  rejected;
- a verification falsifier must describe a discriminating counterfactual.

These corrections improved the measurement rather than expanding the
vocabulary.

## Layer 4: the native contract carrier

The native carrier separates propositions from deontic claims. A proposition
states controlled content; a claim applies a kind and modality; relations join
claims; collections identify complete or ordered populations.

A simplified shape is:

```text
references
propositions
claims
relations
collections
annotations
residue
```

Stable claim IDs are necessary for graph arithmetic. Verification claims can
name controlled falsifying propositions without introducing another free-text
channel.

The native carrier is intentionally more explicit than the compact
model-facing wire grammar. The wire form optimizes constrained generation. The
native form optimizes deterministic resolution.

## Layer 5: exact contract DAG resolution

The local DAG resolver calculates contract-local facts:

- dangling or mistyped claim relations;
- invalid claim kinds and modalities;
- dependency cycles;
- mandatory behaviors without verification coverage;
- uncovered members of author-declared closed sets;
- malformed collections.

These facts answer whether the authored graph is internally complete. They do
not answer whether the author declared every behavior required by an
organization.

### Internal completeness versus population completeness

This distinction is central.

An author can create a closed set containing every behavior they remembered,
attach a verifier to every member, and obtain perfect graph coverage. The
contract may still omit an entire required case such as absent authorization,
nonconsumption after failed authorization, connector reachability, or host
namespace exclusion.

Internal graph resolution sees declared completeness. An organization-owned
obligation profile tests population completeness.

### Aggregate verification

A single verification claim may cover many behaviors. The DAG records that
coverage, but broad coverage is not proof of individual discrimination.

Closed-set verification facts therefore report:

- verifier identities per member;
- falsifier identities per member;
- shared verifiers and falsifiers;
- members without an exclusive falsifier.

These are measurements. Whether aggregate proof is acceptable is policy or
review judgment.

## Layer 6: prototype organization policy

The local policy experiment demonstrates how an external obligation catalog
can compare required population against an authored graph.

A policy obligation can be satisfied by:

- a controlled proposition template matched to an authored claim;
- an authoritative resolver fact;
- delivered evidence at a post-delivery stage.

The prototype distinguishes pre-dispatch and post-delivery stages and can
return `allow`, `refuse`, `review_required`, or `indeterminate`. Every result is
marked local and nonauthoritative.

In production, organization policy, authoritative resolution, waivers, and
attestation belong to CCE. The local prototype exists to verify that the graph
contains enough structure for such a policy to operate.

## Layer 7: exact behavior decomposition

The decomposition resolver projects behavior claims into cohesive components.

### Cohesive edges

Only behavior-to-behavior `refines` relations create default cohesion. The
connected components of those edges form exact behavior concerns.

### Dependency edges

Behavior-to-behavior `depends_on` and `precedes` relations become directed
edges between components. The resolver calculates:

- quotient arcs;
- topological order and frontiers;
- dependency depth;
- in-degree and out-degree;
- transitively redundant arcs;
- source cycles and contraction-created quotient cycles as distinct defects.

### Overlays

Verification, evidence, traceability, and collections attach to components but
do not merge them. This prevents proof organization from becoming accidental
implementation organization.

### Complexity vectors

The resolver reports complexity without selecting a model:

- behavior and mandatory-claim counts;
- proposition, reference, relation, and operator counts;
- conditional propositions and falsifiers;
- verifier fan-out;
- dependency degree and depth;
- singleton share and authored cohesion density;
- repository-reference overlap;
- collection attachment.

These vectors can support a later execution profile. They are not universal
measures of cognitive difficulty.

## Layer 8: the anonymous structural partitioner

The partitioner consumes only opaque facts:

- weighted component nodes;
- the dependency DAG;
- opaque resource nodes with typed read/write incidence;
- closed-set and ordered-sequence incidence;
- a local target and hard maximum weight;
- a selected priority of structural merge signals.

It never receives prose, domain vocabulary, repository names, symbols, or
semantic labels.

### Why anonymity matters

An anonymous result demonstrates that a grouping follows from declared
structure rather than a model recognizing familiar names. Identifier-renaming
and input-order tests verify that output does not depend on token spelling or
array order.

### What the partitioner is good for

It can generate a structurally plausible comparison partition, measure
capacity and critical-path tradeoffs, and expose places where dependency or
resource structure supports coarsening.

### What the partitioner is not good for

It is not a source of the correct slice plan. Anonymous structure cannot know
all implementation semantics, independent-realizability boundaries, or
organizational intent. Early versions either refused nearly every merge or
over-merged dependency-connected graphs. Later versions became useful as a
comparison, but still demonstrated that a consistent machine plan may
internalize far more dependency structure than an informed orchestrator wants.

Closed proof sets are measurements only. An `ordered_sequence` can veto a
noncontiguous contraction, but does not create a reason to merge. Resource
signals are reliable only when component-level scope incidence is complete.

## Layer 9: proposed slice-graph assessment

This is the primary planning interface.

The orchestrator supplies:

- a partition assigning every exact component to one proposed unit;
- proposed dependencies between units;
- a preferred and maximum execution weight;
- the completeness status of resource incidence;
- optionally, a policy for anonymous comparison.

The assessor then asks whether the proposal survives exact mechanical checks.

### Contract consistency

The proposal is inconsistent when it:

- omits or duplicates an exact component;
- references an unknown component or unit;
- creates a unit-dependency cycle;
- creates a quotient cycle by contracting incompatible components;
- omits required dependency reachability;
- reverses required dependency order;
- violates an authored ordered sequence.

Required dependency order may be direct or transitive. A proposal does not need
to repeat a direct edge when another declared path already preserves the
required order.

### Advisory structural observations

The assessor also reports facts that do not make the proposal inconsistent:

- an extra proposed dependency with no support in the contract DAG;
- a redundant proposed dependency;
- a unit containing several structural-support groups;
- a unit above the preferred target;
- internalized dependency edges;
- critical-path and parallelism cost;
- disagreement with anonymous coarsening.

These observations answer “what does this plan cost or obscure?” rather than
“is this plan legal?”

### Four separate result axes

The assessor deliberately avoids one overloaded verdict:

1. `contract_consistency`: does the proposal preserve exact contract
   structure?
2. `execution_profile_fit`: are all units below the supplied hard maximum?
3. `assessment_completeness`: were supporting facts such as resource incidence
   complete?
4. `anonymous_comparison`: did the optional structural counterproposal group
   the same component pairs?

A plan can be consistent and still be expensive. A machine-generated plan can
be internally coherent while swallowing most dependency arcs into one unit. A
human plan can preserve parallelism but omit a required edge. The axes prevent
either result from being mislabeled “good.”

### Serialization metrics

Workers perform the content of one unit serially even when the component DAG
contains internal parallelism. The assessor therefore reports:

- input critical-path weight;
- required quotient critical-path weight;
- proposed critical-path weight;
- critical-path serialization cost;
- internal serialization loss per unit and in total;
- proposed topological layers and maximum frontier;
- dependency edges internalized by grouping.

When adding a missing dependency increases serialization cost, that increase
may be necessary. A lower cost obtained by omitting a real dependency is not a
better plan.

### Structurally disconnected units

A unit may contain components with no known dependency or resource connection.
That is a loud advisory observation, not an automatic error.

If resource incidence is partial, an apparent disconnection may reflect
missing scope facts. The assessor propagates that limitation through
`assessment_completeness` rather than treating absent incidence as proof of no
relationship.

## The intended planning workflow

The architecture now supports this sequence:

1. The orchestrator writes the intended acceptance contract.
2. The controlled representation and exact DAG are built or checked.
3. Contract-local and organization-policy completeness are examined.
4. Exact behavior components and dependencies are resolved.
5. The orchestrator proposes a slice partition and dependency graph.
6. The assessor checks the proposal against exact anonymous facts.
7. The orchestrator repairs missing order, excessive serialization, unsupported
   grouping, or capacity mismatch.
8. Anonymous coarsening may be run as an independent comparison.
9. CCE applies authoritative policy and dispatch rules outside this package.

The guiding phrase is:

> **The orchestrator proposes; exact facts falsify.**

## Worked topology: the SLICE-018-shaped regression

The repository test suite contains a six-component fork/join topology:

```text
authority -> FIFO -> local -> settlement -> lifecycle
                         \-> exclusions ->/
```

The proposed plan contains two units:

```text
Unit 1: authority + FIFO                 weight 11
Unit 2: local + settlement + exclusions + lifecycle  weight 21
```

Under target weight 16 and maximum 32, the assessor reports:

- contract consistency: consistent;
- execution-profile fit: fits;
- one required unit dependency, preserved;
- internal serialization loss: 4;
- anonymous comparison: identical.

Under target and maximum 32, a one-unit proposal is also consistent. It fits
the supplied capacity and internalizes all six source dependency edges. The
tool reports the lost parallelism but does not invent a forbidden boundary.

This example demonstrates why the assessor evaluates a proposal rather than
declaring one unique partition correct.

## Free mechanical tier versus CCE tier

### Free mechanical tier

The package can safely expose:

- schema validation;
- compiler admission and residue;
- identity and relation integrity;
- contract-local graph resolution;
- dependency and decomposition facts;
- proposed-plan consistency;
- complexity, parallelism, and capacity calculations;
- anonymous comparison;
- explicit uncertainty caused by incomplete inputs.

These operations are deterministic over declared inputs and carry no policy
authority.

### CCE tier

CCE owns organization-specific and authority-bearing decisions:

- which obligation profiles apply;
- authoritative repository and lifecycle resolution;
- evidence sufficiency;
- waivers and exceptions;
- dispatch admission or refusal;
- authorization and escalation;
- audit attestation;
- post-delivery evidence binding.

A local policy prototype can test the interface, but it cannot become shadow
CCE policy.

## What the architecture can and cannot establish

### It can establish

- Whether a serialized controlled carrier is structurally valid.
- Whether controlled claims and relations satisfy compiler rules.
- Which source spans remain unrepresented.
- Whether the authored claim graph is internally coherent.
- Whether declared mandatory behaviors have declared verification.
- Whether an external obligation catalog has an authored binding.
- Whether behavior concerns and dependencies form an acyclic quotient DAG.
- Whether a proposed unit graph preserves those dependencies.
- How the proposed graph changes critical path and parallelism.
- Whether units fit a supplied size profile.

### It cannot establish

- That the orchestrator interpreted product intent correctly.
- That the model selected the semantically right operator or operand.
- That the organization obligation catalog is complete.
- That an authored binding is semantically honest merely because its type and
  modality match.
- That a referenced implementation API actually has the asserted runtime
  shape without an authoritative resolver or inspection.
- That a declared test exists in the delivery.
- That a test ran against the exact candidate.
- That a passing test would fail when the defect is introduced.
- That one structurally consistent plan is operationally better in every
  environment.

## Current measured evidence

### Corpus baseline

The frozen v0.33 run covered 1,962 slice criteria from work record through work record:

- 1,917 criteria contained admitted structure;
- 342 were mechanically complete, 1,575 partial, 44 residue-only, and one
  schema-invalid after normalization;
- 8,168 claims and 2,058 relations were admitted;
- 5,544 unique criterion-bound residue spans remained;
- 4,241 of 7,426 segmented source spans had no mapped residue.

The resulting 57.1 percent is mechanical segment coverage, not semantic
accuracy. The run consumed about 36 million prompt tokens because a dynamic
schema and reference catalog were repeated for every criterion. That cost is an
optimization concern, not evidence against the language.

### Residue audits

Three audits classified the same selected residue cohort and disagreed
materially. All three agreed on only 194 of 522 non-empty spans. This proves that
causal residue classification is not a mechanical performance score. Model
classifications are hypotheses for design review.

### Planning experiments

Repository regressions establish deterministic behavior on synthetic and
SLICE-018-shaped graphs. Additional orchestrator-run retrospective experiments
have reported useful findings on real contracts, including missing dependency
arcs, omitted organization-policy obligations, aggregate verification, and
contract structures invisible to LOC budgets. Those external run artifacts are
noncanonical unless promoted into tracked evidence; their architectural lessons
are reflected here without treating their temporary outputs as authority.

## Performance and quality metrics

Metrics belong to different layers and should not be collapsed.

### Representation metrics

- admitted claims and relations;
- unique residue spans;
- source segments with and without residue;
- schema-invalid outputs;
- compiler diagnostic counts.

These measure mechanical capture, not semantic correctness.

### Graph-quality metrics

- uncovered mandatory behaviors;
- collection members without verification or exclusive falsifiers;
- cycles and dangling relations;
- singleton component share;
- authored cohesion density;
- dependency depth and frontier width.

These measure declared structure, not delivered behavior.

### Proposed-plan metrics

- exact component coverage;
- missing or reversed required order;
- internalized dependency count;
- critical-path serialization cost;
- internal serialization loss;
- unit weight balance and hard-capacity fit;
- structural-support groups per unit;
- anonymous co-membership differences.

These measure the consequences of a proposal, not whether an orchestrator's
semantic judgment is correct.

### Evidence-quality metrics

Future evidence binding needs different facts:

- required verification claims bound to delivered tests;
- execution results bound to the exact candidate and base;
- falsifiers or mutations executed;
- checks that fail under their declared counterfactual;
- evidence freshness and provenance.

These facts cannot be inferred from the planning DAG.

## Open engineering problems

### Component-level scope incidence

Current experiments often have whole-slice read/write scope but incomplete
component-level incidence. Missing incidence directly limits resource-backed
grouping and makes disconnected-unit observations provisional.

A defensible resolver must distinguish:

- no access;
- unresolved access;
- inherited whole-unit access;
- verification-only artifact access;
- precise read and write incidence.

Absent facts must never be interpreted as an empty set.

### Semantic translation accuracy

Schema-constrained output prevents malformed language but not wrong meaning.
Translation quality needs targeted counterexamples, operator/operand direction
checks, and perhaps authoring directly in the controlled carrier rather than a
general model translation pass.

### Organization profiles

Generic lifecycle and authority patterns can expose omissions only when a
trusted organization profile names the required population. Profile creation,
versioning, applicability, and authoritative resolution are CCE-tier concerns.

### Verification sensitivity

The graph needs a post-delivery evidence chain if it is to connect declared
verification to actual tests and mutation outcomes. This is distinct from
pre-dispatch contract completeness.

### Execution-profile calibration

Weights and graph complexity can support model routing only after empirical
calibration. A universal “node count equals model strength” rule would be
unsupported. Profiles should record the model, task family, measured outcomes,
and acceptable failure rate.

### Native authoring workflow

The long-term workflow may not require a translation model. An orchestrator can
author acceptance criteria through the controlled schema, validate them, and
retain prose only as a human-readable rendering and residue carrier. The
translation pipeline remains useful for migration, pressure testing, and
diagnosing existing prose.

## Implementation map

- `current.mjs`: public experimental v0.33 grammar/compiler entry point.
- `schema/`: generated tracked model-facing schema.
- `versions/`: retained grammar/compiler evolution and regressions.
- `bin/run-corpus.mjs`: one-pass constrained corpus generation.
- `bin/run-residue-audit.mjs`: advisory audit over a frozen ledger.
- `experimental/native-contract-carrier.mjs`: schema-native claim carrier.
- `vocabulary/cv.experimental.0.34.mjs`: intrinsic proposition vocabulary and
  digest projections.
- `experimental/native-contract-carrier-v034.mjs`: vocabulary-derived v0.34
  native carrier.
- `experimental/verification-profile-v034.mjs`: vocabulary-derived proof-pack
  schema and evaluator adapter.
- `bin/query-vocabulary.mjs`: advisory exact-term, search, and reduced-view
  transport.
- `experimental/native-contract-dag.mjs`: contract-local graph resolver.
- `experimental/native-contract-decomposition.mjs`: exact behavior concern and
  dependency projection.
- `experimental/anonymous-structural-partitioner.mjs`: optional anonymous
  coarsening comparison.
- `experimental/proposed-slice-graph-assessor.mjs`: primary proposed-plan
  assessment.
- `bin/assess-proposed-slice-graph.mjs`: agent-facing assessor command.
- `experimental/prototype-org-authorization.mjs`: nonauthoritative policy
  interface experiment.

## Compact glossary

**Annotation:** Nonoperative source context retained separately from worker
instructions and graph arithmetic.

**Carrier:** The serialized structure holding references, propositions, claims,
relations, collections, annotations, and residue.

**Closed set:** An authored declaration that its member population is complete.
Completeness is only with respect to the authored set unless external policy
defines the required population.

**Cohesion:** An authored structural reason for behavior claims to occupy one
exact concern component. Current default: behavior-to-behavior `refines`.

**Component:** One exact cohesive behavior concern produced by decomposition.
It is not automatically a slice.

**Contract consistency:** Whether a proposed unit graph preserves exact
component population, dependency reachability, acyclicity, and ordered
constraints.

**Falsifier:** A controlled counterfactual proposition describing a condition
under which a verification must discriminate.

**Operative residue:** Source meaning that may affect worker obligations but is
not represented by admitted controlled structure.

**Policy population:** The obligations an external authority requires, whether
or not the author remembered to declare them.

**Quotient DAG:** The dependency graph after cohesive claims or proposed
components are contracted into larger nodes.

**Residue:** Exact source remainder not represented by an admitted claim or
relation. It is evidence for investigation, not automatically a vocabulary gap.

**Serialization cost:** Additional critical-path weight introduced when
parallel-capable components are grouped or extra order is declared.

**Solution slot:** A controlled `(subject, predicate, applicability context)`
key with an allowed value set.

**Structural support group:** A connected group within one proposed unit under
known dependency adjacency and trusted resource-incidence signals.

**Verification coverage:** A declared relation from a verification claim to a
behavior claim. It does not prove test existence or sensitivity.

## Final perspective

The controlled-contract experiment is not primarily a better JSON format. It
is a way to convert selected forms of semantic ambiguity into deterministic,
inspectable facts while naming the boundary where determinism ends.

Its strongest current use is not automatic slicing. It is disciplined review:
an orchestrator authors the contract and proposes a plan; the compiler, DAG,
policy population, and assessor expose omissions or structural costs that prose
and LOC heuristics cannot reliably reveal.

That is a narrower claim than “the system understands requirements,” but it is
already operationally significant.
