

import test from "node:test";

import assert from "node:assert/strict";

import { tmpdir } from "node:os";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  WORK_RECORD_DISPATCH_DECISION_CODES,
  computeWorkRecordSourceDigest,
  evaluateWorkRecordPolicy,
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "../packages/wiki-core/src/index.mjs";

import {
  validateWorkRecordDispatchById as validateWorkRecordDispatchCore,
  validateWorkRecordDispatchReadOnlyById,
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
  isBashWrapperPath
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";

import { joinSidecarPathsToCanonicalRecords } from "../packages/wiki-core/src/lib/sidecar-joins.mjs";

import { runValidateDispatch } from "../packages/wiki-cli/src/commands/validate-dispatch.mjs";

import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";

import { createCompactValidateDispatchResponse } from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-dispatch-"));
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

function unratifiedNodeEngineEnv(overrides = {}) {
  const env = completeNodeEngineEnv(overrides);
  delete env.NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING;
  return env;
}

async function installAdmissionGateRecord(tempDir, record) {
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function buildBroadSliceAdmissionRecord(id) {
  const broadWriteScope = Array.from(
    { length: 8 },
    (_unused, index) => `packages/wiki-core/src/lib/dashboard-widget-${index + 1}.mjs`
  );
  const tenValidationCommands = Array.from(
    { length: 10 },
    (_unused, index) => `npm test -- tests/dashboard-widget-${index + 1}.test.mjs`
  );
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Too-broad admission fixture tracker",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-06-07",
    updated: "2026-06-07",
    initiative: "IN-0013",
    area: "wiki-mcp",
    docs: ["docs/work-record-schema.md"],
    repo_paths: [...broadWriteScope],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "orchestrator",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Selected slice carries its own broad-scope admission facts."],
      validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
    },
    sections: {
      summary: "Tracker carrying a deliberately too-broad admission slice.",
      why_it_matters: "Node Engine must receive the slice's broad-scope facts.",
      scope: { items: ["selected slice"], out_of_scope: ["parent dispatch"] },
      tasks: [],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [
      {
        id: "too-broad-admission-fixture",
        title: "Deliberately too-broad admission slice",
        work_kind: "implementation",
        status: "active",
        docs: ["docs/work-record-schema.md"],
        repo_paths: [...broadWriteScope],
        write_scope: [...broadWriteScope],
        depends_on: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: {
          criteria: ["The over-broad slice dispatches structurally on its own."],
          validation: tenValidationCommands
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

test("a too-broad dashboard slice sends selected-unit broad-scope facts and is denied by Node Engine", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildBroadSliceAdmissionRecord("WK-9971");
    await installAdmissionGateRecord(tempDir, record);

    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return makeNodeEnginePackResponse(
        200,
        packBackedEnvelope("reject", [
          {
            code: "worker_admission.work_unit_atomicity.write_scope_count_denied.v1",
            field: "write_scope_count",
            observed: 8,
            threshold: 4
          }
        ])
      );
    };

    const result = await validateWorkRecordDispatchCore({
      dir: tempDir,
      unitAddress: "WK-9971#too-broad-admission-fixture",

      graph_state: { graph_available: false },
      node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
    });

    assert.equal(requests.length, 1);
    const outboundBody = JSON.parse(requests[0].init.body);

    assert.deepEqual(Object.keys(outboundBody).sort(), ["data", "pack", "pack_input"]);
    assert.deepEqual(Object.keys(outboundBody.data).sort(), ["claim", "decision_kind", "schema_version", "source_digest", "subject", "work_unit_metrics"]);
    assert.deepEqual(Object.keys(outboundBody.pack_input).sort(), [
      "authority_mode",
      "effect_vocabulary_version",
      "policy_profile_id",
      "policy_profile_version",
      "request_contract_digest",
      "schema_version",
      "threshold_profile_id",
      "threshold_profile_version"
    ]);
    assert.equal(outboundBody.data.subject.unit.record_id, "WK-9971");
    assert.equal(outboundBody.data.subject.unit.slice_id, "too-broad-admission-fixture");
    assert.equal(outboundBody.data.subject.unit.address, "WK-9971#too-broad-admission-fixture");
    assert.equal(outboundBody.data.claim, null);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "feature_vector"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "artifact_refs"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "preparation_audit_refs"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "structural_target_metrics"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "policy_profile"), false);

    assert.deepEqual(
      Object.keys(outboundBody.data.work_unit_metrics).sort(),
      [
        "acceptance_criteria_count",
        "blast_radius_severity",
        "cluster_count",
        "max_write_file_loc",
        "validation_command_count",
        "write_scope_count",
        "write_scope_test_count",
        "write_scope_total_loc"
      ]
    );
    assert.equal(typeof outboundBody.data.work_unit_metrics.cluster_count, "number");
    assert.equal(typeof outboundBody.data.work_unit_metrics.write_scope_count, "number");
    assert.equal(typeof outboundBody.data.work_unit_metrics.max_write_file_loc, "number");
    assert.equal(typeof outboundBody.data.work_unit_metrics.write_scope_total_loc, "number");
    assert.equal(typeof outboundBody.data.work_unit_metrics.validation_command_count, "number");
    assert.equal(typeof outboundBody.data.work_unit_metrics.acceptance_criteria_count, "number");
    assert.equal(
      Object.prototype.hasOwnProperty.call(outboundBody.data.work_unit_metrics, "write_scope_count"),
      true
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(outboundBody.data.work_unit_metrics, "validation_command_count"),
      true
    );

    assert.equal(result.dispatchable, false);
    assert.equal(result.decision_code, NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE);
    assert.equal(result.structural_readiness.dispatchable, true);
    assert.equal(result.admissibility.status, "reject");
    assert.equal(result.admissibility.admissible, false);
    assert.equal(result.admissibility.effect, "reject");
    assert.equal(result.admissibility.pack_backed, true);
  });
});

