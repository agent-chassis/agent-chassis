import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { validateWorkRecordDispatch } from "../packages/wiki-core/src/index.mjs";
import {
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import { createCompactValidateDispatchResponse } from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-mcp-diagnostics-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function makeNodeEnginePackResponse(status, body, { contentType = "application/json" } = {}) {
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

function packBackedEnvelope(decision, reasons = []) {
  return {
    pack_result: {
      pack: "worker_admission_v1",
      operation: "evaluate_work_unit_dispatch",
      decision,
      reasons
    }
  };
}

function countingFetch(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function completeNodeEngineEnv(overrides = {}) {
  return {
    NODE_ENGINE_SERVICE_URL: "https://node-engine.invalid/secret-base-7f3a",
    NODE_ENGINE_API_KEY: "ne-secret-key-abcdef-9876",
    NODE_ENGINE_WORKER_ADMISSION_ROUTE: "/v1/validate",
    NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST: "sha256:contractdigestvalue0001",
    NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING: "ne-authority-binding-secret-2026",
    ...overrides
  };
}

function buildAdmissionGateRecord(id, writeScope, overrides = {}) {
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

async function installAdmissionGateRecord(tempDir, record) {
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function verboseValidateDispatchEnvelope(workspaceRepo, readiness) {
  return { workspaceRepo, readiness };
}

const WORKSPACE_REPO = "agent-chassis";
const REQUEST_CONTRACT_DIGEST_ENV = "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST";

const BOUNDED_ADMISSIBILITY_KEYS = Object.freeze([
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

function leakyProblemBody(problemType, { status = 400 } = {}) {
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

const FORBIDDEN_SUBSTRINGS = Object.freeze([

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

const FORBIDDEN_PROBLEM_FIELD_NAMES = Object.freeze([
  "observed_request_schema_digest",
  "expected_request_schema_digest",
  "graph_node_count",
  "precondition_graph_size",
  "policy_profile",
  "detail"
]);

function assertNoSecretLeak(payload, label) {
  const serialized = JSON.stringify(payload);
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

const PROBLEM_CASES = Object.freeze([
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

async function driveProblemReadiness(tempDir, problemType) {
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

function syntheticUndeterminedReadiness(diagnosticCode) {
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

for (const problemCase of PROBLEM_CASES) {
  test(`workspace_validate_dispatch compact surfaces operator next_action for ${problemCase.label}`, async () => {
    await withTempRepo(async (tempDir) => {
      const readiness = await driveProblemReadiness(tempDir, problemCase.problemType);

      assert.equal(readiness.dispatchable, false);
      assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      assert.equal(readiness.structural_readiness.dispatchable, true);
      assert.equal(readiness.admissibility.status, "undetermined");
      assert.equal(readiness.admissibility.admissible, false);
      assert.equal(readiness.admissibility.binding_status, "node_engine_unratified_placeholder");
      assert.equal(readiness.admissibility.ratified, false);

      assert.equal(readiness.admissibility.diagnostic_code, problemCase.expectedDiagnosticCode);

      const compact = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);

      assert.equal(typeof compact.next_action, "string");
      problemCase.assertNextAction(compact.next_action);

      assert.equal(compact.admissibility.diagnostic_code, problemCase.expectedDiagnosticCode);
      assert.deepEqual(Object.keys(compact.admissibility).sort(), [...BOUNDED_ADMISSIBILITY_KEYS]);
      assert.equal(
        typeof compact.admissibility.authenticated_request_sent,
        "boolean",
        "authenticated_request_sent must remain bounded boolean metadata"
      );

      assertNoSecretLeak(compact, `compact ${problemCase.label}`);

      const verbose = verboseValidateDispatchEnvelope(WORKSPACE_REPO, readiness);
      assert.equal(verbose.readiness.admissibility.diagnostic_code, problemCase.expectedDiagnosticCode);
      assert.equal(verbose.readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      assertNoSecretLeak(verbose, `verbose ${problemCase.label}`);
    });
  });
}

test("worker-admission problem classes preserve DISTINCT bounded diagnostics under one shared decision_code", async () => {
  await withTempRepo(async (tempDir) => {
    const diagnostics = [];
    for (const problemCase of PROBLEM_CASES) {
      const readiness = await driveProblemReadiness(tempDir, problemCase.problemType);

      assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      diagnostics.push(readiness.admissibility.diagnostic_code);
    }

    assert.equal(new Set(diagnostics).size, PROBLEM_CASES.length, "each problem class must carry a distinct diagnostic_code");
  });
});

test("compact next_action is keyed from admissibility.diagnostic_code, not the shared decision_code", () => {
  const packInputRequired = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_required")
  );
  const packInputInvalid = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_invalid")
  );
  const digestMismatch = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  const graphTooLarge = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_precondition_graph_too_large")
  );
  const nonObjectData = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_non_object_data")
  );

  assert.equal(packInputRequired.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(packInputInvalid.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(digestMismatch.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(graphTooLarge.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(nonObjectData.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);

  const actions = new Set([
    packInputRequired.next_action,
    packInputInvalid.next_action,
    digestMismatch.next_action,
    graphTooLarge.next_action,
    nonObjectData.next_action
  ]);
  assert.equal(actions.size, 5, "distinct diagnostics under one decision_code must yield distinct next_action");

  assert.match(packInputRequired.next_action, /missing/i);
  assert.match(packInputRequired.next_action, /(carrier|profile|pack[ -]?input)/i);
  assert.match(packInputInvalid.next_action, /(present|malformed|digest[ -]?vector|schema|conformance[ -]?failed)/i);
  assert.notEqual(
    packInputRequired.next_action,
    packInputInvalid.next_action,
    "pack_input_required and pack_input_invalid must not share generic policy-profile/digest-vector remediation"
  );
  assert.ok(digestMismatch.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV));
  assert.match(graphTooLarge.next_action, /graph/i);
  assert.match(nonObjectData.next_action, /(malformed|non[ -]?object)/i);
  assert.match(nonObjectData.next_action, /data envelope/i);
});

test("compact next_action is deterministic for a given admissibility.diagnostic_code", () => {
  const first = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  const second = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  assert.equal(first.next_action, second.next_action);
});

test("generic invalid_request keeps a distinct fallback next_action (not a problem-specific remediation)", () => {
  const generic = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_invalid")
  );
  assert.equal(typeof generic.next_action, "string");
  assert.ok(generic.next_action.length > 0, "generic fallback next_action must be non-empty");

  assert.ok(
    !generic.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV),
    "generic fallback must not reference the request-contract digest rebind"
  );
  assert.doesNotMatch(generic.next_action, /policy[ -]?profile/i, "generic fallback must not reference policy-profile remediation");
  assert.doesNotMatch(generic.next_action, /dependency graph/i, "generic fallback must not reference dependency-graph remediation");

  const packInputRequired = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_required")
  );
  const packInputInvalid = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_invalid")
  );
  assert.notEqual(generic.next_action, packInputRequired.next_action);
  assert.notEqual(generic.next_action, packInputInvalid.next_action);
});

test("needs_review next_action surfaces the consolidated WK-1031#SLICE-087 review-required recovery", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildAdmissionGateRecord("WK-9970", [
      "packages/wiki-core/src/lib/admission-gate-clean.mjs"
    ]);
    await installAdmissionGateRecord(tempDir, record);

    const fetchImpl = countingFetch(makeNodeEnginePackResponse(200, packBackedEnvelope("needs_review")));
    const readiness = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-9970",
      node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
    });

    assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE);
    assert.equal(readiness.admissibility.status, "needs_review");
    assert.equal(readiness.admissibility.diagnostic_code, "node_engine_needs_review");

    const compact = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);

    assert.equal(typeof compact.next_action, "string");
    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      "needs_review next_action must not fall to the generic \"Resolve blocking issue\" default"
    );

    assert.match(
      compact.next_action,
      /(reduc|split|narrow)/i,
      "needs_review next_action must surface the reduce/split/narrow recovery actions"
    );
    assert.match(
      compact.next_action,
      /review[ -]?attestation/i,
      "needs_review next_action must surface the review-attestation recovery action"
    );

    assert.ok(
      compact.next_action.includes("WK-1031#SLICE-087"),
      "needs_review next_action must reference the WK-1031#SLICE-087 recovery surface"
    );
    assert.match(
      compact.next_action,
      /Review-required \(needs_review\) remediation contract/,
      "needs_review next_action must reference the dispatch-and-validation.md remediation contract"
    );

    assert.match(
      compact.next_action,
      /non-?launchable/i,
      "needs_review next_action must keep the result non-launchable"
    );
    assert.doesNotMatch(
      compact.next_action,
      /(admit locally|local[ -]?admit|fail[ -]?open)/i,
      "needs_review next_action must not imply local admit (no A4 fail-open)"
    );
    assert.doesNotMatch(
      compact.next_action,
      /(reviewer|redteam)/i,
      "needs_review next_action must be role-agnostic (DEC-0112, no reviewer-vs-redteam split)"
    );

    assert.ok(
      !compact.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV),
      "needs_review next_action must not borrow the request-contract digest remediation"
    );
    assert.doesNotMatch(compact.next_action, /policy[ -]?profile/i, "needs_review next_action must not borrow policy-profile remediation");
    assert.doesNotMatch(compact.next_action, /dependency graph/i, "needs_review next_action must not borrow dependency-graph remediation");
    assert.doesNotMatch(compact.next_action, /data envelope/i, "needs_review next_action must not borrow non-object-data remediation");
    assert.doesNotMatch(compact.next_action, /(malformed|digest[ -]?vector|conformance[ -]?failed)/i, "needs_review next_action must not borrow problem-class remediation");

    assertNoSecretLeak(compact, "compact needs_review");
  });
});

function packBackedEnvelopeWithoutReasons(decision) {
  const envelope = packBackedEnvelope(decision, []);
  delete envelope.pack_result.reasons;
  return envelope;
}

async function driveNeedsReviewReadiness(body) {
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

function assertNeedsReviewPublicOverlay(readiness) {
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

function assertNeedsReviewPublicResponse(readiness, classification) {
  assertNeedsReviewPublicOverlay(readiness);
  const compact = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);
  const verbose = verboseValidateDispatchEnvelope(WORKSPACE_REPO, readiness);

  assert.equal(compact.admissibility.status, "needs_review");
  assert.equal(compact.admissibility.diagnostic_code, "node_engine_needs_review");
  assert.ok(
    compact.admissibility.needs_review_recovery,
    "compact workspace_validate_dispatch must carry MCP-facing needs_review recovery guidance"
  );
  assert.equal(compact.admissibility.needs_review_recovery.classification, classification);
  assert.equal(
    verbose.readiness.admissibility.needs_review_recovery.classification,
    classification,
    "verbose workspace_validate_dispatch must carry the same needs_review recovery classification"
  );

  return { compact, verbose, recovery: compact.admissibility.needs_review_recovery };
}

function assertNoRawValueLeakAnywhere(publicResponses, forbiddenValues) {
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

test("WK-1309 MCP needs_review with missing or empty pack reasons projects no-reason recovery", async (t) => {
  const cases = [
    ["missing reasons array", packBackedEnvelopeWithoutReasons("needs_review")],
    ["empty reasons array", packBackedEnvelope("needs_review", [])]
  ];

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const readiness = await driveNeedsReviewReadiness(body);
      const { compact, verbose, recovery } = assertNeedsReviewPublicResponse(
        readiness,
        "needs_review_no_pack_reasons"
      );

      assert.equal(recovery.pack_reason_count, 0);
      assert.equal(recovery.recognized_reason_count, 0);
      assert.equal(recovery.unrecognized_reason_count, 0);
      assert.equal(recovery.dropped_reason_count, 0);
      assert.deepEqual(recovery.review_threshold_controls, []);
      assert.deepEqual(recovery.reason_facts, []);
      assert.match(
        recovery.reduce_split_narrow_actions.join(" "),
        /do not infer a review-threshold control locally/i
      );
      assert.match(recovery.review_attestation_actions.join(" "), /operator|Node Engine owner/i);
      assertNoSecretLeak(compact, `compact ${name} needs_review recovery`);
      assertNoSecretLeak(verbose, `verbose ${name} needs_review recovery`);
    });
  }
});

test("WK-1309 MCP needs_review with unrecognized reasons leaks no raw unknown values anywhere public", async () => {
  const rawUnknownCode = "operator_secret_policy.override_all";
  const rawUnknownField = "packages.wiki_core.src.secret_file";
  const rawUnknownObserved = "LEAKY_UNKNOWN_OBSERVED";
  const rawUnknownEvidenceKey = "raw_unknown_reason_evidence";
  const rawUnknownEvidenceValue = "LEAKY_UNKNOWN_REASON_EVIDENCE";
  const secondaryUnknownCode = "another_unrecognized_reason";
  const secondaryUnknownField = "another_unrecognized_field";

  const readiness = await driveNeedsReviewReadiness(
    packBackedEnvelope("needs_review", [
      {
        code: rawUnknownCode,
        field: rawUnknownField,
        observed: rawUnknownObserved,
        threshold: 99,
        evidence: { [rawUnknownEvidenceKey]: rawUnknownEvidenceValue }
      },
      { code: secondaryUnknownCode, field: secondaryUnknownField }
    ])
  );
  const { compact, verbose, recovery } = assertNeedsReviewPublicResponse(
    readiness,
    "needs_review_unrecognized_reasons"
  );

  assert.equal(recovery.pack_reason_count, 2);
  assert.equal(recovery.recognized_reason_count, 0);
  assert.equal(recovery.unrecognized_reason_count, 2);
  assert.equal(recovery.dropped_reason_count, 2);
  assert.deepEqual(recovery.review_threshold_controls, []);
  assert.deepEqual(recovery.reason_facts, []);
  assert.match(
    recovery.reduce_split_narrow_actions.join(" "),
    /closed vocabulary|do not echo or act on the raw unknown reason values/i
  );

  assertNoRawValueLeakAnywhere(
    { compact, verbose },
    [
      rawUnknownCode,
      rawUnknownField,
      rawUnknownObserved,
      rawUnknownEvidenceKey,
      rawUnknownEvidenceValue,
      secondaryUnknownCode,
      secondaryUnknownField
    ]
  );
  assertNoSecretLeak(compact, "compact unrecognized needs_review recovery");
  assertNoSecretLeak(verbose, "verbose unrecognized needs_review recovery");
});

test("WK-1309 MCP needs_review budget and target-plan recovery guidance are both independently visible", async () => {
  const rawUnknownCode = "operator_secret_policy.override_all";
  const rawUnknownField = "unknown_control";
  const rawUnknownObserved = "LEAKY_UNKNOWN_OBSERVED";
  const budgetEvidenceValue = "LEAKY_BUDGET_EVIDENCE";
  const targetEvidenceValue = "LEAKY_TARGET_PLAN_EVIDENCE";

  const readiness = await driveNeedsReviewReadiness(
    packBackedEnvelope("needs_review", [
      {
        code: "review_threshold_exceeded",
        field: "expected_changed_line_budget",
        observed: null,
        threshold: 200,
        evidence: { selected_unit_budget: budgetEvidenceValue }
      },
      {
        code: "review_threshold_exceeded",
        field: "expected_edit_targets",
        observed: 0,
        threshold: 1,
        evidence: { target_resolution: targetEvidenceValue }
      },
      {
        code: rawUnknownCode,
        field: rawUnknownField,
        observed: rawUnknownObserved
      }
    ])
  );
  const { compact, verbose, recovery } = assertNeedsReviewPublicResponse(
    readiness,
    "review_threshold_exceeded"
  );

  assert.equal(recovery.taxonomy_code, "worker_admission_review_threshold_exceeded");
  assert.equal(recovery.pack_reason_count, 3);
  assert.equal(recovery.recognized_reason_count, 2);
  assert.equal(recovery.unrecognized_reason_count, 1);
  assert.equal(recovery.dropped_reason_count, 1);
  assert.deepEqual(
    [...recovery.review_threshold_controls].sort(),
    ["expected_changed_line_budget", "expected_edit_targets"]
  );
  assert.ok(
    recovery.reason_facts.some((fact) => fact.control === "expected_changed_line_budget"),
    "bounded-budget guidance must include expected_changed_line_budget as its own repair target"
  );
  assert.ok(
    recovery.reason_facts.some((fact) => fact.control === "expected_edit_targets"),
    "target-plan guidance must include expected_edit_targets as its own repair target"
  );

  const reduceSplitNarrow = recovery.reduce_split_narrow_actions.join(" ");
  const structuredRepairs = recovery.structured_wk_repair_actions.join(" ");
  assert.match(reduceSplitNarrow, /expected_changed_line_budget/);
  assert.match(reduceSplitNarrow, /expected_edit_targets/);
  assert.match(structuredRepairs, /expected_changed_line_budget/);
  assert.match(structuredRepairs, /expected_edit_targets/);
  assert.match(recovery.review_attestation_actions.join(" "), /record accepted review-attestation evidence/i);
  assert.notDeepEqual(
    recovery.next_actions,
    recovery.review_attestation_actions,
    "budget and target-plan guidance must not collapse to only review-attestation actions"
  );

  assertNoRawValueLeakAnywhere(
    { compact, verbose },
    [
      rawUnknownCode,
      rawUnknownField,
      rawUnknownObserved,
      budgetEvidenceValue,
      targetEvidenceValue
    ]
  );
  assertNoSecretLeak(compact, "compact mixed needs_review recovery");
  assertNoSecretLeak(verbose, "verbose mixed needs_review recovery");
});

const GENERIC_DEFAULT_NEXT_ACTION_PATTERN = /Resolve blocking issue/i;

function syntheticFailClosedReadiness({ status, decisionCode, diagnosticCode }) {
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

const FAIL_CLOSED_CASES = Object.freeze([
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

for (const failCase of FAIL_CLOSED_CASES) {
  test(`workspace_validate_dispatch compact surfaces actionable next_action for ${failCase.label}`, () => {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );

    assert.equal(typeof compact.next_action, "string");
    assert.ok(compact.next_action.length > 0, `${failCase.label} next_action must be non-empty`);

    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      `${failCase.label} next_action must not fall to the generic "Resolve blocking issue" default`
    );
    failCase.assertNextAction(compact.next_action);

    assert.equal(compact.admissibility.diagnostic_code, failCase.diagnosticCode);
    assertNoSecretLeak(compact, `compact ${failCase.label}`);
  });
}

test("fail-closed admissibility dispositions each escape the generic default next_action", () => {
  for (const failCase of FAIL_CLOSED_CASES) {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );
    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      `${failCase.label} must surface specific guidance, not the generic default`
    );
  }
});

test("the three not-configured dispositions share one configure-NODE_ENGINE remediation; unratified/unavailable are distinct", () => {
  const byCode = new Map();
  for (const failCase of FAIL_CLOSED_CASES) {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );
    byCode.set(failCase.diagnosticCode, compact.next_action);
  }

  assert.equal(
    byCode.get("node_engine_config_unavailable"),
    byCode.get("node_engine_route_unratified")
  );
  assert.equal(
    byCode.get("node_engine_route_unratified"),
    byCode.get("node_engine_request_contract_unbound")
  );

  const unratified = byCode.get("node_engine_admit_unratified");
  const unavailable = byCode.get("node_engine_unavailable");
  const configure = byCode.get("node_engine_config_unavailable");
  assert.equal(new Set([unratified, unavailable, configure]).size, 3, "the three remediation themes must be distinct");
});

test("auth_rejected / entitlement_rejected each surface a remediation distinct from node_engine_unavailable and each other", () => {
  const nextActionFor = (status, decisionCode, diagnosticCode) =>
    createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness({ status, decisionCode, diagnosticCode })
    ).next_action;

  const authRejected = nextActionFor(
    "undetermined",
    NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    "node_engine_auth_rejected"
  );
  const entitlementRejected = nextActionFor(
    "undetermined",
    NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    "node_engine_entitlement_rejected"
  );
  const unavailable = nextActionFor(
    "unavailable",
    NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    "node_engine_unavailable"
  );

  for (const [label, action] of [
    ["auth_rejected", authRejected],
    ["entitlement_rejected", entitlementRejected],
    ["unavailable", unavailable]
  ]) {
    assert.doesNotMatch(action, GENERIC_DEFAULT_NEXT_ACTION_PATTERN, `${label} must escape the generic default`);
  }

  assert.equal(
    new Set([authRejected, entitlementRejected, unavailable]).size,
    3,
    "auth_rejected, entitlement_rejected, and node_engine_unavailable must be three distinct remediations"
  );

  assert.ok(authRejected.includes("NODE_ENGINE_API_KEY"), "auth_rejected must name the key to rebind");
  assert.match(authRejected, /re-?bind/i, "auth_rejected must instruct a rebind");
  assert.match(entitlementRejected, /entitlement/i, "entitlement_rejected must reference entitlement");
  assert.match(entitlementRejected, /plan/i, "entitlement_rejected must reference the plan");

  assertNoSecretLeak({ authRejected, entitlementRejected, unavailable }, "auth/entitlement remediations");
});

test("fail-closed next_action is deterministic for a given diagnostic_code", () => {
  const first = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFailClosedReadiness({
      status: "unratified",
      decisionCode: NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
      diagnosticCode: "node_engine_admit_unratified"
    })
  );
  const second = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFailClosedReadiness({
      status: "unratified",
      decisionCode: NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
      diagnosticCode: "node_engine_admit_unratified"
    })
  );
  assert.equal(first.next_action, second.next_action);
});
