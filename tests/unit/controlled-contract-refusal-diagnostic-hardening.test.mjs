import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION,
  createControlledContractRefusal
} from "../../packages/wiki-core/src/operations/controlled-contract/refusal.mjs";
import {
  captureStructuredDiagnostic
} from "../../packages/wiki-core/src/lib/diagnostic-projection.mjs";
import { errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

function diagnostic(thrown) {
  return createControlledContractRefusal(thrown)
    .envelope.warning.payload.details.internal_exception;
}

test("ordinary controlled-contract diagnostics are lossless", () => {
  const message = `caller text /looks/hostile\nUnicode 🚀\t!?.,[]{} ${"x".repeat(8_000)}`;
  const projected = diagnostic(new Error(message));
  assert.equal(projected.summary, message);
  assert.equal(projected.summary_truncated, false);
  assert.deepEqual(projected.summary_redactions, []);
});

test("a path-shaped diagnostic remains exact", () => {
  const internalPath = "/srv/private/contracts/WK-2327.json";
  const error = new Error(`read ${internalPath} failed; /caller/looking/text remains`);
  const projected = diagnostic(error);
  assert.equal(projected.summary, error.message);
  assert.deepEqual(projected.summary_redactions, []);
});

test("a structured secret removes only the secret and preserves surrounding text", () => {
  const secret = "sk-live-abc123";
  const projected = diagnostic(captureStructuredDiagnostic(
    `authorization ${secret}\nfailed: punctuation!?`,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] }
  ));
  assert.equal(projected.summary,
    "authorization [redacted:secret_material]\nfailed: punctuation!?");
  assert.deepEqual(projected.summary_redactions, [
    { field: "controlled_contract.diagnostic.credential", reason: "secret_material" }
  ]);
  assert.equal(JSON.stringify(projected).includes(secret), false);
});

test("cause diagnostics obey the same exact-component rule", () => {
  const secret = "credential-value";
  const cause = captureStructuredDiagnostic(
    `inner ${secret} remained ordinary around it`,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] }
  );
  const projected = diagnostic(new Error("outer", { cause }));
  assert.equal(projected.cause_summary,
    "inner [redacted:secret_material] remained ordinary around it");
  assert.deepEqual(projected.cause_summary_redactions, [
    { field: "controlled_contract.diagnostic.credential", reason: "secret_material" }
  ]);
  assert.equal(projected.cause_summary_truncated, false);
});

test("throwing getters and hostile proxies cannot escape the refusal boundary", () => {
  for (const property of ["name", "message", "code", "cause", "details", "path", "secret"]) {
    const hostile = new Error("baseline");
    Object.defineProperty(hostile, property, {
      configurable: true,
      get() { throw new Error(`${property} getter exploded`); }
    });
    const refusal = createControlledContractRefusal(hostile);
    assert.equal(refusal.envelope.schema_version, "controlled-contract-mcp-refusal.v1");
    assert.equal(refusal.envelope.warning.payload.reason_code,
      "controlled_contract_operation_failed");
  }

  const proxy = new Proxy(new Error("proxied"), {
    get(target, key) {
      if (key === "constructor") return target.constructor;
      throw new Error(`trap on ${String(key)}`);
    }
  });
  assert.equal(createControlledContractRefusal(proxy).envelope.warning.payload.reason_code,
    "controlled_contract_operation_failed");
});

test("caller-controlled object stringification is never invoked", () => {
  const smuggler = {
    toString: () => "AWS_SECRET_ACCESS_KEY=hunter2 /home/user/.aws/credentials"
  };
  const projected = diagnostic(smuggler);
  assert.equal(projected.summary.includes("hunter2"), false);
  assert.equal(projected.summary.includes("AWS_SECRET"), false);
});

test("the internal diagnostic remains a closed non-authoritative projection", () => {
  const withStack = new Error("boom");
  withStack.serverConfig = { token: "sk-secret", root: "/srv/app" };
  const projected = diagnostic(withStack);
  assert.deepEqual(Object.keys(projected).sort(), [
    "caller_correctable", "cause_class", "cause_summary",
    "cause_summary_redactions", "cause_summary_truncated", "exception_class",
    "schema_version", "summary", "summary_redactions", "summary_truncated",
    "unexpected_internal_exception"
  ].sort());
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("sk-secret"), false);
  assert.equal(serialized.includes("at Object"), false);
  assert.equal(projected.caller_correctable, false);
  for (const forbidden of ["retry", "continuation", "replacement_call", "recovery", "policy"]) {
    assert.equal(forbidden in projected, false);
  }
});

test("cause traversal stays bounded to one level", () => {
  const third = new Error("third-secret");
  const second = new Error("second", { cause: third });
  const first = new Error("first", { cause: second });
  const projected = diagnostic(first);
  assert.equal(projected.summary, "first");
  assert.equal(projected.cause_summary, "second");
  assert.equal(JSON.stringify(projected).includes("third-secret"), false);
});

function typedRefusal(code, details) {
  return Object.assign(new Error(`refused: ${code}`), { code, details });
}

test("typed refusals retain every schema-valid detail path", () => {
  const error = typedRefusal("controlled_contract_nested", {
    pointers: ["/a/b", "/c"],
    carrier_operations: [{ path: "/abs/keep/me" }],
    replacement_call: { tool: "t", args: { repo_root: "/abs/kept" } },
    evaluation_input: { p: "/abs/kept" },
    server: "/abs/erased"
  });
  const refusal = createControlledContractRefusal(error);
  const details = refusal.envelope.warning.payload.details;
  assert.equal(refusal.envelope.warning.payload.reason_code, error.code);
  assert.equal(refusal.message, error.message);
  assert.deepEqual(details.carrier_operations, [{ path: "/abs/keep/me" }]);
  assert.deepEqual(details.replacement_call, { tool: "t", args: { repo_root: "/abs/kept" } });
  assert.deepEqual(details.evaluation_input, { p: "/abs/kept" });
  assert.deepEqual(details.pointers, ["/a/b", "/c"]);
  assert.equal(details.server, "/abs/erased");
});

test("the complete diagnostic reaches both MCP channels", () => {
  const message = `Reference failure 🚀\n${"0123456789".repeat(2_000)}`;
  const refusal = createControlledContractRefusal(new ReferenceError(message));
  const result = errorContent(refusal);
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, refusal.envelope);
  assert.deepEqual(JSON.parse(result.content[0].text), refusal.envelope);
  const projected = result.structuredContent.warning.payload.details.internal_exception;
  assert.equal(projected.schema_version,
    CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(projected.summary, message);
});
