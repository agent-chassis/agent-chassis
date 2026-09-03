import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { runValidateDispatch } from "../../packages/wiki-cli/src/commands/validate-dispatch.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-dispatch-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function captureConsoleLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  return fn()
    .then(() => lines.join("\n"))
    .finally(() => {
      console.log = originalLog;
    });
}

const NODE_ENGINE_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_SERVICE_URL",
  "NODE_ENGINE_API_URL",
  "NODE_ENGINE_API_BASE_URL",
  "NODE_ENGINE_API_KEY",
  "NODE_ENGINE_LICENSE_KEY",
  "NODE_ENGINE_WORKER_ADMISSION_ROUTE",
  "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST",
  "NODE_ENGINE_REQUEST_CONTRACT_DIGEST"
]);

async function withClearedNodeEngineEnv(fn) {
  const saved = new Map();
  for (const key of NODE_ENGINE_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of NODE_ENGINE_ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
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

test("validate-dispatch CLI exposes --node-engine-admissibility and forwarding changes output", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildAdmissionGateRecord("WK-9970", [
      "packages/wiki-core/src/lib/admission-gate-clean.mjs"
    ]);
    await installAdmissionGateRecord(tempDir, record);

    await withClearedNodeEngineEnv(async () => {

      const structuralOutput = await captureConsoleLog(() =>
        runValidateDispatch(["strict", "--unit", "WK-9970", "--dir", tempDir, "--json"])
      );
      const structural = JSON.parse(structuralOutput);
      assert.equal(structural.dispatchable, true);
      assert.equal(structural.decision_code, "dispatchable");
      assert.equal(structural.admissibility, undefined);

      const admissibilityOutput = await captureConsoleLog(() =>
        runValidateDispatch([
          "strict",
          "--unit",
          "WK-9970",
          "--dir",
          tempDir,
          "--json",
          "--node-engine-admissibility"
        ])
      );
      const flagged = JSON.parse(admissibilityOutput);
      assert.equal(flagged.dispatchable, false);
      assert.equal(flagged.decision_code, "node_engine_admissibility_unavailable");
      assert.equal(flagged.structural_readiness.dispatchable, true);
      assert.equal(flagged.structural_readiness.decision_code, "dispatchable");
      assert.equal(flagged.admissibility.evaluated, true);
      assert.equal(flagged.admissibility.authority, "node_engine");
      assert.equal(flagged.admissibility.status, "unavailable");
      assert.equal(flagged.admissibility.admissible, false);
      assert.equal(flagged.admissibility.effect, null);
      assert.equal(flagged.admissibility.pack_backed, false);
      assert.equal(flagged.admissibility.node_engine_backed, false);
      assert.equal(flagged.admissibility.authenticated_request_sent, false);
    });
  });
});

test("validate-dispatch CLI --node-engine-admissibility fails closed without launcher authority", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildAdmissionGateRecord("WK-9970", [
      "packages/wiki-core/src/lib/admission-gate-clean.mjs"
    ]);
    await installAdmissionGateRecord(tempDir, record);

    await withClearedNodeEngineEnv(async () => {
      const output = await captureConsoleLog(() =>
        runValidateDispatch([
          "strict",
          "--unit",
          "WK-9970",
          "--dir",
          tempDir,
          "--json",
          "--node-engine-admissibility"
        ])
      );
      const result = JSON.parse(output);
      assert.equal(result.dispatchable, false);
      assert.equal(result.decision_code, "node_engine_admissibility_unavailable");
      assert.equal(result.admissibility.status, "unavailable");
      assert.equal(result.admissibility.diagnostic_code, "node_engine_config_unavailable");
      assert.equal(result.admissibility.authority, "node_engine");
      assert.equal(result.admissibility.admissible, false);
      assert.equal(result.admissibility.pack_backed, false);
      assert.equal(result.admissibility.node_engine_backed, false);
      assert.equal(result.structural_readiness.dispatchable, true);
      assert.equal(result.structural_readiness.decision_code, "dispatchable");
    });
  });
});
