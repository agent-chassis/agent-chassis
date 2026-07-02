

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  buildNodeEngineAdmissionRuntimeDiagnostic,
  NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";
import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const DIAGNOSTIC_TOOL_NAME = "workspace_node_engine_admission_runtime_diagnostic";

const SENTINEL_SERVICE_URL = "https://node-engine-fixture.example.test/private-base";
const SENTINEL_API_KEY = "node-engine-fixture-api-key-sentinel";
const SENTINEL_DIGEST = "sha256:fixture-digest-sentinel-0123456789abcdef";
const SENTINEL_ROUTE = "/v1/validate-fixture-route-sentinel";

const SENTINEL_AUTHORITY_BINDING = "fixture-authority-binding-sentinel-2026-06";

const UNRATIFIED_PLACEHOLDER = "node_engine_unratified_placeholder";

const ALL_PRESENT_ENV = Object.freeze({
  NODE_ENGINE_SERVICE_URL: SENTINEL_SERVICE_URL,
  NODE_ENGINE_API_KEY: SENTINEL_API_KEY,
  NODE_ENGINE_WORKER_ADMISSION_ROUTE: SENTINEL_ROUTE,
  NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST: SENTINEL_DIGEST
});

const ALL_FIVE_PRESENT_ENV = Object.freeze({
  ...ALL_PRESENT_ENV,
  NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING: SENTINEL_AUTHORITY_BINDING
});

function buildDiagnosticToolHandler() {
  const handlers = new Map();
  const registeredToolNames = new Set();
  registerDispatchTools({
    registerTool: (name, _def, handler) => {
      registeredToolNames.add(name);
      handlers.set(name, handler);
    },
    registeredToolNames,
    workspaceRepos: new Map(),
    z,
    jsonContent: (obj) => ({ structuredContent: obj }),
    errorContent: (error) => {
      throw error;
    },
    resolveWorkspaceRepo: (_repos, repo) => ({ repo: repo ?? "demo", dir: null }),
    dispatchBackend: null,
    dispatchSessionIdentity: "wk0816-diagnostic-test-session"
  });
  return { handlers, registeredToolNames };
}

test("all four config vars present (no authority binding) => sources by name, binding absent", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic(ALL_PRESENT_ENV);
  assert.equal(
    diagnostic.schema_version,
    NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION
  );
  assert.deepEqual(diagnostic.node_engine_config, {
    service_url_source: "NODE_ENGINE_SERVICE_URL",
    service_url_present: true,
    key_source: "NODE_ENGINE_API_KEY",
    key_present: true,
    worker_admission_route_source: "NODE_ENGINE_WORKER_ADMISSION_ROUTE",
    worker_admission_route_present: true,
    request_contract_digest_source: "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST",
    request_contract_digest_present: true,

    worker_admission_authority_binding_source: null,
    worker_admission_authority_binding_present: false
  });
});

test("WK-0823 all FIVE admission vars present => authority binding by name, present:true, no value", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic(ALL_FIVE_PRESENT_ENV);
  assert.deepEqual(diagnostic.node_engine_config, {
    service_url_source: "NODE_ENGINE_SERVICE_URL",
    service_url_present: true,
    key_source: "NODE_ENGINE_API_KEY",
    key_present: true,
    worker_admission_route_source: "NODE_ENGINE_WORKER_ADMISSION_ROUTE",
    worker_admission_route_present: true,
    request_contract_digest_source: "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST",
    request_contract_digest_present: true,
    worker_admission_authority_binding_source: "NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING",
    worker_admission_authority_binding_present: true
  });

  assert.ok(!JSON.stringify(diagnostic).includes(SENTINEL_AUTHORITY_BINDING));
});

test("missing admission vars => present:false / source:null (including authority binding)", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic({});
  assert.deepEqual(diagnostic.node_engine_config, {
    service_url_source: null,
    service_url_present: false,
    key_source: null,
    key_present: false,
    worker_admission_route_source: null,
    worker_admission_route_present: false,
    request_contract_digest_source: null,
    request_contract_digest_present: false,
    worker_admission_authority_binding_source: null,
    worker_admission_authority_binding_present: false
  });
});

test("WK-0823 authority binding set to the unratified placeholder is treated ABSENT", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic({
    ...ALL_PRESENT_ENV,
    NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING: UNRATIFIED_PLACEHOLDER
  });

  assert.equal(
    diagnostic.node_engine_config.worker_admission_authority_binding_present,
    false
  );

  assert.equal(diagnostic.node_engine_config.service_url_present, true);
  assert.equal(diagnostic.node_engine_config.request_contract_digest_present, true);
});

test("observability booleans are true when the current code path is loaded", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic({});
  assert.deepEqual(diagnostic.worker_admission_remote_observability, {
    backend_result_carries_remote_admission: true,
    dispatch_accept_envelope_supports_worker_admission: true
  });
});

test("forbidden-token scan: no service URL/key/digest/route/authority-binding VALUE is ever returned", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic(ALL_FIVE_PRESENT_ENV);
  const serialized = JSON.stringify(diagnostic);
  for (const sentinel of [
    SENTINEL_SERVICE_URL,
    SENTINEL_API_KEY,
    SENTINEL_DIGEST,
    SENTINEL_ROUTE,
    SENTINEL_AUTHORITY_BINDING
  ]) {
    assert.ok(
      !serialized.includes(sentinel),
      `diagnostic must not leak ${sentinel}`
    );
  }

  assert.ok(!/<redacted:\d+>/.test(serialized), "no redacted-length marker");
  assert.ok(!/bearer/i.test(serialized), "no bearer material");

  assert.ok(serialized.includes("NODE_ENGINE_SERVICE_URL"));
  assert.ok(serialized.includes("NODE_ENGINE_API_KEY"));
});

test("partial config => present flags track each var independently", () => {
  const diagnostic = buildNodeEngineAdmissionRuntimeDiagnostic({
    NODE_ENGINE_SERVICE_URL: SENTINEL_SERVICE_URL,
    NODE_ENGINE_API_KEY: SENTINEL_API_KEY
  });
  assert.equal(diagnostic.node_engine_config.service_url_present, true);
  assert.equal(diagnostic.node_engine_config.key_present, true);

  assert.equal(diagnostic.node_engine_config.worker_admission_route_present, false);
  assert.equal(diagnostic.node_engine_config.worker_admission_route_source, null);
  assert.equal(diagnostic.node_engine_config.request_contract_digest_present, false);
  assert.equal(diagnostic.node_engine_config.request_contract_digest_source, null);
});

test("MCP tool is registered and reads the server process.env, not caller args", async () => {
  const { handlers, registeredToolNames } = buildDiagnosticToolHandler();
  assert.ok(
    registeredToolNames.has(DIAGNOSTIC_TOOL_NAME),
    "diagnostic tool must be registered"
  );
  const handler = handlers.get(DIAGNOSTIC_TOOL_NAME);
  assert.ok(handler, "diagnostic tool handler must be captured");

  const restore = {};
  const keys = Object.keys(ALL_FIVE_PRESENT_ENV);
  for (const key of keys) {
    restore[key] = process.env[key];
    process.env[key] = ALL_FIVE_PRESENT_ENV[key];
  }
  try {

    const result = await handler({
      env: {
        NODE_ENGINE_SERVICE_URL: "",
        NODE_ENGINE_API_KEY: ""
      }
    });
    const diagnostic = result.structuredContent;
    assert.equal(
      diagnostic.schema_version,
      NODE_ENGINE_ADMISSION_RUNTIME_DIAGNOSTIC_SCHEMA_VERSION
    );
    assert.equal(diagnostic.node_engine_config.service_url_present, true);
    assert.equal(diagnostic.node_engine_config.service_url_source, "NODE_ENGINE_SERVICE_URL");
    assert.equal(diagnostic.node_engine_config.key_present, true);
    assert.equal(diagnostic.node_engine_config.request_contract_digest_present, true);
    assert.equal(diagnostic.node_engine_config.worker_admission_route_present, true);

    assert.equal(diagnostic.node_engine_config.worker_admission_authority_binding_present, true);
    assert.equal(
      diagnostic.node_engine_config.worker_admission_authority_binding_source,
      "NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING"
    );

    const serialized = JSON.stringify(diagnostic);
    for (const sentinel of [
      SENTINEL_SERVICE_URL,
      SENTINEL_API_KEY,
      SENTINEL_DIGEST,
      SENTINEL_ROUTE,
      SENTINEL_AUTHORITY_BINDING
    ]) {
      assert.ok(!serialized.includes(sentinel), `MCP envelope must not leak ${sentinel}`);
    }
  } finally {
    for (const key of keys) {
      if (restore[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = restore[key];
      }
    }
  }
});
