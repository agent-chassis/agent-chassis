import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readWorkRecordById } from "../../packages/wiki-core/src/operations/work-records.mjs";
import { validateWorkRecordDispatch } from "../../packages/wiki-core/src/operations/validate-dispatch.mjs";
import {
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE
} from "../../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import { createCompactValidateDispatchResponse } from "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

export async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-mcp-diagnostics-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function makeNodeEnginePackResponse(status, body, { contentType = "application/json" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key) => (String(key).toLowerCase() === "content-type" ? contentType : null)
    },
    text: async () => text
  };
}

export function packBackedEnvelope(decision, reasons = [], { recovery = null } = {}) {
  const distinct = (key) => [...new Set(reasons.flatMap((reason) =>
    typeof reason?.[key] === "string" ? [reason[key]] : []))];
  if (recovery !== null) {
    return {
      pack_result: {
        schema_version: "worker_admission.evaluate_work_unit_dispatch.result.v1",
        pack: "worker_admission_v1",
        operation: "evaluate_work_unit_dispatch",
        decision,
        accounting: { evidence_ref_total: 0, problem_total: reasons.length },
        reasons,
        recovery
      }
    };
  }
  return {
    pack_result: {
      schema_version: "worker_admission.evaluate_work_unit_dispatch.result.v1",
      pack: "worker_admission_v1",
      operation: "evaluate_work_unit_dispatch",
      decision,
      accounting: { evidence_ref_total: 0, problem_total: reasons.length },
      reasons,
      ...(decision === "admit" ? {} : {
        recovery: {
          schema_version: "worker_admission.recovery.v1",
          projection_mode: "bounded_current_decision_recovery",
          authority: "advisory_recovery_only",
          requires_resubmission: true,
          truncated: false,
          actions: [{
            kind: "split_or_reduce_scope",
            reason_codes: distinct("code"),
            fields: distinct("field"),
            next_action: "Apply the returned CCE remediation and resubmit."
          }]
        }
      })
    }
  };
}

export function countingFetch(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

export function completeNodeEngineEnv(overrides = {}) {
  return {
    NODE_ENGINE_SERVICE_URL: "https://node-engine.invalid/secret-base-7f3a",
    NODE_ENGINE_API_KEY: "ne-secret-key-abcdef-9876",
    NODE_ENGINE_WORKER_ADMISSION_ROUTE: "/v1/validate",
    NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST: "sha256:contractdigestvalue0001",
    NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING: "ne-authority-binding-secret-2026",
    ...overrides
  };
}

export function buildAdmissionGateRecord(id, writeScope, overrides = {}) {
  const record = {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Worker-admission gate fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-06-07",
    updated: "2026-06-07",
    initiative: "IN-0013",
    area: "wiki-mcp",
    docs: ["docs/work-record-schema.md"],
    repo_paths: [...writeScope],
    write_scope: [...writeScope],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },

    proof_posture: {
      schema_version: "work-record-proof-posture.v1",
      record_id: id,
      classification: "standard",
      classification_rationale: "Fixture isolates worker-admission diagnostics.",
      controlled_contract: { required: false, exemption: "no_controlled_contract", focus: null }
    },
    acceptance: {
      criteria: ["Dispatch readiness folds in worker-admission admissibility."],
      validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
    },
    sections: {
      summary: "Worker-admission gate readiness fixture.",
      why_it_matters: "Pins the dispatchability conjunction.",
      scope: { items: ["dispatch readiness"], out_of_scope: ["wrapper launch"] },
      tasks: [{ text: "Validate dispatch readiness.", status: "todo" }],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null
  };
  return { ...record, ...overrides };
}

export async function installAdmissionGateRecord(tempDir, record) {
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });

  await mkdir(path.join(tempDir, "wiki", "contracts"), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const loaded = await readWorkRecordById({ dir: tempDir, id: record.id });
  assert.equal(loaded.valid, true, JSON.stringify(loaded.diagnostics));
  CANONICAL_FIXTURE_RECORD_DIGESTS.add(loaded.source_digest);
}

const CANONICAL_FIXTURE_RECORD_DIGESTS = new Set();

export const WORKSPACE_REPO = "agent-chassis";

export const REQUEST_CONTRACT_DIGEST_ENV = "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST";

export const BOUNDED_ADMISSIBILITY_KEYS = Object.freeze([
  "admissible",
  "authenticated_request_sent",
  "authority",
  "binding_status",
  "diagnostic_code",
  "effect",
  "evaluated",
  "node_engine_backed",
  "pack_backed",
  "ratified",
  "reasons",
  "status"
]);

export function leakyProblemBody(problemType, { status = 400 } = {}) {
  return {
    type: problemType,
    title: "Worker admission request rejected",
    status,
    detail: "LEAKY_DETAIL_must_not_appear_in_any_response",
    observed_request_schema_digest: "sha256:OBSERVEDDIGESTLEAK0001",
    expected_request_schema_digest: "sha256:EXPECTEDDIGESTLEAK0002",
    graph_node_count: 730731,
    precondition_graph_size: 840841,
    policy_profile: { id: "LEAKY_PROFILE_ID_991", contents: "LEAKY_PROFILE_CONTENTS_992" }
  };
}

export const FORBIDDEN_SUBSTRINGS = Object.freeze([

  "node-engine.invalid",
  "secret-base-7f3a",
  "https://",
  "http://",
  "bearer",
  "Authorization",
  "x-api-key",

  "ne-secret-key-abcdef-9876",

  "contractdigestvalue0001",
  "sha256:",

  "ne-authority-binding-secret-2026",

  "LEAKY_DETAIL_must_not_appear_in_any_response",
  "OBSERVEDDIGESTLEAK0001",
  "EXPECTEDDIGESTLEAK0002",
  "730731",
  "840841",
  "LEAKY_PROFILE_ID_991",
  "LEAKY_PROFILE_CONTENTS_992"
]);

export const FORBIDDEN_PROBLEM_FIELD_NAMES = Object.freeze([
  "observed_request_schema_digest",
  "expected_request_schema_digest",
  "graph_node_count",
  "precondition_graph_size",
  "policy_profile",
  "detail"
]);

export function assertNoSecretLeak(payload, label) {
  let serialized = JSON.stringify(payload);
  for (const digest of CANONICAL_FIXTURE_RECORD_DIGESTS) {
    serialized = serialized.replaceAll(digest, "<canonical-record-source-digest>");
  }
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${label} must not surface "${forbidden}"`
    );
  }
  for (const fieldName of FORBIDDEN_PROBLEM_FIELD_NAMES) {
    assert.equal(
      serialized.includes(`"${fieldName}"`),
      false,
      `${label} must not surface raw problem payload field "${fieldName}"`
    );
  }
}

export const PROBLEM_CASES = Object.freeze([
  {
    label: "pack_input_required",
    problemType: "/errors/pack-input-required",
    expectedDiagnosticCode: "node_engine_pack_input_required",
    assertNextAction(nextAction) {
      assert.match(nextAction, /missing/i, "pack_input_required next_action must say the carrier/profile/pack-input is missing");
      assert.match(
        nextAction,
        /(carrier|profile|pack[ -]?input)/i,
        "pack_input_required next_action must name the missing carrier/profile/pack-input"
      );
    }
  },
  {
    label: "pack_input_invalid",
    problemType: "/errors/pack-input-invalid",
    expectedDiagnosticCode: "node_engine_pack_input_invalid",
    assertNextAction(nextAction) {
      assert.match(
        nextAction,
        /(present|malformed|digest[ -]?vector|schema|conformance[ -]?failed)/i,
        "pack_input_invalid next_action must describe a present-but-malformed carrier, digest-vector/schema issue, or conformance failure"
      );
      assert.doesNotMatch(
        nextAction,
        /missing/i,
        "pack_input_invalid next_action must not reuse the missing-carrier remediation"
      );
    }
  },
  {
    label: "request_schema_digest_mismatch",
    problemType: "/errors/request-schema-digest-mismatch",
    expectedDiagnosticCode: "node_engine_request_schema_digest_mismatch",
    assertNextAction(nextAction) {
      assert.ok(
        nextAction.includes(REQUEST_CONTRACT_DIGEST_ENV),
        "request_schema_digest_mismatch next_action must name the request-contract digest env var to rebind"
      );
      assert.match(nextAction, /re-?bind|re-?pin/i, "request_schema_digest_mismatch next_action must instruct a rebind");

      assert.doesNotMatch(nextAction, /sha256:/i, "request_schema_digest_mismatch next_action must not embed a digest value");
    }
  },
  {
    label: "precondition_graph_too_large",
    problemType: "/errors/precondition_graph_too_large",
    expectedDiagnosticCode: "node_engine_precondition_graph_too_large",
    assertNextAction(nextAction) {
      assert.match(nextAction, /graph/i, "precondition_graph_too_large next_action must reference the dependency graph");
      assert.match(nextAction, /(reduce|split)/i, "precondition_graph_too_large next_action must instruct reduce/split");

      assert.doesNotMatch(nextAction, /\d/, "precondition_graph_too_large next_action must not embed a graph/node count");
    }
  },
  {
    label: "non_object_data",
    problemType: "/errors/non-object-data",
    expectedDiagnosticCode: "node_engine_non_object_data",
    assertNextAction(nextAction) {
      assert.match(nextAction, /(malformed|non[ -]?object)/i, "non_object_data next_action must describe malformed/non-object data");
      assert.match(nextAction, /data envelope/i, "non_object_data next_action must identify the data envelope");
      assert.doesNotMatch(
        nextAction,
        /(raw|payload|detail|observed_request_schema_digest|expected_request_schema_digest|graph_node_count|precondition_graph_size|policy_profile)/i,
        "non_object_data next_action must not include raw payload details or field names"
      );
    }
  }
]);

export async function driveProblemReadiness(tempDir, problemType) {
  const record = buildAdmissionGateRecord("WK-9970", [
    "packages/wiki-core/src/lib/admission-gate-clean.mjs"
  ]);
  await installAdmissionGateRecord(tempDir, record);

  const fetchImpl = countingFetch(makeNodeEnginePackResponse(400, leakyProblemBody(problemType)));
  const readiness = await validateWorkRecordDispatch({
    dir: tempDir,
    unitAddress: "WK-9970",
    node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
  });

  assert.equal(fetchImpl.calls.length, 1, "a configured backend must send exactly one admission request");
  return readiness;
}

export function syntheticUndeterminedReadiness(diagnosticCode) {
  return {
    record_id: "WK-9970",
    unit: "WK-9970",
    dispatch_role: "implementation",
    dispatchable: false,
    decision_code: NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    reasons: [`Node Engine admissibility could not be determined (${diagnosticCode})`],
    clusters: [],
    structural_readiness: { dispatchable: true, decision_code: "dispatchable" },
    admissibility: {
      evaluated: true,
      authority: "node_engine",
      status: "undetermined",
      admissible: false,
      effect: null,
      pack_backed: false,
      node_engine_backed: false,
      binding_status: "node_engine_unratified_placeholder",
      ratified: false,
      diagnostic_code: diagnosticCode,
      reasons: []
    }
  };
}

export function packBackedEnvelopeWithoutReasons(decision) {
  const envelope = packBackedEnvelope(decision, []);
  delete envelope.pack_result.reasons;
  return envelope;
}

export async function driveNeedsReviewReadiness(body) {
  let readiness = null;
  await withTempRepo(async (tempDir) => {
    const record = buildAdmissionGateRecord("WK-9970", [
      "packages/wiki-core/src/lib/admission-gate-clean.mjs"
    ]);
    await installAdmissionGateRecord(tempDir, record);

    const fetchImpl = countingFetch(makeNodeEnginePackResponse(200, body));
    readiness = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-9970",
      node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
    });
    assert.equal(fetchImpl.calls.length, 1, "a configured backend must send exactly one admission request");
  });
  return readiness;
}

export function assertNeedsReviewPublicOverlay(readiness) {
  assert.equal(readiness.dispatchable, false);
  assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE);
  assert.equal(readiness.admissibility.status, "needs_review");
  assert.equal(readiness.admissibility.effect, "needs_review");
  assert.equal(readiness.admissibility.authority, "node_engine");
  assert.equal(readiness.admissibility.admissible, false);
  assert.equal(readiness.admissibility.pack_backed, true);
  assert.equal(readiness.admissibility.node_engine_backed, true);
  assert.equal(readiness.admissibility.diagnostic_code, "node_engine_needs_review");
}

export function assertNeedsReviewPublicResponse(readiness) {
  assertNeedsReviewPublicOverlay(readiness);
  const ordinary = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);

  assert.equal(ordinary.admissibility.status, "needs_review");
  assert.equal(ordinary.admissibility.diagnostic_code, "node_engine_needs_review");
  assert.equal(
    ordinary.admissibility.needs_review_recovery,
    undefined,
    "ordinary workspace_validate_dispatch must not synthesize a local needs_review recovery"
  );
  const recovery = ordinary.admissibility.recovery_validation;
  assert.equal(
    recovery?.state,
    "valid",
    "ordinary workspace_validate_dispatch must carry the validator-owned CCE recovery"
  );

  return { ordinary, recovery };
}

export function assertNoRawValueLeakAnywhere(publicResponses, forbiddenValues) {
  for (const [label, payload] of Object.entries(publicResponses)) {
    const serialized = JSON.stringify(payload);
    for (const value of forbiddenValues) {
      assert.equal(
        serialized.includes(value),
        false,
        `${label} public validate-dispatch response must not surface raw unknown value ${value}`
      );
    }
  }
}

export const GENERIC_DEFAULT_NEXT_ACTION_PATTERN = /Resolve blocking issue/i;

export function syntheticFailClosedReadiness({ status, decisionCode, diagnosticCode }) {
  return {
    record_id: "WK-9970",
    unit: "WK-9970",
    dispatch_role: "implementation",
    dispatchable: false,
    decision_code: decisionCode,
    reasons: [`Node Engine admissibility (${diagnosticCode})`],
    clusters: [],
    structural_readiness: { dispatchable: true, decision_code: "dispatchable" },
    admissibility: {
      evaluated: true,
      authority: "node_engine",
      status,
      admissible: false,
      effect: null,
      pack_backed: false,
      node_engine_backed: false,
      binding_status: "node_engine_unratified_placeholder",
      ratified: false,
      diagnostic_code: diagnosticCode,
      reasons: []
    }
  };
}

function assertConfigureNextAction(nextAction, label) {
  assert.match(nextAction, /configure/i, `${label} next_action must instruct configuring the backend`);
  assert.ok(
    nextAction.includes("NODE_ENGINE_"),
    `${label} next_action must name the NODE_ENGINE_* configuration to set`
  );
  assert.match(
    nextAction,
    /(free|local-only)/i,
    `${label} next_action must offer the intended free/local-only path as the alternative`
  );
}

export const FAIL_CLOSED_CASES = Object.freeze([
  {
    label: "node_engine_admit_unratified",
    status: "unratified",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
    diagnosticCode: "node_engine_admit_unratified",
    assertNextAction(nextAction) {
      assert.match(nextAction, /ratif/i, "node_engine_admit_unratified next_action must instruct ratifying the binding");
      assert.match(nextAction, /binding/i, "node_engine_admit_unratified next_action must name the authority binding");

      assert.doesNotMatch(
        nextAction,
        /configure/i,
        "node_engine_admit_unratified next_action must not reuse the not-configured remediation"
      );
    }
  },
  {
    label: "node_engine_unavailable",
    status: "unavailable",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    diagnosticCode: "node_engine_unavailable",
    assertNextAction(nextAction) {
      assert.match(
        nextAction,
        /(reachab|service|backend)/i,
        "node_engine_unavailable next_action must reference backend/service reachability"
      );
      assert.match(nextAction, /auth/i, "node_engine_unavailable next_action must reference auth");
      assert.match(nextAction, /entitlement/i, "node_engine_unavailable next_action must reference entitlement");
      assert.match(nextAction, /retry/i, "node_engine_unavailable next_action must instruct a retry");
    }
  },
  {
    label: "node_engine_config_unavailable",
    status: "unavailable",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    diagnosticCode: "node_engine_config_unavailable",
    assertNextAction(nextAction) {
      assertConfigureNextAction(nextAction, "node_engine_config_unavailable");
    }
  },
  {
    label: "node_engine_route_unratified",
    status: "unavailable",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    diagnosticCode: "node_engine_route_unratified",
    assertNextAction(nextAction) {
      assertConfigureNextAction(nextAction, "node_engine_route_unratified");
    }
  },
  {
    label: "node_engine_request_contract_unbound",
    status: "unavailable",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    diagnosticCode: "node_engine_request_contract_unbound",
    assertNextAction(nextAction) {
      assertConfigureNextAction(nextAction, "node_engine_request_contract_unbound");
    }
  },

  {
    label: "node_engine_auth_rejected",
    status: "undetermined",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    diagnosticCode: "node_engine_auth_rejected",
    assertNextAction(nextAction) {
      assert.match(nextAction, /re-?bind/i, "node_engine_auth_rejected next_action must instruct rebinding the credential");
      assert.ok(
        nextAction.includes("NODE_ENGINE_API_KEY"),
        "node_engine_auth_rejected next_action must name NODE_ENGINE_API_KEY to rebind"
      );

      assert.doesNotMatch(
        nextAction,
        /configure/i,
        "node_engine_auth_rejected next_action must not reuse the not-configured remediation"
      );
      assert.doesNotMatch(
        nextAction,
        /entitlement/i,
        "node_engine_auth_rejected next_action must stay distinct from the entitlement remediation"
      );
    }
  },
  {
    label: "node_engine_entitlement_rejected",
    status: "undetermined",
    decisionCode: NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    diagnosticCode: "node_engine_entitlement_rejected",
    assertNextAction(nextAction) {
      assert.match(
        nextAction,
        /entitlement/i,
        "node_engine_entitlement_rejected next_action must reference the worker-admission entitlement"
      );
      assert.match(nextAction, /plan/i, "node_engine_entitlement_rejected next_action must point at the plan/entitlement");

      assert.doesNotMatch(
        nextAction,
        /re-?bind/i,
        "node_engine_entitlement_rejected next_action must not reuse the rebind-credential remediation"
      );
    }
  }
]);

const FORBIDDEN_FREE_LOCAL_PAID_TOOL_SUBSTRINGS = Object.freeze([
  "workspace_code_index_",
  "workspace_work_record_refresh_target_resolution_evidence",
  "workspace_record_graph_impact_evidence"
]);

export const FREE_LOCAL_GENERIC_STRUCTURAL_DEFAULT = "Resolve structural dispatch-readiness issues reported in reasons";

export function syntheticFreeLocalStructuralReadiness(decisionCode) {
  return {
    record_id: "WK-9970",
    unit: "WK-9970#SLICE-001",
    dispatch_role: "implementation",
    dispatchable: false,
    decision_code: decisionCode,
    reasons: [`structural dispatch-readiness gate (${decisionCode})`],
    clusters: []
  };
}

export function assertNamesNoPaidTool(nextAction, label) {
  for (const forbidden of FORBIDDEN_FREE_LOCAL_PAID_TOOL_SUBSTRINGS) {
    assert.equal(
      nextAction.includes(forbidden),
      false,
      `${label} free-local next_action must not name the paid MCP tool "${forbidden}"`
    );
  }
}
