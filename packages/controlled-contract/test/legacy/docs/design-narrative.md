# From Prose Contracts to Deterministic Design Review

> **Long-form experimental narrative.** This document is written as source
> material for audio synthesis and architectural discussion. Exact current
> interfaces are documented in `architecture-and-operating-model.md`. Durable
> initiative coordination remains in `initiative`, `work record`, and `work record`.

## 1. The original problem was not bad agents

The project began with a recurring failure pattern. A work contract would look
detailed. It would name files, describe behavior, prescribe tests, and set a
line budget. Dispatch validation would say the work was bounded. A capable
worker would implement what it understood. Review would then discover that a
critical behavior, boundary, or adversarial case had never been stated clearly
enough to constrain the delivery.

It was tempting to describe this as an agent-quality problem. Sometimes it was.
But the harder class of failures happened before the worker started. The
contract was insufficient, and the system had no mechanical way to say what was
missing.

The acceptance criteria were prose. Prose is expressive, but it does not expose
a stable population of behaviors, prohibitions, evidence obligations, and
dependencies. A validator can count lines and files. It cannot ask whether a
single-use capability contract includes absent-capability refusal, whether a
wrong capability leaves the legitimate one unconsumed, or whether a connector
projected into a namespace is actually executable there.

The first thesis was therefore modest:

> If contractual claims are typed, the absence of a required claim becomes
> nameable.

That statement contains the seed of the entire architecture.

## 2. Typing a claim was necessary, but it was not enough

The earliest design focused on claim kinds. A criterion might describe
behavior, evidence, or verification. It might be mandatory or prohibited. It
might refer to a test, a repository path, a symbol, a prior work record, or a
decision.

Typing immediately clarified several confusions.

A test artifact existing is not the same thing as an act of verification. A
behavioral prohibition is not a separate claim kind; it is a behavior claim
with negative modality. A reference to a decision is provenance, not
necessarily a worker instruction.

But a field named `kind` does not create a language. Without a grammar, models
can still place arbitrary values into arbitrary fields. Without controlled
identities, references remain decorated prose. Without operational semantics,
two perfectly valid JSON objects may contradict one another without any
consumer noticing.

The project expanded from a vocabulary into a work-contract compiler.

## 3. The compiler target

The compiler target is a closed, symbol-resolved solution graph.

“Closed” does not mean every possible fact in the world is represented. It
means that one fully structured solution slot can declare its complete allowed
value set. If the contract says the active production transport must be FIFO,
the slot does not need a separate prohibition for every transport alternative.
Those alternatives are excluded by the closed value set.

“Symbol-resolved” means a claim should point to a controlled identity rather
than a phrase that merely sounds specific. A filename may be a repository-path
identity. A code symbol may require a qualified symbol reference. A work record
or decision has a durable identifier. A runtime value may need an explicit
parameter or authoritative resolver.

“Solution graph” means the contract is not just a list. Behaviors refine other
behaviors, verifications cover behaviors, requirements depend on prerequisites,
and one design replaces another. The edges carry meaning that list position
cannot.

The compiler's job is to admit what the controlled language can represent,
reject malformed controlled expressions, and preserve the exact remainder.

## 4. Residue changed the objective

Residue began as a practical escape hatch. If the grammar could not encode part
of a criterion, the model placed it in a residue list rather than inventing a
controlled term.

That escape hatch became one of the most important parts of the design.

The first temptation was to treat residue as a score: less residue meant a
better grammar. That was wrong. Residue included headings, historical context,
review instructions, duplicated diagnostics, model omissions, segmentation
defects, authoritative fields already carried elsewhere, and genuinely missing
concepts. Driving the number down indiscriminately would encourage the grammar
to absorb material that should never become an operative worker instruction.

The better interpretation was:

> Residue is the exact place where controlled representation stops.

Each residue span asks a causal question. Was the source contract defective?
Did the model miss an available encoding? Did the compiler reject a valid
shape? Is the meaning already entailed by a closed `MUST`? Does another carrier,
such as `write_scope`, own it? Is it rationale that belongs in an annotation?
Or is there a recurring operative primitive the language genuinely lacks?

This reframing stopped vocabulary growth from becoming a popularity contest.

## 5. A subtle trap: residue could poison valid claims

One audit exposed a design flaw in which residue attached to a source element
caused every candidate claim from that element to be rejected. A sentence could
contain one valid operative proposition and one explanatory parenthetical such
as “this corresponds to finding F2.” Recording the provenance as residue then
blocked the valid instruction.

The fix was conceptual as much as technical. Source elements can contain both
operative and nonoperative material. Provenance and rationale need a separate
annotation channel. Residue must identify which operative target it prevents
from being complete; it must not become an element-wide veto merely because
something in the sentence remains outside the grammar.

This was an early example of a recurring theme: the system should preserve
uncertainty without allowing uncertainty in one place to erase valid structure
somewhere else.

## 6. The model was not supposed to become a critic

An early pressure-test report asked a cheap translation model to tell the
author what to rewrite. That crossed the intended boundary.

The model's job was to emit controlled structure and exact residue. It did not
understand the project's full architecture, organizational authority, or the
reason a contract had been written. Letting it diagnose the “big picture”
turned a constrained translator into an untrusted reviewer.

The correct pressure-test output is factual:

- these claims were admitted;
- these candidate claims were structurally rejected for named reasons;
- these exact source spans remain residue;
- these references are unresolved;
- these controlled values were unavailable.

The orchestrator decides whether the contract is wrong or the language is
missing something.

This preserved the core hierarchy of responsibility: models can help structure
and test a contract, but the orchestrator owns its meaning.

## 7. Schema-constrained output and the Vertex detour

The project used Vertex structured output so a model could emit only legal JSON
Schema instances. That raised an important question: if the schema constrains
tokens, why provide long translation instructions at all?

The answer is that a schema defines legal form but not source interpretation.
It can make `reference:returns` available and `banana:maybe` impossible. It
cannot decide whether one sentence means `returns`, `includes`, or
`preserves`. Semantic field names and descriptions still influence inference.

Another complication appeared when large schemas exceeded Vertex's serving
constraint-state budget. One workaround replaced readable operators with short
opaque codes such as `o045`. That made transport cheaper, but forced the model
to resolve a codebook embedded in schema descriptions.

Research and a controlled transport experiment suggested that this workaround
had outlived its purpose. Once the grammar was simplified, readable operators
passed Vertex on a challenging cohort. They also used fewer tokens because the
schema no longer needed a code dictionary.

The result was an important design rule:

> Keep the model-facing language semantically readable. Apply any opaque wire
> encoding after generation, not before semantic choice.

## 8. The v0.33 corpus run

The tracked v0.33 experiment ran once over 1,962 recent slice criteria using
Gemini 3.6 Flash, with no retries or repeated samples.

The compiler admitted structure in 1,917 criteria, producing 8,168 claims and
2,058 relations. It retained 5,544 unique residue spans. At the segment level,
4,241 of 7,426 source segments had no mapped residue.

The tempting headline was 57.1 percent mechanical coverage. The important
qualification was that this was not meaning-capture accuracy. A segment can be
free of residue even if the model selected the wrong operator. A residue span
can be nonoperative. Mechanical admission and semantic correctness are
different measurements.

Three agents then classified a selected residue cohort and disagreed
substantially. Agreement across all three covered only 194 of 522 non-empty
spans. The disagreement was informative. It showed that causal residue labels
are hypotheses, not mechanical truth.

The corpus experiment proved feasibility and revealed defects. It did not
certify the translator.

## 9. The native DAG made omissions computable

The next architectural step was a native claim carrier with stable IDs and
claim-to-claim relations. Once claims could be nodes, ordinary graph algorithms
became useful.

The first resolver could report:

- a mandatory behavior with no verification edge;
- a member missing from a declared proof set;
- a dangling or mistyped relation;
- a dependency cycle;
- an invalid modality that would otherwise disappear from analysis.

This immediately improved contract review. A long paragraph saying “tests must
cover eight things” could become eight named obligations with explicit proof
relationships. A delivery containing two tests would then look incomplete if
the contract had actually declared all eight relationships.

But another limit appeared. A graph can be internally complete and still omit
the behavior that matters most.

## 10. The closed-set illusion

Suppose an author declares eleven mandatory behaviors, puts all eleven in a
closed set, and attaches verification to every member. The resolver reports
eleven of eleven covered.

Now suppose the author forgot absent-capability refusal, failed-authorization
nonconsumption, connector executability, or host namespace exclusion. Those
obligations are not uncovered members. They are absent from the population.

The graph has no basis for inventing them.

This distinction divided completeness into two layers:

1. **Authored graph completeness:** everything the author declared is coherent
   and covered.
2. **Organization-policy population completeness:** the author declared every
   obligation required by a trusted external profile.

A local authorization prototype demonstrated the interface. A frozen
single-use-capability profile could refuse an otherwise internally complete
contract because required obligations were unbound. A repaired contract could
pass population and graph checks while remaining `review_required` because
delivered evidence and test sensitivity were still absent.

This was the point where the free mechanical tier and CCE tier became sharply
distinct. Graph arithmetic can be local. Organization policy and authoritative
authorization belong to CCE.

## 11. Verification presence was not verification effectiveness

Retrospective contract studies exposed another boundary. A verification edge
can say that a test covers exact-channel identity. The test can still be
ineffective: deleting the identity guard may leave it green.

The same problem appears when a “live descriptor” test passes a static data
property once but never changes the accessor's value after finalization. The
test is present and plausibly named, yet it does not discriminate the required
behavior.

The controlled carrier added falsifying propositions so a verification could
state the counterfactual it must detect. But declaring a falsifier does not
prove it was executed.

A complete evidence chain would need to connect:

```text
required behavior
    -> verification claim
    -> expected test case
    -> delivered test case
    -> execution result
    -> falsifier or mutation result
```

The pre-dispatch DAG owns the first two links. Delivery evidence and review own
the rest.

## 12. From graph completeness to decomposition

Once a contract was a DAG, another possibility emerged. Could graph structure
replace line-count heuristics for deciding whether work was too broad?

LOC can say a proposed change is large. It cannot say where the natural
boundaries are, which concerns can proceed in parallel, or which one depends on
another.

The first decomposition prototype grouped claims into connected components and
collapsed dependencies into a quotient DAG. Real contract studies produced
meaningful concern families: backing provenance, trusted producer lifecycle,
typed refusal, connector projection, namespace projection, registration, child
stdio, preservation, and ownership topology.

The graph revealed structure that a two-file, sub-thousand-line scope did not.
It also showed why raw component count was not a slice count. Some components
were implementation concerns. Others were preservation constraints, prohibited
surfaces, or evidence-only sinks that should attach to production work.

The architecture needed exact decomposition without pretending exact
components were final slices.

## 13. Broad verification created false cohesion

The initial decomposition treated `verifies` as a cohesive edge. That seemed
reasonable: if one test proves several behaviors, perhaps those behaviors
belong together.

In practice, a broad verification suite often covers behaviors implemented by
different owners. One verifier spanning many behaviors fused them into a large
component. Dependencies that should have remained visible disappeared inside
the fused node. In one evaluation, contraction produced a quotient cycle even
though the original claim graph was acyclic.

The correction was decisive:

- only behavior-to-behavior `refines` creates default cohesion;
- verification becomes an overlay;
- dependencies remain directed cuts;
- evidence and traceability remain overlays;
- closed proof sets measure completeness but do not imply co-delivery.

This v0.3 decomposition was a strict refinement of the earlier partition in
the tested cohort. It recovered separations that no later coarsening algorithm
could have recovered from already-fused components.

## 14. The anonymous partitioner experiment

The next question was whether exact components could be coarsened into useful
implementation units using only anonymous structure.

The partitioner received weighted component tokens, dependency edges, typed
read/write incidence, and collection membership. It did not see prose, paths,
symbols, or domain names.

The first algorithm was too conservative. It required a mutually unique best
merge. Branching DAGs produced equal candidates, so almost nothing merged.

The second algorithm constructed a merge hierarchy and selected a capacity cut.
It solved the tie deadlock but over-corrected. On one graph, it placed weight 30
of 42 into one unit, swallowed most dependency arcs, and destroyed useful
parallelism.

The third version applied capacity demand inside each hierarchy root and
penalized serialized parallel work. It became deterministic, monotone under
capacity, identifier-invariant, and useful as a structural comparison.

On the SLICE-018-shaped regression it recovered the expected two units exactly.
On a harder graph it produced coherent units but still internalized more
dependency structure than an informed plan.

The project had reached an important reality check. The partitioner was no
longer broken, but it was still being asked the wrong question.

## 15. The inversion: propose, then falsify

Every partitioner evaluation ended at the same wall. Anonymous structure could
suggest boundaries, but it could not know which structurally defensible plan
best matched implementation intent.

The key inversion was:

> Do not ask anonymous structure to author the plan. Ask an informed
> orchestrator to author the plan, then use anonymous exact facts to falsify it.

This produced the proposed slice-graph assessor.

The orchestrator supplies opaque units and dependencies. The assessor checks
whether every exact component appears once, whether the proposed graph
preserves required dependency reachability, whether any order is reversed,
whether contraction creates a cycle, whether ordered sequences remain intact,
and what serialization or capacity cost the proposal introduces.

The anonymous partitioner remains available, but only as an optional
counterproposal.

This relationship is much healthier. The orchestrator contributes contextual
understanding. The assessor contributes exact falsification. Neither pretends
to possess the other's authority.

## 16. The first real plan assessment

An orchestrator submitted a previously frozen eight-unit plan using opaque
tokens and a private mapping. The assessor returned four independent axes:

```text
contract consistency:      inconsistent
execution-profile fit:     fits
assessment completeness:   partial
anonymous comparison:      different
```

The inconsistency came from one missing required dependency. A design-boundary
discipline unit had to precede the rewire because the rewire depended on a
settled structural fact. The same omission had previously required manual
inspection. The assessor derived it from the anonymous contract DAG.

The tool also reported several structurally disconnected units. That finding
was useful but qualified. Resource incidence was partial: only two resources
were derivable and many components had no precise access mode. The assessor
therefore kept the observation advisory and marked the whole assessment
partial.

Adding the missing edge made the plan consistent but increased serialization
cost. That increase was not a regression. The lower cost had been achieved by
omitting a real prerequisite. Once repaired, the proposal reached the
theoretical critical-path minimum for its own partition.

The anonymous machine plan passed consistency but had much greater
serialization. It grouped every unit coherently, yet internalized most of the
authored dependency graph.

The two plans failed in opposite ways:

- the human plan preserved parallelism but omitted one real edge;
- the machine plan preserved every edge but coarsened too aggressively.

The assessor did not choose a winner. It named the exact defect and cost in
each. That is the behavior the architecture had been seeking.

## 17. Why consistency is not quality

The word `consistent` is intentionally narrow. It means the proposal preserves
the exact declared contract structure. It does not mean the plan is optimal,
efficient, or semantically wise.

A single monolithic unit can be consistent if the graph contains no forbidden
boundary and the execution profile permits its weight. The assessor should
report that all parallel work has been internalized, not call the unit invalid.

Likewise, a beautifully balanced plan is not good if it omits a dependency.
Parallelism achieved by violating the contract is fictitious.

This is why the assessor exposes separate axes and metrics:

- consistency;
- capacity fit;
- input completeness;
- comparison agreement;
- critical-path serialization cost;
- structural support groups;
- internalized dependency count.

No one number should collapse them.

## 18. What becomes deterministic

The architecture does not make requirements engineering deterministic in the
large. It makes selected questions deterministic once the relevant facts are
declared.

Examples include:

- Is every exact behavior component assigned to one proposed unit?
- Does the proposed unit graph preserve each required prerequisite?
- Did grouping create a dependency cycle?
- Does every authored mandatory behavior have a declared verifier?
- Does every member of this closed proof set have an exclusive falsifier?
- Is a required organization obligation unbound?
- How much critical-path weight does this partition add?
- Which units contain components with no known structural connection?
- Is a resource-based conclusion incomplete because scope incidence is
  unresolved?

The system transforms ambiguity into deterministic measurement only to the
extent that the ontology, grammar, carrier, and resolvers expose the relevant
facts.

That qualification is a strength. It makes the unknowns visible rather than
silently converting them into false certainty.

## 19. The authority boundary

The free local tier can calculate structure. It cannot authorize work.

The free tier owns:

- schemas and compilers;
- residue;
- graph integrity;
- exact decomposition;
- proposed-plan consistency;
- complexity and serialization;
- explicit incomplete-input diagnostics.

CCE owns:

- organization obligation catalogs;
- authoritative lifecycle and repository resolution;
- policy applicability;
- waivers and escalation;
- evidence sufficiency;
- dispatch admission and refusal;
- audit attestation.

This separation allows the mechanical substrate to be useful outside one
organization without exporting CCE's resolver or policy.

An adopter can use the grammar and assessor to improve contract design. Their
own authority system decides what those facts mean operationally.

## 20. Broader implications

The immediate project is AI coding work, but the underlying pattern is broader.

Many coordination systems rely on natural-language requirements followed by a
human or model making an all-at-once judgment. The controlled-contract approach
splits that judgment into declared facts, exact relations, explicit residue,
and policy-owned decisions.

That enables new classes of tooling:

- authoring assistants that identify unsupported concepts before dispatch;
- contract linters that name missing dependency or verification relationships;
- planning reviewers that compare a proposed work graph to the requirement DAG;
- policy resolvers that name which required obligation is absent;
- evidence systems that bind required checks to delivered tests and falsifier
  outcomes;
- empirical model routing based on measured graph complexity rather than LOC.

The important claim is not that an algorithm can understand every requirement.
It is that a meaningful subset of requirement quality can be represented in a
form where omissions and structural consequences are mechanically testable.

## 21. The remaining frontier

Three problems now dominate.

### Better scope incidence

Resource-aware planning remains limited by whole-slice scope. A component-level
resolver must preserve the distinction between no access and unknown access.
Until then, disconnected-unit diagnostics are strongest when supported by the
dependency DAG and provisional when they depend on missing resource facts.

### Direct controlled authoring

The translation model may be optional in the final workflow. An orchestrator
could author directly through the controlled schema, using prose as a rendering
and residue surface. Translation would remain useful for migrating old
contracts and pressure-testing prose.

### Delivered evidence and sensitivity

Pre-dispatch completeness cannot prove that a delivered test exists or fails
under its falsifier. A post-delivery evidence graph must bind declarations to
actual tests, exact runs, candidate identity, and mutation outcomes.

These problems are different enough that solving one should not be presented as
solving the others.

## 22. A practical mental model

For day-to-day reasoning, the entire architecture can be remembered in six
sentences:

1. Prose expresses intent, but the orchestrator owns its correctness.
2. The controlled grammar turns representable intent into typed propositions,
   claims, identities, and relations.
3. Residue preserves the exact remainder and tells us where controlled
   representation stopped.
4. The native DAG makes declared completeness, dependency, proof coverage, and
   complexity computable.
5. The orchestrator proposes the work graph; the assessor tries to falsify it
   and measures its structural cost.
6. CCE, evidence, and review decide whether the mechanically described work is
   authorized and actually correct.

## Closing

The project started with a question about whether acceptance criteria could be
typed. It became an experiment in compiling work contracts into graphs that can
support deterministic design review.

The path included several useful mistakes: treating residue as a score, letting
residue poison valid claims, asking a translator to act as an architect,
presenting opaque operators to the model, using broad verification as cohesion,
and asking an anonymous partitioner to design slices.

Each correction sharpened the division of responsibility.

The current architecture does not promise automatic understanding. It offers
something more defensible: when an orchestrator states enough structure, the
system can identify specific omissions, contradictions, hidden serialization,
and unresolved meaning without another model guessing the answer.

That is the foundation for trustworthy contract pressure testing—and a
substantial improvement over prose plus line counts.
