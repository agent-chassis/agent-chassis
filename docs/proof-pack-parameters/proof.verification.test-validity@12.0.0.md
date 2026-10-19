# proof.verification.test-validity@12.0.0

<!-- Generated from validated package metadata. -->

For one exact test_execution proof instance, complete launcher-authenticated runtime evidence bound to the exact candidate or source snapshot, controlled-contract generation, obligation, proof-plan entry, declared target, test-proof binding, admitted profile, certification, guarantee, and evaluator satisfies the guarantee only when the candidate passes, the one test the binding's declarative test selector names is discovered, executed, and not skipped, every declared falsifier is present, every falsifier the provider could apply is detected, every required traversal is present and proven, and no prohibited shortcut is observed. A falsifier the provider could not apply is an authenticated capability limitation: it earns no detection credit, is not counterevidence, and never excuses a surviving sibling. A supported, isolated, actually observed mutation that leaves the selected test passing falsifies the guarantee; for a passing candidate, an incomplete falsifier population or a supported falsifier that is neither detected nor such a survivor is not executable, and a failed candidate gains no mutation counterevidence from its falsifier rows. No authored baseline inventory participates, and sibling tests observed in the same run neither earn nor withhold credit. Complete valid negative inventory or execution facts falsify the guarantee; missing evidence or an unavailable exact evaluator is not executable; malformed, unauthenticated, stale, ambiguous, cross-bound, contradictory, or digest-mismatched evidence is refused. This is a bounded execution-validity guarantee. It preserves the caller's requirement, verification and falsification meanings unchanged; it does not establish that assertions faithfully test those meanings. Passing execution, detected dependency mutations and module traversal grant no requirement-satisfaction credit. Assertion-to-requirement behavioral adequacy is not established by this mechanism.

Profile digest: c78f901ccce27e8e72732078dd0c268d76efdf41ca7292fc8f2062fb32f449e3. Parameter digest: a8fcc0255ed5941ef47a02b670942cd24d46b1508ad5d30b36ad17308323e9a7.

Admission digest: 3d223ba55a02be195ed9bdbeae644f757b34601b927d03fc31556633e69fa49b.

Roles: 0/0 accounted; 0 owned gaps. Semantic parameters: 0; internal roles: 0.

## Guarantee and exclusions

For one exact test_execution proof instance, complete launcher-authenticated runtime evidence bound to the exact candidate or source snapshot, controlled-contract generation, obligation, proof-plan entry, declared target, test-proof binding, admitted profile, certification, guarantee, and evaluator satisfies the guarantee only when the candidate passes, the one test the binding's declarative test selector names is discovered, executed, and not skipped, every declared falsifier is present, every falsifier the provider could apply is detected, every required traversal is present and proven, and no prohibited shortcut is observed. A falsifier the provider could not apply is an authenticated capability limitation: it earns no detection credit, is not counterevidence, and never excuses a surviving sibling. A supported, isolated, actually observed mutation that leaves the selected test passing falsifies the guarantee; for a passing candidate, an incomplete falsifier population or a supported falsifier that is neither detected nor such a survivor is not executable, and a failed candidate gains no mutation counterevidence from its falsifier rows. No authored baseline inventory participates, and sibling tests observed in the same run neither earn nor withhold credit. Complete valid negative inventory or execution facts falsify the guarantee; missing evidence or an unavailable exact evaluator is not executable; malformed, unauthenticated, stale, ambiguous, cross-bound, contradictory, or digest-mismatched evidence is refused. This is a bounded execution-validity guarantee. It preserves the caller's requirement, verification and falsification meanings unchanged; it does not establish that assertions faithfully test those meanings. Passing execution, detected dependency mutations and module traversal grant no requirement-satisfaction credit. Assertion-to-requirement behavioral adequacy is not established by this mechanism.

- assertion-to-requirement-behavioral-adequacy
- authority-grant
- coordinator-semantic-judgment
- durable-receipt-retention
- lifecycle-admission
- provider-support-invention
- requirement-satisfaction-credit

## Parameters

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |

```json
{
  "roles": [],
  "constraints": [
    {
      "ref": "/stable_capabilities",
      "constraint": {
        "semantic_mechanisms": [],
        "test_validity": "provider_bound_test_validity.v1"
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "authenticated_test_execution": {
          "semantic_facts_schema": "controlled-contract-test-proof-semantic-facts.v1",
          "evaluator_id": "proof.verification.test-validity.execution-evaluator",
          "behavioral_adequacy": "not_established"
        }
      }
    }
  ]
}
```

## Construction, dependencies and capabilities

```json
{
  "construction": {
    "capability": "construction",
    "semantic_inputs": [],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "complete",
    "packs": []
  },
  "capabilities": [
    {
      "id": "construction",
      "kind": "constructor",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/native-test-proof-authoring.mjs applies a native case to existing authored requirements. This metadata does not construct requirement meaning or a behavioral graph pattern.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "This execution definition supplies no generic requirement-meaning constructor.",
        "source": "lib/native-test-proof-authoring.mjs",
        "consequence": "Author the native case against the unchanged requirement; authenticated execution is acquired separately by workspace_verify_proof."
      },
      "implementation_version": null
    },
    {
      "id": "canonical-source",
      "kind": "canonical_resolver",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "work record canonical test declaration and work-record-test-proof-bindings.mjs own the test target and exact selector.",
      "evidence_kind": "requirement",
      "gap": null,
      "implementation_version": null
    },
    {
      "id": "observation",
      "kind": "observation_acquisition",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "workspace_verify_proof acquires authenticated execution observations through the shared runner and native providers; authored planning witnesses cannot supply them.",
      "evidence_kind": "requirement",
      "gap": null,
      "implementation_version": null
    },
    {
      "id": "evaluation",
      "kind": "evaluation",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#resolveExactProofEvaluator",
      "evidence": "lib/proof-evaluator-registry.mjs resolves the exact authenticated execution evaluator. Definition assessment reports execution pending and grants no behavioral credit.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    }
  ]
}
```

Metadata is a declaration. It does not acquire observations or certify implementation truth.
