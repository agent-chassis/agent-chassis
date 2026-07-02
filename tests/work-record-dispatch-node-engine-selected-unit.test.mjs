import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { validateWorkRecordDispatch } from "../packages/wiki-core/src/index.mjs";
import {
  NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";

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

function createValidOrgPolicyProfileParameterValues() {
  return {
    "write_scope_count.review_threshold": 1,
    "write_scope_count.deny_threshold": 4,
    "write_scope_count.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "write_scope_total_loc.review_threshold": 200,
    "write_scope_total_loc.deny_threshold": 1200,
    "write_scope_total_loc.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "max_write_file_loc.review_threshold": 600,
    "max_write_file_loc.deny_threshold": 1200,
    "max_write_file_loc.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "acceptance_criteria_count.review_threshold": 10,
    "acceptance_criteria_count.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "validation_command_count.review_threshold": 2,
    "validation_command_count.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "expected_changed_line_budget.review_threshold": 200,
    "expected_changed_line_budget.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "declared_runtime_mode_count.review_threshold": 1,
    "declared_runtime_mode_count.waiver_allowability": ["reviewer_attestation", "accepted_authority"],
    "artifact_kind_count.review_threshold": 1,
    "artifact_kind_count.waiver_allowability": ["reviewer_attestation", "accepted_authority"]
  };
}

function assertPackInputShapeCarriesPolicyProfileProjection(packInput) {
  const requiredKeys = [
    "authority_mode",
    "effect_vocabulary_version",
    "policy_profile",
    "policy_profile_authority_mode",
    "policy_profile_digest",
    "policy_profile_id",
    "policy_profile_version",
    "request_contract_digest",
    "schema_version",
    "threshold_profile_id",
    "threshold_profile_version"
  ];
  for (const key of requiredKeys) {
    assert.equal(Object.prototype.hasOwnProperty.call(packInput, key), true, `pack_input must carry ${key}`);
  }
  for (const key of Object.keys(packInput)) {
    assert.equal(
      requiredKeys.includes(key),
      true,
      `unexpected pack_input key ${key}`
    );
  }
  assert.equal(typeof packInput.policy_profile, "object");
  assert.equal(Array.isArray(packInput.policy_profile), false);
  assert.equal(typeof packInput.policy_profile_digest, "string");
  assert.notEqual(packInput.policy_profile_digest.trim(), "");
  assert.equal(packInput.policy_profile_authority_mode, "entitlement");
}

async function installAdmissionGateRecord(tempDir, record) {
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function installOrgPolicyProfile(tempDir) {
  const profilePath = path.join(tempDir, ".agent-launch", "org-policy-profile.json");
  const profile = {
    parameter_values: createValidOrgPolicyProfileParameterValues()
  };
  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
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

function createDashboardWidgetAdjacency(paths) {
  return paths.slice(1).map((pathValue, index) => [paths[index], pathValue]);
}

test("a selected dashboard slice sends two-fact metrics and bounded policy profile to Node Engine", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildBroadSliceAdmissionRecord("WK-9971");
    await installAdmissionGateRecord(tempDir, record);
    await installOrgPolicyProfile(tempDir);

    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return makeNodeEnginePackResponse(
        200,
        packBackedEnvelope("reject", [
          {
            code: "blast_radius_critical",
            field: "blast_radius_severity",
            observed: "critical"
          }
        ])
      );
    };

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-9971#too-broad-admission-fixture",

      graph_import_adjacency: createDashboardWidgetAdjacency(record.slices[0].write_scope),
      node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
    });

    assert.equal(requests.length, 1);
    const outboundBody = JSON.parse(requests[0].init.body);

    assert.deepEqual(Object.keys(outboundBody).sort(), ["data", "pack", "pack_input"]);
    assert.deepEqual(Object.keys(outboundBody.data).sort(), ["claim", "decision_kind", "schema_version", "source_digest", "subject", "work_unit_metrics"]);
    assertPackInputShapeCarriesPolicyProfileProjection(outboundBody.pack_input);
    assert.equal(outboundBody.data.subject.unit.record_id, "WK-9971");
    assert.equal(outboundBody.data.subject.unit.slice_id, "too-broad-admission-fixture");
    assert.equal(outboundBody.data.subject.unit.address, "WK-9971#too-broad-admission-fixture");
    assert.equal(outboundBody.data.claim, null);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "feature_vector"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "artifact_refs"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "preparation_audit_refs"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "structural_target_metrics"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(outboundBody.data, "policy_profile"), false);
    const workUnitMetrics = outboundBody.data.work_unit_metrics;
    assert.deepEqual(Object.keys(workUnitMetrics).sort(), [
      "acceptance_criteria_count",
      "blast_radius_severity",
      "cluster_count",
      "max_write_file_loc",
      "validation_command_count",
      "write_scope_count",
      "write_scope_total_loc"
    ]);
    assert.equal(Number.isInteger(workUnitMetrics.cluster_count), true);
    assert.match(workUnitMetrics.blast_radius_severity, /^(none|elevated|critical)$/);
    for (const legacyKey of [
      "write_scope_existing_file_count",
      "write_scope_directory_count",
      "repo_paths",
      "write_scope",
      "file_paths",
      "files",
      "surfaces",
      "surface_names"
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(workUnitMetrics, legacyKey),
        false,
        `data.work_unit_metrics must not carry legacy key ${legacyKey}`
      );
    }

    assert.equal(result.dispatchable, false);
    assert.equal(result.decision_code, NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE);
    assert.equal(result.structural_readiness.dispatchable, true);
    assert.equal(result.admissibility.status, "reject");
    assert.equal(result.admissibility.admissible, false);
    assert.equal(result.admissibility.effect, "reject");
    assert.equal(result.admissibility.pack_backed, true);
  });
});
