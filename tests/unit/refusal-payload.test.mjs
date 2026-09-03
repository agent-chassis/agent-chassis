

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicMechanicalRefusal,
  buildRefusal,
  defineRefusalCode,
  forwardRefusal,
  isPublicRedactionReason,
  projectLauncherRedactionReason,
  PUBLIC_REDACTION_REASONS,
  PUBLIC_REDACTION_REASON_VALUES,
  PUBLIC_REFUSAL_SCHEMA_VERSION,
  validatePublicMechanicalRefusal
} from "../../packages/wiki-core/src/lib/refusal-payload.mjs";
import {
  LAUNCHER_TRANSITION_REDACTION_REASONS
} from "../../packages/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import {
  WorktreeReaperError
} from "../../packages/agent-launch-cli/src/lib/worktree-reaper-diagnostics.mjs";
import {
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const VALIDATE_SCHEMA = Object.freeze({
  type: "object",
  properties: { repo: { type: "string" }, id: { type: "string" } },
  required: ["id"],
  additionalProperties: false
});
const DISPATCH_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    repo: { type: "string" },
    role: { type: "string", enum: ["worker", "reviewer", "redteam"] },
    subject: { type: "string" }
  },
  required: ["role", "subject"],
  additionalProperties: false
});

const BACKEND_UNAVAILABLE = "backend_unavailable";
const VALIDATION_FAILURE = "validation_failure";
const READINESS_FAILURE = "work_record_readiness_failure";
const DISPATCH = "workspace_agent_dispatch";
const VALIDATE = "workspace_work_record_validate";

const REQUEST_SCHEMAS = Object.freeze({
  [DISPATCH]: DISPATCH_SCHEMA,
  [VALIDATE]: VALIDATE_SCHEMA
});

test("defineRefusalCode derives a frozen definition from the canonical registry", () => {
  const definition = defineRefusalCode({
    code: BACKEND_UNAVAILABLE,
    namespace: "test.refusal"
  });

  assert.equal(definition.code, BACKEND_UNAVAILABLE);
  assert.equal(definition.namespace, "test.refusal");

  assert.equal(definition.category, "backend");
  assert.equal(typeof definition.summary, "string");
  assert.ok(definition.summary.length > 0);
  assert.ok(Object.isFrozen(definition));
});

test("defineRefusalCode accepts a bare registered code", () => {
  const definition = defineRefusalCode(VALIDATION_FAILURE);
  assert.equal(definition.code, VALIDATION_FAILURE);
  assert.equal(definition.namespace, null);
});

test("WK-2359: an unregistered public code is refused", () => {
  assert.throws(
    () => defineRefusalCode({ code: "test.refusal.invented.v1", namespace: "test.refusal" }),
    /not registered in runtime-blocker-codes\.v1\.json/
  );
});

test("WK-2359: a caller-defined public definition is refused", () => {

  assert.throws(
    () => defineRefusalCode({
      code: BACKEND_UNAVAILABLE,
      namespace: "test.refusal",
      summary: "a meaning this caller invented"
    }),
    /caller-defined field\(s\) summary are refused/
  );
  assert.throws(
    () => defineRefusalCode({
      code: BACKEND_UNAVAILABLE,
      namespace: "test.refusal",
      responsible_actor: "operator",
      remediation: ["repair_configuration"]
    }),
    /caller-defined field\(s\) remediation, responsible_actor are refused/
  );
});

test("selecting the same code from the same namespace returns the canonical definition", () => {
  const first = defineRefusalCode({ code: READINESS_FAILURE, namespace: "test.refusal.dup" });
  const duplicate = defineRefusalCode({ namespace: "test.refusal.dup", code: READINESS_FAILURE });
  assert.strictEqual(duplicate, first);
});

test("a divergent namespace for one code is refused without echoing content", () => {
  const code = "unsupported_route";
  defineRefusalCode({ code, namespace: "test.refusal.first_owner" });
  assert.throws(
    () => defineRefusalCode({ code, namespace: "test.refusal.second_owner" }),
    (error) => {
      assert.match(error.message, /divergent refusal definition/);
      assert.doesNotMatch(error.message, /first_owner/);
      assert.doesNotMatch(error.message, /second_owner/);
      return true;
    }
  );
});

test("buildRefusal accepts only the registered definition object", () => {
  const definition = defineRefusalCode({
    code: "monitor_handle_unknown",
    namespace: "test.refusal.payload"
  });

  assert.deepEqual(buildRefusal(definition, { severity: "error" }), {
    code: definition.code,
    severity: "error"
  });
  assert.throws(
    () => buildRefusal({ code: definition.code, namespace: definition.namespace }),
    /registered refusal definition/
  );
  assert.throws(() => buildRefusal("monitor_handle_unknown"), /registered refusal definition/);
});

test("forwardRefusal validates a code received at runtime against the canonical registry", () => {
  assert.deepEqual(forwardRefusal(BACKEND_UNAVAILABLE, { level: "blocking" }), {
    code: BACKEND_UNAVAILABLE,
    level: "blocking"
  });
  assert.throws(
    () => forwardRefusal("test.refusal.forwarded-unregistered.v1"),
    /registered refusal code/
  );
});

test("buildRefusal preserves extensible payload fields and excludes next_action", () => {
  const definition = defineRefusalCode({
    code: "read_only_mount",
    namespace: "test.refusal.extensible"
  });
  const payload = buildRefusal(definition, {
    severity: "warning",
    audience: "operator",
    future_controlled_field: { value: "stable_value" }
  });

  assert.deepEqual(payload.future_controlled_field, { value: "stable_value" });
  assert.throws(
    () => buildRefusal(definition, { next_action: "retry" }),
    /belongs beside the refusal payload/
  );
});

test("payload wraps a real WorktreeReaperError without changing its identity or code", () => {
  const definition = defineRefusalCode({
    code: "sandbox_write_denial",
    namespace: "test.refusal.worktree"
  });
  const message = "worktree cleanup refused";
  const error = new WorktreeReaperError(message, {
    code: definition.code,
    detail: buildRefusal(definition, { severity: "error" })
  });

  assert.ok(error instanceof WorktreeReaperError);
  assert.equal(error.message, message);
  assert.equal(error.code, definition.code);
  assert.deepEqual(error.detail, { code: definition.code, severity: "error" });
});

test("the public redaction vocabulary is closed", () => {
  for (const reason of PUBLIC_REDACTION_REASON_VALUES) {
    assert.equal(isPublicRedactionReason(reason), true);
  }
  for (const reason of ["truncated", "too_large", "internal", "", null, undefined, 7]) {
    assert.equal(isPublicRedactionReason(reason), false);
  }
});

test("WK-2352 private redaction reasons project exactly once into the public vocabulary", () => {

  for (const privateReason of Object.values(LAUNCHER_TRANSITION_REDACTION_REASONS)) {
    const projected = projectLauncherRedactionReason(privateReason);
    assert.equal(isPublicRedactionReason(projected), true);
  }
});

test("an unknown launcher-private redaction reason is refused, not published verbatim", () => {
  assert.throws(
    () => projectLauncherRedactionReason("some_future_private_reason"),
    /public redaction vocabulary is closed/
  );
  assert.throws(() => projectLauncherRedactionReason(null), /closed/);
});

const BACKEND_REGISTERED = Object.freeze({
  fact: "backend.registered",
  operator: "is_true"
});
const BACKEND_FACTS = Object.freeze({ "backend.registered": false });

function validEnvelopeInput(overrides = {}) {
  return {
    code: BACKEND_UNAVAILABLE,
    deciding_facts: [{ field: "backend.registered", value: false }],
    next_calls: [{
      tool: DISPATCH,
      arguments: { role: "worker", subject: "WK-2359#SLICE-001" },
      recommended: true,
      prerequisite_predicate: BACKEND_REGISTERED,
      success_predicate: BACKEND_REGISTERED
    }],
    recovery: {
      state: "callable",
      prerequisite: "no launch backend is registered for this runtime",
      operation: DISPATCH,
      success_condition: "workspace_agent_dispatch returns accepted:true for the same subject",
      success_predicate: BACKEND_REGISTERED,
      selected_from: ["backend.registered"]
    },
    route: DISPATCH,
    observed_facts: BACKEND_FACTS,
    request_schemas: REQUEST_SCHEMAS,
    ...overrides
  };
}

test("a complete public mechanical refusal is built and frozen", () => {
  const envelope = buildPublicMechanicalRefusal(validEnvelopeInput());
  assert.equal(envelope.schema_version, PUBLIC_REFUSAL_SCHEMA_VERSION);
  assert.equal(envelope.code, BACKEND_UNAVAILABLE);
  assert.equal(envelope.category, "backend");
  assert.ok(Object.isFrozen(envelope));
  assert.equal(envelope.deciding_facts[0].field, "backend.registered");
  assert.deepEqual(envelope.next_calls[0].prerequisite_predicate, BACKEND_REGISTERED);
});

test("identical authenticated facts produce an identical refusal (determinism)", () => {
  const first = buildPublicMechanicalRefusal(validEnvelopeInput());
  const second = buildPublicMechanicalRefusal(validEnvelopeInput());
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

const missingSameCallPrerequisite = validEnvelopeInput();
delete missingSameCallPrerequisite.next_calls[0].prerequisite_predicate;

const SAME_CALL_REFUSAL_FALSIFIERS = [
  {
    name: "missing prerequisite",
    input: missingSameCallPrerequisite,
    expected: /declares no prerequisite_predicate/
  },
  {
    name: "mismatched prerequisite and success predicate",
    input: validEnvelopeInput({ next_calls: [{
      ...validEnvelopeInput().next_calls[0],
      prerequisite_predicate: { fact: "backend.registered", operator: "is_false" }
    }] }),
    expected: /must be byte-identical/
  },
  {
    name: "byte-nonidentical prerequisite",
    input: validEnvelopeInput({ next_calls: [{
      ...validEnvelopeInput().next_calls[0],
      prerequisite_predicate: { operator: "is_true", fact: "backend.registered" }
    }] }),
    expected: /must be byte-identical/
  },
  {
    name: "unpublished fact",
    input: validEnvelopeInput({ next_calls: [{
      ...validEnvelopeInput().next_calls[0],
      prerequisite_predicate: { fact: "backend.unpublished", operator: "is_true" },
      success_predicate: { fact: "backend.unpublished", operator: "is_true" }
    }] }),
    expected: /not a published deciding fact/
  },
  {
    name: "unobserved fact",
    input: validEnvelopeInput({ observed_facts: {} }),
    expected: /unobserved in the returned result/
  },
  {
    name: "redacted fact",
    input: validEnvelopeInput({ deciding_facts: [{
      field: "backend.registered",
      redacted: true,
      redaction_reason: PUBLIC_REDACTION_REASONS.LAUNCHER_PRIVATE_STATE
    }] }),
    expected: /names redacted deciding fact/
  },
  {
    name: "omitted fact",
    input: validEnvelopeInput({ deciding_facts: [{
      field: "backend.registered",
      omitted: true,
      retrieval: { kind: "complete", route: "workspace_get_record" }
    }] }),
    expected: /names omitted deciding fact/
  },
  {
    name: "already-true predicate",
    input: validEnvelopeInput({
      deciding_facts: [{ field: "backend.registered", value: true }],
      observed_facts: { "backend.registered": true }
    }),
    expected: /already true in the returned result/
  }
];

for (const { name, input, expected } of SAME_CALL_REFUSAL_FALSIFIERS) {
  test(`production refusal carrier rejects same-call recovery with ${name}`, () => {
    assert.throws(() => buildPublicMechanicalRefusal(input), expected);
  });
}

test("production refusal carrier preserves a fresh independent owner-defined action", () => {
  const sameCall = validEnvelopeInput().next_calls[0];
  const envelope = buildPublicMechanicalRefusal(validEnvelopeInput({
    next_calls: [sameCall, {
      tool: VALIDATE,
      arguments: { id: "WK-2359" },
      success_predicate: BACKEND_REGISTERED
    }]
  }));
  assert.equal(Object.hasOwn(envelope.next_calls[1], "prerequisite_predicate"), false);
});

test("recovery.operation remains the offered cross-tool call, not the originating route", () => {
  const crossTool = {
    tool: VALIDATE,
    arguments: { id: "WK-2359" },
    success_predicate: BACKEND_REGISTERED
  };
  const envelope = buildPublicMechanicalRefusal(validEnvelopeInput({
    next_calls: [crossTool],
    recovery: {
      ...validEnvelopeInput().recovery,
      operation: VALIDATE
    }
  }));
  assert.equal(envelope.route, DISPATCH);
  assert.equal(envelope.recovery.operation, VALIDATE);
  assert.equal(Object.hasOwn(envelope.next_calls[0], "prerequisite_predicate"), false);
});

test("cross-tool recovery rejects a same-call prerequisite predicate", () => {
  assert.throws(() => buildPublicMechanicalRefusal(validEnvelopeInput({
    next_calls: [{
      tool: VALIDATE,
      arguments: { id: "WK-2359" },
      prerequisite_predicate: BACKEND_REGISTERED,
      success_predicate: BACKEND_REGISTERED
    }],
    recovery: {
      ...validEnvelopeInput().recovery,
      operation: VALIDATE
    }
  })), /reserved for a next call that invokes the originating tool/);
});

test("WK-2359: a refusal without a deciding-fact identity is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(validEnvelopeInput({ deciding_facts: [{ value: false }] })),
    /must name a non-empty field identity/
  );
  assert.throws(
    () => buildPublicMechanicalRefusal(validEnvelopeInput({ deciding_facts: [] })),
    /at least one deciding fact/
  );
});

test("WK-2359: an unregistered next-call tool is refused on the envelope", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({ next_calls: [{ tool: "restore_wk_lifecycle", recommended: true }] })
    ),
    /not in the canonical tool-discovery corpus/
  );
});

test("WK-2359: a refusal must offer a next call or declare no_supported_route", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({ next_calls: null, recovery: { state: "no_supported_route" } })
    ),
    /must offer a validated next call or explicitly declare no_supported_route/
  );
});

test("an explicit no_supported_route refusal is valid and carries no callable recovery", () => {
  const envelope = buildPublicMechanicalRefusal({
    code: "operator_recovery_needed",
    deciding_facts: [{ field: "operator.intervention_required", value: true }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" }
  });
  assert.equal(envelope.no_supported_route, true);
  assert.equal(envelope.recovery.state, "no_supported_route");
  assert.equal(envelope.next_calls, undefined);
});

test("WK-2359: no_supported_route contradicting a callable recovery is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({ next_calls: null, no_supported_route: true })
    ),
    /no_supported_route contradicts a callable recovery/
  );
});

test("WK-2359: a callable recovery must name a false prerequisite", () => {
  const input = validEnvelopeInput();
  delete input.recovery.prerequisite;
  assert.throws(
    () => buildPublicMechanicalRefusal(input),
    /must name the currently false prerequisite/
  );
});

test("WK-2359: a callable recovery must name a canonical operation", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        recovery: {
          state: "callable",
          prerequisite: "p",
          operation: "restore_wk_lifecycle",
          success_condition: "c"
        }
      })
    ),
    /canonical operation capable of changing the prerequisite/
  );
});

test("WK-2359: a callable recovery must state a machine-checkable success condition", () => {
  const input = validEnvelopeInput();
  delete input.recovery.success_condition;
  assert.throws(
    () => buildPublicMechanicalRefusal(input),
    /machine-checkable success condition/
  );
});

test("a sensitive deciding fact publishes its identity and a closed reason, never its value", () => {
  const envelope = buildPublicMechanicalRefusal(
    validEnvelopeInput({
      deciding_facts: [
        {
          field: "launcher.credential",
          redacted: true,
          redaction_reason: PUBLIC_REDACTION_REASONS.SECRET_MATERIAL
        },
        { field: "backend.registered", value: false }
      ]
    })
  );
  const redactedFact = envelope.deciding_facts[0];
  assert.equal(redactedFact.field, "launcher.credential");
  assert.equal(redactedFact.redacted, true);
  assert.equal(Object.hasOwn(redactedFact, "value"), false);
});

test("WK-2359: a redacted fact that still carries its value is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [{
          field: "launcher.credential",
          redacted: true,
          redaction_reason: PUBLIC_REDACTION_REASONS.SECRET_MATERIAL,
          value: "super-secret"
        }]
      })
    ),
    /must not carry its value/
  );
});

test("WK-2359: an undocumented redaction reason is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [{ field: "x", redacted: true, redaction_reason: "too_large" }]
      })
    ),
    /closed public reasons/
  );
});

test("WK-2359: a redaction_reason without a redaction is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [{
          field: "x",
          value: 1,
          redaction_reason: PUBLIC_REDACTION_REASONS.SECRET_MATERIAL
        }]
      })
    ),
    /without being redacted/
  );
});

test("WK-2359: a non-sensitive omission without a lossless retrieval route is refused", () => {

  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({ deciding_facts: [{ field: "large.list", omitted: true }] })
    ),
    /must document a lossless retrieval route/
  );
});

test("a non-sensitive omission with a documented retrieval route is accepted", () => {
  const envelope = buildPublicMechanicalRefusal(
    validEnvelopeInput({
      deciding_facts: [
        {
          field: "write_scope.entries",
          omitted: true,
          retrieval: { kind: "paginated", route: "workspace_get_record" }
        },
        { field: "backend.registered", value: false }
      ]
    })
  );
  assert.equal(envelope.deciding_facts[0].retrieval.kind, "paginated");
});

test("WK-2359: an omission whose retrieval route is not a canonical tool is refused", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [
          {
            field: "write_scope.entries",
            omitted: true,
            retrieval: { kind: "complete", route: "read_the_file_yourself" }
          },
          { field: "backend.registered", value: false }
        ]
      })
    ),
    /retrieval\.route must name a canonical MCP route/
  );
});

test("WK-2359: a redacted fact may not select recovery", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [{
          field: "launcher.credential",
          redacted: true,
          redaction_reason: PUBLIC_REDACTION_REASONS.SECRET_MATERIAL
        }],
        recovery: {
          state: "callable",
          prerequisite: "p",
          operation: VALIDATE,
          success_condition: "c",
          selected_from: ["launcher.credential"]
        }
      })
    ),
    /redacted data must not select recovery/
  );
});

test("WK-2359: an omitted fact may not select recovery", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(
      validEnvelopeInput({
        deciding_facts: [{
          field: "write_scope.entries",
          omitted: true,
          retrieval: { kind: "complete", route: "workspace_get_record" }
        }],
        recovery: {
          state: "callable",
          prerequisite: "p",
          operation: VALIDATE,
          success_condition: "c",
          selected_from: ["write_scope.entries"]
        }
      })
    ),
    /an unpublished value must not select recovery/
  );
});

test("a carried authenticated policy carrier survives byte-for-byte in semantic content", () => {
  const carrier = {
    exact_returned_policy: {
      verdict: "needs_review",
      reasons: ["review_threshold"],
      remediation: ["obtain_reviewer_decision"],
      authority: { binding: "cce", ratified: true, digest: "sha256:abc" },
      action: "hold",
      target: "WK-2359",
      decision_id: "DEC-CCE-0001"
    }
  };
  const envelope = buildPublicMechanicalRefusal(validEnvelopeInput({ carried: carrier }));
  assert.deepEqual(envelope.carried, carrier);
  assert.equal(envelope.carried.exact_returned_policy.verdict, "needs_review");
  assert.equal(envelope.carried.exact_returned_policy.decision_id, "DEC-CCE-0001");
});

test("validatePublicMechanicalRefusal enumerates every defect in one pass", () => {
  const result = validatePublicMechanicalRefusal({
    code: "not_a_registered_code",
    deciding_facts: [{ value: 1 }],
    recovery: { state: "callable" }
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4, `expected several errors, got ${result.errors.length}`);
  assert.ok(result.errors.some((e) => /not registered/.test(e)));
  assert.ok(result.errors.some((e) => /field identity/.test(e)));
});

const OBSERVED_FACTS = Object.freeze({
  "wk.acceptance.criteria": "absent",
  "dispatch.role_capability": false
});

function actionableRefusal(overrides = {}) {
  return {
    code: READINESS_FAILURE,
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: [{
      tool: VALIDATE,
      arguments: { id: "WK-2386" },
      recommended: true,
      prerequisite_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" },
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
    }],
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: VALIDATE,
      success_condition: "workspace_work_record_validate reports zero readiness defects for WK-2386",
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" },
      selected_from: ["wk.acceptance.criteria"]
    },
    route: VALIDATE,
    observed_facts: OBSERVED_FACTS,
    request_schemas: REQUEST_SCHEMAS,
    ...overrides
  };
}

test("only a locally registered public mechanical code reaches a public envelope", () => {
  const anonymous = validatePublicMechanicalRefusal({
    code: "invented_public_code",
    deciding_facts: [{ field: "x", value: 1 }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" }
  });
  assert.equal(anonymous.valid, false);
  assert.match(anonymous.errors[0], /not registered in runtime-blocker-codes\.v1\.json/);

  for (const [identity, classification] of [
    ["retry_launch", "private_launcher_token"],
    ["frozen_standalone_findings_contract_invalid", "private_launcher_cause"],
    ["worker_admission.accepted_authority.v1", "private_package_cause"],
    ["worker_admission_review_threshold_exceeded", "authenticated_authority"]
  ]) {
    const result = validatePublicMechanicalRefusal({
      code: identity,
      deciding_facts: [{ field: "launcher.cause", value: identity }],
      no_supported_route: true,
      recovery: { state: "no_supported_route" }
    });
    assert.equal(result.valid, false, identity);
    assert.match(result.errors[0], new RegExp(`is a ${classification}`), identity);
    assert.match(result.errors[0], /not registered in runtime-blocker-codes\.v1\.json/, identity);
  }
});

test("authenticated CCE policy semantics are never authored on the envelope", () => {

  for (const field of ["verdict", "reasons", "remediation", "authority", "decision_id", "exact_returned_policy", "ratified"]) {
    const result = validatePublicMechanicalRefusal({
      code: BACKEND_UNAVAILABLE,
      deciding_facts: [{ field: "backend.available", value: false }],
      no_supported_route: true,
      recovery: { state: "no_supported_route" },
      [field]: "locally invented"
    });
    assert.equal(result.valid, false, field);
    assert.match(result.errors[0], /authenticated CCE policy content/, field);
  }
});

test("a carried CCE policy result crosses unchanged and is neither validated nor registered", () => {
  const policy = {
    exact_returned_policy: {
      verdict: "needs_review",
      reasons: ["worker_admission.review_threshold_exceeded.v1", "cce.policy.breadth_judgment.v2"],
      remediation: ["obtain a reviewer decision for the exact slice"],
      authority: { binding: "chassis-control-engine", ratified: true, digest: "sha256:feedface" },
      decision_id: "cce.decision.4417.v1"
    }
  };
  const envelope = buildPublicMechanicalRefusal({
    code: "launcher_transition.cce_policy_refused.v1",
    deciding_facts: [{ field: "policy.verdict", value: "needs_review" }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    carried: policy
  });
  assert.deepEqual(envelope.carried, policy);

  for (const reason of envelope.carried.exact_returned_policy.reasons) {
    assert.equal(isRuntimeBlockerCode(reason), false, reason);
  }
  assert.equal(isRuntimeBlockerCode(envelope.carried.exact_returned_policy.decision_id), false);

  assert.equal(envelope.summary, getRuntimeBlockerEntry(envelope.code).summary);
});

test("a carried launcher classification is validated, never derived", () => {

  for (const field of ["cause_category", "authority_limb", "launcher_cause", "transition_cause"]) {
    const result = validatePublicMechanicalRefusal({
      code: BACKEND_UNAVAILABLE,
      deciding_facts: [{ field: "backend.available", value: false }],
      no_supported_route: true,
      recovery: { state: "no_supported_route" },
      [field]: "mechanical_configuration"
    });
    assert.equal(result.valid, false, field);
    assert.match(result.errors[0], /owned by WK-2388; this carrier validates a carried classification/, field);
  }

  const halfCarried = validatePublicMechanicalRefusal({
    code: BACKEND_UNAVAILABLE,
    deciding_facts: [{ field: "backend.available", value: false }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    carried: { launcher_transition: { cause_category: "mechanical_configuration" } }
  });
  assert.equal(halfCarried.valid, false);
  assert.match(halfCarried.errors[0], /must carry the launcher-selected authority_limb/);

  const complete = buildPublicMechanicalRefusal({
    code: BACKEND_UNAVAILABLE,
    deciding_facts: [{ field: "backend.available", value: false }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    carried: {
      launcher_transition: {
        cause_category: "mechanical_configuration",
        authority_limb: "mechanical_integrity",
        cause: "launcher_transition.runtime_backend_unavailable.v1"
      }
    }
  });
  assert.deepEqual(complete.carried.launcher_transition, {
    cause_category: "mechanical_configuration",
    authority_limb: "mechanical_integrity",
    cause: "launcher_transition.runtime_backend_unavailable.v1"
  });
});

test("a recovery may not name an operation no offered next call invokes", () => {
  const result = validatePublicMechanicalRefusal({
    code: READINESS_FAILURE,
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: [{ tool: VALIDATE, recommended: true }],
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: DISPATCH,
      success_condition: "the contract validates",
      success_predicate: BACKEND_REGISTERED
    }
  }, { observedFacts: OBSERVED_FACTS, requestSchemas: REQUEST_SCHEMAS });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => /which no offered, non-disallowed next call invokes/.test(error)),
    result.errors.join("; ")
  );
});

test("the carrier builds a convergent refusal and carries its observed facts", () => {
  const envelope = buildPublicMechanicalRefusal(actionableRefusal());
  assert.equal(envelope.schema_version, PUBLIC_REFUSAL_SCHEMA_VERSION);
  assert.deepEqual(envelope.observed_facts, OBSERVED_FACTS);
  assert.equal(envelope.next_calls[0].success_predicate.operator, "equals");

  assert.deepEqual(buildPublicMechanicalRefusal(actionableRefusal()), envelope);
});

test("the carrier refuses an already-satisfied continuation (unchanged-fact loop)", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      next_calls: [{
        tool: VALIDATE,
        arguments: { id: "WK-2386" },
        recommended: true,

        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "absent" }
      }]
    })),
    /already satisfied by the observed fact/
  );
});

test("the carrier refuses an incomplete argument and an unstated outcome", () => {
  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      next_calls: [{
        tool: VALIDATE,
        arguments: { id: "<the-unit-from-the-refusal>" },
        recommended: true,
        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
      }]
    })),
    /leaves id unresolved/
  );
  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      next_calls: [{ tool: VALIDATE, arguments: { id: "WK-2386" }, recommended: true }]
    })),
    /declares no success_predicate/
  );
  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      recovery: {
        state: "callable",
        prerequisite: "the authored contract declares no acceptance criteria",
        operation: VALIDATE,
        success_condition: "workspace_work_record_validate reports zero readiness defects"
      }
    })),
    /must state its success as a machine-checkable predicate/
  );
});

test("there is no second contract to select", () => {

  const wk2359Shape = {
    code: READINESS_FAILURE,
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: [{ tool: VALIDATE, arguments: { id: "WK-2359" }, recommended: true }],
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: VALIDATE,
      success_condition: "workspace_work_record_validate reports zero readiness defects for WK-2359",
      selected_from: ["wk.acceptance.criteria"]
    }
  };
  assert.throws(
    () => buildPublicMechanicalRefusal(wk2359Shape),
    /declares no success_predicate/
  );
  const validated = validatePublicMechanicalRefusal(wk2359Shape);
  assert.equal(validated.valid, false);
  assert.ok(validated.errors.some((error) => /declares no success_predicate/.test(error)));
  assert.ok(
    validated.errors.some((error) => /requires each named tool's authoritative request schema/.test(error))
  );
  assert.ok(
    validated.errors.some((error) => /must state its success as a machine-checkable predicate/.test(error))
  );

  assert.throws(
    () => buildPublicMechanicalRefusal({ ...wk2359Shape, profile: "v1" }),
    /declares no success_predicate/
  );
  assert.equal(
    validatePublicMechanicalRefusal(wk2359Shape, { profile: "v1" }).valid,
    false
  );
});

test("a carrier carries the facts it was checked against, so revalidation is deterministic", () => {
  const envelope = buildPublicMechanicalRefusal(actionableRefusal());
  assert.deepEqual(envelope.observed_facts, OBSERVED_FACTS);

  assert.deepEqual(
    validatePublicMechanicalRefusal(envelope, { requestSchemas: REQUEST_SCHEMAS }),
    { valid: true, errors: [] }
  );
  assert.deepEqual(
    validatePublicMechanicalRefusal(envelope, {
      observedFacts: envelope.observed_facts,
      requestSchemas: REQUEST_SCHEMAS
    }),
    { valid: true, errors: [] }
  );

  assert.equal(Object.hasOwn(envelope, "validation_profile"), false);
});

test("an actionable carrier validates its arguments against supplied schema authority", () => {

  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      next_calls: [{
        tool: VALIDATE,
        arguments: { unit: "WK-2386" },
        recommended: true,
        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
      }]
    })),
    /declares unit, which the request schema for workspace_work_record_validate does not accept/
  );

  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({ request_schemas: null })),
    /requires each named tool's authoritative request schema/
  );
});

test("an actionable continuation limb must offer something the agent may call", () => {

  assert.throws(
    () => buildPublicMechanicalRefusal(actionableRefusal({
      next_calls: [{ tool: VALIDATE, disallowed: true, reason: "wrong surface" }],
      recovery: {
        state: "callable",
        prerequisite: "the authored contract declares no acceptance criteria",
        operation: VALIDATE,
        success_condition: "workspace_work_record_validate reports zero readiness defects",
        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" },
        selected_from: ["wk.acceptance.criteria"]
      }
    })),
    /at least one non-disallowed callable entry/
  );

  const disallowedMatch = validatePublicMechanicalRefusal({
    schema_version: PUBLIC_REFUSAL_SCHEMA_VERSION,
    code: READINESS_FAILURE,
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: [
      {
        tool: DISPATCH,
        arguments: { role: "worker", subject: "WK-2386#SLICE-003" },
        recommended: true,
        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
      },
      { tool: VALIDATE, disallowed: true, reason: "already run for this candidate" }
    ],
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: VALIDATE,
      success_condition: "workspace_work_record_validate reports zero readiness defects",
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" },
      selected_from: ["wk.acceptance.criteria"]
    }
  }, {
    observedFacts: OBSERVED_FACTS,
    requestSchemas: {
      [DISPATCH]: {
        type: "object",
        properties: {
          repo: { type: "string" },
          role: { type: "string", enum: ["worker", "reviewer", "redteam"] },
          subject: { type: "string" }
        },
        required: ["role", "subject"],
        additionalProperties: false
      }
    }
  });
  assert.equal(disallowedMatch.valid, false);
  assert.ok(
    disallowedMatch.errors.some((error) => /no offered, non-disallowed next call invokes/.test(error)),
    disallowedMatch.errors.join("; ")
  );
});

test("dual-limb and missing-limb refusals are both refused", () => {
  const dual = validatePublicMechanicalRefusal({
    code: BACKEND_UNAVAILABLE,
    deciding_facts: [{ field: "backend.available", value: false }],
    next_calls: [{
      tool: VALIDATE,
      arguments: { id: "WK-2386" },
      success_predicate: { fact: "backend.available", operator: "is_true" }
    }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" }
  }, {
    observedFacts: { "backend.available": false },
    requestSchemas: REQUEST_SCHEMAS
  });
  assert.equal(dual.valid, false);
  assert.ok(
    dual.errors.some((error) => /cannot both offer next calls and declare no supported route/.test(error))
  );

  const missing = validatePublicMechanicalRefusal({
    code: BACKEND_UNAVAILABLE,
    deciding_facts: [{ field: "backend.available", value: false }],
    recovery: { state: "no_supported_route" }
  }, {
    observedFacts: { "backend.available": false },
    requestSchemas: REQUEST_SCHEMAS
  });
  assert.equal(missing.valid, false);
  assert.ok(
    missing.errors.some((error) => /must offer a validated next call or explicitly declare no_supported_route/.test(error))
  );
});
