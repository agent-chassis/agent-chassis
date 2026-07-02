import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { validateWorkRecordDispatch } from "../packages/wiki-core/src/index.mjs";
import { NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE } from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-pack-input-gate-"));
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

function packBackedEnvelope(decision) {
  return {
    pack_result: {
      pack: "worker_admission_v1",
      operation: "evaluate_work_unit_dispatch",
      decision,
      reasons: []
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

function buildSelectedUnitRecord(id) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Pack input gate fixture tracker",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-06-18",
    updated: "2026-06-18",
    initiative: "IN-0013",
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages/wiki-core/src/lib/pack-input-gate-fixture.mjs"],
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
      criteria: ["Selected slice is structurally dispatchable before Node Engine admissibility."],
      validation: ["node --test tests/work-record-dispatch-node-engine-pack-input-gate.test.mjs"]
    },
    sections: {
      summary: "Tracker fixture for selected-unit packInput assembly no-request gate.",
      why_it_matters: "The pack client must not receive a fabricated request after assembly failure.",
      scope: { items: ["selected slice"], out_of_scope: ["remote enforcement"] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [
      {
        id: "pack-input-assembly-fails",
        title: "Selected slice with packInput assembly failure",
        work_kind: "implementation",
        status: "active",
        read_scope: ["AGENTS.md"],
        repo_paths: ["packages/wiki-core/src/lib/pack-input-gate-fixture.mjs"],
        write_scope: ["packages/wiki-core/src/lib/pack-input-gate-fixture.mjs"],
        depends_on: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: {
          criteria: ["Selected slice remains structurally dispatchable."],
          validation: ["node --test tests/work-record-dispatch-node-engine-pack-input-gate.test.mjs"]
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

async function installWorkRecord(tempDir, record) {
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function assertNoFabricatedCarrierWasSent(fetchCalls) {
  for (const call of fetchCalls) {
    let body = null;
    try {
      body = JSON.parse(String(call?.init?.body ?? ""));
    } catch {
      body = null;
    }
    const bodyKeys = body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body).sort()
      : [];
    assert.notDeepEqual(
      bodyKeys,
      ["data", "pack", "pack_input"],
      "validate-dispatch must not send a fabricated {data, pack, pack_input} carrier after packInput assembly failed"
    );
  }
}

function assertNoSecretOrRawPayloadLeak(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "node-engine.invalid",
    "secret-base-7f3a",
    "https://",
    "http://",
    "x-api-key",
    "Authorization",
    "ne-secret-key-abcdef-9876",
    "contractdigestvalue0001",
    "ne-authority-binding-secret-2026",
    "sha256:",
    "policy_profile",
    "org_policy_profile",
    "LEAKY_PROBLEM_DETAIL",
    "raw_request_body",
    "raw_response_body"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must not surface ${forbidden}`);
  }
}

for (const assemblyCase of [
  {
    name: "packInput assembly throws",
    packInputAssembler: async () => {
      throw new Error("LEAKY_PROBLEM_DETAIL: raw packInput assembly failure");
    }
  },
  {
    name: "packInput assembly returns null",
    packInputAssembler: async () => null
  }
]) {
  test(`validate-dispatch fails closed locally with no request when selected-unit ${assemblyCase.name}`, async () => {
    await withTempRepo(async (tempDir) => {
      const record = buildSelectedUnitRecord("WK-9972");
      await installWorkRecord(tempDir, record);

      const fetchImpl = countingFetch(makeNodeEnginePackResponse(200, packBackedEnvelope("admit")));
      const result = await validateWorkRecordDispatch({
        dir: tempDir,
        unitAddress: "WK-9972#pack-input-assembly-fails",

        graph_state: { graph_available: false },
        node_engine_admissibility: {
          env: completeNodeEngineEnv(),
          fetchImpl,
          packInputAssembler: assemblyCase.packInputAssembler
        }
      });

      assertNoFabricatedCarrierWasSent(fetchImpl.calls);
      assert.equal(fetchImpl.calls.length, 0, "packInput assembly failure must fail closed before any remote request");

      assert.equal(result.structural_readiness?.dispatchable, true);
      assert.equal(result.dispatchable, false);
      assert.equal(result.decision_code, NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE);
      assert.equal(result.admissibility?.status, "unavailable");
      assert.equal(result.admissibility?.admissible, false);
      assert.equal(result.admissibility?.pack_backed, false);
      assert.equal(result.admissibility?.node_engine_backed, false);
      assert.match(
        String(result.admissibility?.diagnostic_code ?? ""),
        /^node_engine_pack_input_(missing|assembly_failed)$/,
        "diagnostic must be a bounded local pack-input missing/assembly-failed token"
      );
      assert.equal(
        result.admissibility?.authenticated_request_sent ?? false,
        false,
        "diagnostic must make clear that no authenticated request was sent"
      );
      assertNoSecretOrRawPayloadLeak(result);
    });
  });
}
