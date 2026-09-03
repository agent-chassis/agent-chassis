import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { z } from "zod";

import {
  createDiagnosticSink,
  createStdioShutdownController,
  errorContent,
  getResponseSpillConfig,
  guardToolHandler,
  installProcessErrorGuards,
  jsonContent,
  normalizeMcpToolResult,
  persistControlledContractRefactorItemReference,
  readSpilledMcpContentReference,
  redactAbsolutePaths
} from "./mcp-response.mjs";
import {
  captureStructuredDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";
import {
  createWorkspaceRepoResolutionError
} from "./workspace-repo-resolution.mjs";
import { createRegisterTool } from "./register-tool.mjs";

const TWO_CHANNEL_INLINE_LIMIT = 8192;

function completeResultBytes(result) {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

function assertTwoChannelEquivalence(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
}

function assertWithinInlineLimit(result, limit = TWO_CHANNEL_INLINE_LIMIT) {
  const bytes = completeResultBytes(result);
  assert.ok(bytes <= limit, `complete result used ${bytes} bytes against a ${limit}-byte limit`);
}

async function withSpillEnv(callback, overrides = {}) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-two-channel-"));
  try {
    return await callback(
      {
        WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
        WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(TWO_CHANNEL_INLINE_LIMIT),
        ...overrides
      },
      stateDir
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

test("exports the shared response helpers", () => {
  assert.equal(typeof getResponseSpillConfig, "function");
  assert.equal(typeof readSpilledMcpContentReference, "function");
  assert.equal(typeof jsonContent, "function");
  assert.equal(typeof guardToolHandler, "function");
  assert.equal(typeof installProcessErrorGuards, "function");
  assert.equal(typeof errorContent, "function");
  assert.equal(typeof normalizeMcpToolResult, "function");
  assert.equal(typeof persistControlledContractRefactorItemReference, "function");
  assert.equal(typeof redactAbsolutePaths, "function");
  assert.equal(typeof createDiagnosticSink, "function");
  assert.equal(typeof createStdioShutdownController, "function");
});

test("refactor item persistence is plan-or-receipt scoped and range-readable", async () => {
  await withSpillEnv(async (env) => {
    const item = { kind: "proof_gap", detail: "g".repeat(20_000) };
    const reference = persistControlledContractRefactorItemReference({
      resourceKind: "plan", itemIdentity: "gap-1", item
    }, { env });
    assert.equal(reference.schema_version,
      "controlled-contract-refactor-item-reference.v1");
    assert.equal(reference.resource_kind, "plan");
    assert.equal(reference.item_identity, "gap-1");
    assert.equal(reference.content_reference.read_tool,
      "workspace_read_mcp_content_reference");
    const chunks = [];
    let offset = 0;
    do {
      const page = readSpilledMcpContentReference({
        ref_id: reference.content_reference.ref_id, offset,
        length: reference.content_reference.range.max_length
      }, { env });
      chunks.push(Buffer.from(page.data_base64, "base64"));
      offset = page.next_offset;
    } while (offset !== null);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), item);
  }, { WIKI_MCP_RESPONSE_REFERENCE_READ_MAX_BYTES: "1024" });
});

test("refactor item persistence rejects generic and malformed artifact requests", async () => {
  await withSpillEnv(async (env) => {
    for (const request of [
      { resourceKind: "artifact", itemIdentity: "item", item: {} },
      { resourceKind: "receipt", itemIdentity: "", item: {} },
      { resourceKind: "plan", itemIdentity: "item", item: undefined },
      { resourceKind: "plan", itemIdentity: "item", item: 1n }
    ]) {
      assert.throws(() => persistControlledContractRefactorItemReference(
        request, { env }), TypeError);
    }
  });
});

test("errorContent preserves an absolute path embedded in an Error message", () => {
  const internalPath = "/home/user/agent-chassis/wiki/work-records/WK-1160.json";
  const error = new Error(`Cannot open ${internalPath}: not found.`);
  error.path = internalPath;
  const result = errorContent(error);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.diagnostic, error.message);
  assert.deepEqual(result.structuredContent.diagnostic_redactions, []);
  assert.equal(result.structuredContent.code, "mcp_response.handler_exception.v1");
});

test("the compatibility path projector preserves its input", () => {
  const message = "open C:\\Users\\Alice\\file.txt and /srv/wiki/file.txt";
  assert.equal(redactAbsolutePaths(message), message);
});

test("hostile-looking non-sensitive text is preserved exactly", () => {
  const result = errorContent("denied at /var/lib/wiki/work-records/WK-1160.json, retry later");
  assert.equal(
    result.structuredContent.diagnostic,
    "denied at /var/lib/wiki/work-records/WK-1160.json, retry later"
  );
  assert.deepEqual(result.structuredContent.diagnostic_redactions, []);
});

test("an untyped failure reaches the client as a registered, non-anonymous refusal", () => {
  const result = errorContent(new Error("handler exploded"));
  const envelope = result.structuredContent;
  const refusal = envelope.refusal;

  assert.equal(refusal.schema_version, "public-mechanical-refusal.v1");
  assert.equal(refusal.code, "mcp_response.handler_exception.v1");
  assert.equal(envelope.code, refusal.code);

  const facts = Object.fromEntries(refusal.deciding_facts.map((f) => [f.field, f]));
  assert.equal(facts["mcp_response.handler_completed"].value, false);
  assert.equal(Object.hasOwn(facts, "mcp_response.thrown_diagnostic"), false);
  assert.equal(envelope.diagnostic, "handler exploded");
  assert.deepEqual(envelope.diagnostic_redactions, []);

  assert.equal(refusal.no_supported_route, true);
  assert.equal(refusal.recovery.state, "no_supported_route");

  assert.deepEqual(errorContent(new Error("handler exploded")).structuredContent, envelope);
});

test("a platform errno is reported as a platform fact, never as the public reason", () => {
  const platform = new Error("open failed");
  platform.code = "ENOENT";
  const refusal = errorContent(platform).structuredContent.refusal;
  const facts = Object.fromEntries(refusal.deciding_facts.map((f) => [f.field, f.value]));
  assert.equal(facts["mcp_response.platform_error"], true);
  assert.equal(refusal.code, "mcp_response.platform_failure.v1");
  assert.equal(JSON.stringify(refusal).includes("ENOENT"), false, "no errno reaches the carrier");
  assert.equal(Object.hasOwn(facts, "mcp_response.cause_identity"), false);
});

test("a nested cause with a vouched-for identity survives; an unvouched one does not", () => {
  const owned = new Error("wrapper");
  owned.cause = Object.assign(new Error("inner"), {
    code: "agent_launch.terminal_candidate.route_failure.v1"
  });
  const preserved = errorContent(owned).structuredContent.refusal;
  const preservedFacts = Object.fromEntries(preserved.deciding_facts.map((f) => [f.field, f.value]));
  assert.equal(
    preservedFacts["mcp_response.cause_identity"],
    "agent_launch.terminal_candidate.route_failure.v1"
  );

  const invented = new Error("wrapper");
  invented.cause = Object.assign(new Error("inner"), { code: "attacker.supplied.evil.v1" });
  const bounded = errorContent(invented).structuredContent.refusal;
  const boundedFacts = Object.fromEntries(bounded.deciding_facts.map((f) => [f.field, f.value]));
  assert.equal(Object.hasOwn(boundedFacts, "mcp_response.cause_identity"), false);
  assert.equal(JSON.stringify(bounded).includes("attacker.supplied"), false);
});

test("errorContent exposes a structured error.envelope through both channels verbatim", () => {
  const envelope = {
    code: "PATH_LEAK",
    category: "validation",
    severity: "medium",
    message: "Missing file /home/user/agent-chassis/wiki/work-records/WK-1160.json: not found.",
    structured: { detail: "kept verbatim" }
  };
  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, envelope);
  assertTwoChannelEquivalence(result);

  assert.equal(JSON.parse(result.content[0].text).message, envelope.message);
});

test("a live invalid-repo envelope remains exactly as its validation owner declared it", () => {
  const error = createWorkspaceRepoResolutionError(
    "Unknown workspace repo alias: invalid-repo",
    "agent-chassis",
    ["agent-chassis"]
  );
  const declared = structuredClone(error.envelope);
  const declaredBytes = JSON.stringify(error.envelope);
  const result = errorContent(error);
  const envelope = result.structuredContent;
  assert.deepEqual(envelope, declared);
  assert.equal(JSON.stringify(envelope), declaredBytes);
  assert.equal(Object.hasOwn(envelope, "code"), false);
  assert.equal(Object.hasOwn(envelope, "owning_boundary"), false);
  assert.equal(Object.hasOwn(envelope, "correction"), false);
  assert.equal(Object.hasOwn(envelope, "next_calls"), false);
  assertTwoChannelEquivalence(result);
});

test("operator recovery requires an authenticated external condition across the complete envelope", () => {
  const untrusted = Object.assign(new Error("ordinary modeled failure"), { code: "operator_recovery_needed" });
  assert.equal(errorContent(untrusted).structuredContent.code, "mcp_response.handler_exception.v1");

  const staleRefusal = {
    schema_version: "public-mechanical-refusal.v1",
    code: "operator_recovery_needed",
    owning_boundary: "owner.boundary",
    no_supported_route: false,
    next_calls: [{ tool: "owner_tool", arguments: { id: "owner-id" } }]
  };
  const declaredClaims = [
    {
      label: "top-level claim",
      envelope: {
        schema_version: "owner-error.v1",
        code: "operator_recovery_needed",
        owning_boundary: "owner.boundary",
        next_calls: staleRefusal.next_calls,
        refusal: { ...staleRefusal, code: "validation_failure" }
      }
    },
    {
      label: "nested claim",
      envelope: {
        schema_version: "owner-error.v1",
        code: "validation_failure",
        owning_boundary: "owner.boundary",
        next_calls: staleRefusal.next_calls,
        refusal: staleRefusal
      }
    },
    {
      label: "empty external condition",
      envelope: {
        code: "operator_recovery_needed",
        authenticated_external_condition: true,
        external_condition: "",
        refusal: staleRefusal
      }
    },
    {
      label: "overlong external condition",
      envelope: {
        code: "operator_recovery_needed",
        authenticated_external_condition: true,
        external_condition: "x".repeat(257),
        refusal: staleRefusal
      }
    }
  ];
  for (const { label, envelope: declared } of declaredClaims) {
    const projected = errorContent({ envelope: declared });
    const envelope = projected.structuredContent;
    assert.equal(envelope.code, "mcp_response.handler_exception.v1", label);
    assert.equal(envelope.refusal.code, envelope.code, label);
    assert.equal(envelope.owning_boundary, "wiki-mcp.mcp-response", label);
    assert.deepEqual(envelope.next_calls, [], label);
    assert.equal(envelope.no_supported_route, true, label);
    assert.equal(envelope.refusal.no_supported_route, true, label);
    assert.equal(envelope.refusal.recovery.state, "no_supported_route", label);
    const carried = envelope.refusal.carried.mechanical_classification;
    for (const field of ["code", "authority_limb", "cause", "actor_recovery", "owning_boundary"]) {
      assert.equal(envelope[field], carried[field], `${label}: ${field}`);
    }
    assert.deepEqual(envelope.next_calls, carried.detail.next_calls, label);
    assert.equal(JSON.stringify(envelope).includes("owner_tool"), false, label);
    assert.equal(JSON.stringify(envelope).includes("operator_recovery_needed"), false, label);
    assertTwoChannelEquivalence(projected);
  }

  const error = new Error("external supervisor condition");
  error.authenticated_external_condition = true;
  error.external_condition = "host_supervisor_revoked_runtime";
  const envelope = errorContent(error).structuredContent;
  assert.equal(envelope.code, "operator_recovery_needed");
  assert.equal(envelope.refusal.observed_facts["mcp_response.external_condition"], "host_supervisor_revoked_runtime");

  const declaredExternal = {
    schema_version: "owner-error.v1",
    code: "operator_recovery_needed",
    refusal: staleRefusal,
    authenticated_external_condition: true,
    external_condition: "host_supervisor_revoked_runtime"
  };
  const authenticated = errorContent({ envelope: declaredExternal });
  assert.equal(authenticated.structuredContent.code, "operator_recovery_needed");
  assert.equal(authenticated.structuredContent.refusal.code, "operator_recovery_needed");
  assert.equal(authenticated.structuredContent.owning_boundary, "external.authenticated-condition");
  assert.deepEqual(authenticated.structuredContent.next_calls, []);
  assert.equal(authenticated.structuredContent.authenticated_external_condition, true);
  assert.equal(authenticated.structuredContent.external_condition, declaredExternal.external_condition);
  assert.equal(
    authenticated.structuredContent.refusal.observed_facts["mcp_response.external_condition"],
    declaredExternal.external_condition
  );
  assertTwoChannelEquivalence(authenticated);
});

test("jsonContent returns an inline two-channel envelope for small payloads", () => {
  const data = { ok: true, items: [1, 2, 3] };
  const result = jsonContent(data);
  assert.deepEqual(result.structuredContent, data);
  assertTwoChannelEquivalence(result);
  assert.equal(result.isError, undefined);
  assertWithinInlineLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("getResponseSpillConfig honors environment overrides", () => {
  const config = getResponseSpillConfig({
    WIKI_MCP_RESPONSE_STATE_DIR: "/tmp/example-state",
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192"
  });
  assert.equal(config.inlineByteLimit, 8192);
  assert.equal(config.stateDir, path.resolve("/tmp/example-state"));
  assert.ok(config.previewByteLimit > 0);
  assert.ok(config.maxReferenceReadBytes > 0);
});

test("jsonContent spills oversized payloads to a file-backed reference and round-trips", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-spill-"));
  const previous = {
    WIKI_MCP_RESPONSE_STATE_DIR: process.env.WIKI_MCP_RESPONSE_STATE_DIR,
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT
  };
  process.env.WIKI_MCP_RESPONSE_STATE_DIR = tempDir;
  process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = "8192";
  try {
    const payload = { items: Array.from({ length: 4000 }, (_, index) => `item-${index}`) };
    const response = jsonContent(payload);

    assert.equal(response.structuredContent.response_spilled, true);
    assertTwoChannelEquivalence(response);
    assertWithinInlineLimit(response);
    const ref = response.structuredContent.content_reference;
    assert.ok(ref && typeof ref.ref_id === "string");

    const read = readSpilledMcpContentReference({ ref_id: ref.ref_id, offset: 0, length: 512 });
    assert.equal(read.schema_version, "wiki-mcp-content-reference-read.v1");
    assert.equal(read.ref_id, ref.ref_id);
    assert.equal(read.offset, 0);
    assert.ok(read.data_base64.length > 0);
    assert.ok(read.total_bytes > 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ranged-read unavailability is a typed fail-loud limb with no recovery claim", async () => {
  await withSpillEnv(async (env) => {
    let thrown;
    try {
      readSpilledMcpContentReference({
        ref_id: "missing-content-reference",
        offset: 0,
        length: 1
      }, { env });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof Error);
    const { refusal, ...typedLimb } = thrown.envelope;
    assert.deepEqual(typedLimb, {
      schema_version: "wiki-mcp-content-reference-read-refusal.v1",
      accepted: false,
      complete: false,
      recoverable: false,
      code: "mcp_response.content_reference_ranged_read_unavailable.v1",
      limb: "ranged_read",
      reason: "content_reference_not_found"
    });
    assert.equal(thrown.envelope.content_reference, undefined);
    assert.equal(thrown.envelope.next_action, undefined);

    assert.equal(refusal.code, "mcp_response.content_reference_ranged_read_unavailable.v1");
    const facts = Object.fromEntries(refusal.deciding_facts.map((f) => [f.field, f.value]));
    assert.equal(facts["content_reference.readable"], false);
    assert.equal(facts["content_reference.failed_step"], "content_reference_not_found");
    assert.equal(refusal.no_supported_route, true);
    assert.equal(refusal.recovery.state, "no_supported_route");
    assert.equal(Object.hasOwn(refusal, "next_calls"), false);
  });
});

test("tampered spill metadata fails through the same typed ranged-read owner", async () => {
  await withSpillEnv(async (env, stateDir) => {
    const response = jsonContent({ value: "tamper-matrix-".repeat(1000) }, { env });
    const reference = response.structuredContent.content_reference;
    const metadataPath = path.join(stateDir, `${reference.ref_id}.json.meta.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, `${JSON.stringify({ ...metadata, byte_count: metadata.byte_count + 1 })}\n`);

    assert.throws(
      () => readSpilledMcpContentReference({
        ref_id: reference.ref_id,
        offset: 0,
        length: 1
      }, { env }),
      (error) => {
        assert.equal(error.envelope?.code,
          "mcp_response.content_reference_ranged_read_unavailable.v1");
        assert.equal(error.envelope?.reason,
          "content_reference_metadata_byte_count_mismatch");
        assert.equal(error.envelope?.complete, false);
        assert.equal(error.envelope?.recoverable, false);
        return true;
      }
    );
  });
});

test("guardToolHandler passes a structured result through and wraps throws with redaction", async () => {
  const logs = [];
  const guarded = guardToolHandler(
    async (input) => {
      if (input === "boom") {
        throw new Error("Cannot open /home/user/wiki/work-records/WK-1160.json.");
      }
      return { content: [{ type: "text", text: "already structured" }], structuredContent: { ok: true } };
    },
    { name: "demo-tool", log: (entry) => logs.push(entry) }
  );

  const success = await guarded("ok");
  assert.deepEqual(success.structuredContent, { ok: true });
  assertTwoChannelEquivalence(success);
  assert.ok(!success.content[0].text.includes("already structured"));

  const failure = await guarded("boom");
  assert.equal(failure.isError, true);

  assert.equal(failure.structuredContent.code, "mcp_response.handler_exception.v1");
  assert.equal(failure.structuredContent.diagnostic,
    "Cannot open /home/user/wiki/work-records/WK-1160.json.");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].tool, "demo-tool");
  assert.equal(logs[0].level, "error");
});

test("a declared output schema preserves a sound owner result byte-for-byte", async () => {
  const ownerEnvelope = {
    accepted: false,
    carried: {
      exact_returned_policy: {
        verdict: "needs_review",
        reasons: ["owner reason"],
        remediation: { action: "owner_action", target: "WK-2428" },
        authority: { issuer: "cce", binding: "sha256:owner" },
        ratified: true,
        decision_id: "policy-decision-42"
      }
    },
    recovery: {
      state: "callable",
      operation: "workspace_owner_action",
      arguments: { id: "WK-2428" }
    }
  };
  const result = {
    content: [{ type: "text", text: JSON.stringify(ownerEnvelope) }],
    structuredContent: ownerEnvelope,
    _meta: { owner: "unchanged" }
  };
  const guarded = guardToolHandler(async () => result, {
    name: "workspace_owner_operation",
    outputSchema: z.object({
      accepted: z.boolean(),
      carried: z.object({}).passthrough(),
      recovery: z.object({}).passthrough()
    }).passthrough()
  });

  const projected = await guarded();
  assert.strictEqual(projected, result);
  assert.equal(JSON.stringify(projected), JSON.stringify(result));
  assert.deepEqual(projected.structuredContent.carried.exact_returned_policy,
    ownerEnvelope.carried.exact_returned_policy);
  assert.deepEqual(projected.structuredContent.recovery, ownerEnvelope.recovery);
});

test("a declared output schema rejects absent, non-JSON, and schema-invalid structured content", async () => {
  const outputSchema = { accepted: z.boolean() };
  const cases = [
    {
      label: "absent",
      result: { content: [{ type: "text", text: "owner text" }] },
      invariant: "outputSchema requires structuredContent"
    },
    {
      label: "non-JSON",
      result: {
        content: [{ type: "text", text: "owner text" }],
        structuredContent: { accepted: true, evidence: 1n }
      },
      invariant: "structuredContent must be JSON"
    },
    {
      label: "schema-invalid",
      result: {
        content: [{ type: "text", text: JSON.stringify({ accepted: "yes" }) }],
        structuredContent: { accepted: "yes" }
      },
      invariant: "structuredContent must satisfy outputSchema"
    }
  ];

  for (const fixture of cases) {
    const projected = await guardToolHandler(async () => fixture.result, {
      name: "workspace_required_output",
      outputSchema
    })();
    assert.equal(projected.isError, true, fixture.label);
    assert.deepEqual(projected.structuredContent, {
      code: "mechanical_failure",
      authority_limb: "mechanical_failure",
      operation: "workspace_required_output",
      broken_invariant: fixture.invariant
    }, fixture.label);
    assertTwoChannelEquivalence(projected);
    assert.equal(Object.hasOwn(projected.structuredContent, "recovery"), false, fixture.label);
    assert.equal(Object.hasOwn(projected.structuredContent, "no_supported_route"), false,
      fixture.label);
  }
});

test("an undeclared structured envelope is optional and creates no inferred refusal", async () => {
  const contentOnly = { content: [{ type: "text", text: "owner result" }] };
  const missingPolicy = {
    content: [{ type: "text", text: JSON.stringify({ accepted: true }) }],
    structuredContent: { accepted: true }
  };

  assert.strictEqual(await guardToolHandler(async () => contentOnly, {
    name: "workspace_optional_output"
  })(), contentOnly);
  assert.strictEqual(await guardToolHandler(async () => missingPolicy, {
    name: "workspace_optional_output"
  })(), missingPolicy);
  assert.equal(JSON.stringify(contentOnly).includes("mechanical_failure"), false);
  assert.equal(JSON.stringify(missingPolicy).includes("no_supported_route"), false);
});

test("registerTool transports its outputSchema declaration into the response guard", async () => {
  const registered = [];
  const outputSchema = { accepted: z.boolean() };
  const registerTool = createRegisterTool({
    server: {
      registerTool(name, config, handler) {
        registered.push({ name, config, handler });
      }
    },
    toolProfile: "operator",
    registeredTier: "paid_cce",
    mcpToolTierRegistrationPolicy: {
      descriptorLoaded: true,
      descriptorToolNames: new Set(["workspace_required_output"]),
      registrationEligibleToolNames: new Set(["workspace_required_output"]),
      freeLocalToolNames: new Set(["workspace_required_output"]),
      freeLocalFallbackToolNames: null
    },
    toolUsageAuditBoundary: { wrapHandler(_name, handler) { return handler; } },
    registeredToolNames: new Set(),
    structuredLog() {}
  });

  registerTool("workspace_required_output", {
    description: "Return a required structured owner result.",
    outputSchema
  }, async () => ({ content: [{ type: "text", text: "missing" }] }));

  assert.equal(registered.length, 1);
  assert.strictEqual(registered[0].config.outputSchema, outputSchema);
  const projected = await registered[0].handler({});
  assert.equal(projected.structuredContent.code, "mechanical_failure");
  assert.equal(projected.structuredContent.operation, "workspace_required_output");
  assert.equal(projected.structuredContent.broken_invariant,
    "outputSchema requires structuredContent");
});

test("installProcessErrorGuards reports process-level errors through the structured logger", () => {
  const processLike = new EventEmitter();
  const logs = [];
  const result = installProcessErrorGuards({ processLike, log: (entry) => logs.push(entry) });
  assert.equal(result.installed, true);

  processLike.emit("unhandledRejection", new Error("boom"));
  processLike.emit("uncaughtException", new Error("kapow"), "uncaughtException");

  assert.equal(logs.length, 2);
  assert.equal(logs[0].event, "unhandledRejection");
  assert.equal(logs[1].event, "uncaughtException");

  const again = installProcessErrorGuards({ processLike, log: () => {} });
  assert.equal(again.installed, false);
});

test("the public guard normalizes helper-produced and already-formed results identically", async () => {
  await withSpillEnv(async (env) => {
    const payload = { schema_version: "guard-parity.v1", ok: true, items: [1, 2, 3] };

    const viaHelper = await guardToolHandler(async () => jsonContent(payload, { env }), { env })();
    const alreadyFormed = await guardToolHandler(
      async () => ({
        content: [{ type: "text", text: "opaque handler summary" }],
        structuredContent: payload
      }),
      { env }
    )();

    assertTwoChannelEquivalence(viaHelper);
    assertTwoChannelEquivalence(alreadyFormed);
    assert.deepEqual(alreadyFormed.content, viaHelper.content);
    assert.deepEqual(alreadyFormed.structuredContent, viaHelper.structuredContent);
    assert.ok(!JSON.stringify(alreadyFormed).includes("opaque handler summary"));

    assert.deepEqual(normalizeMcpToolResult(viaHelper, { env }), viaHelper);

    const contentOnly = await guardToolHandler(
      async () => ({ content: [{ type: "text", text: "plain text result" }] }),
      { env }
    )();
    assert.equal(contentOnly.content[0].text, "plain text result");
    assert.equal(contentOnly.structuredContent, undefined);
  });
});

test("a near-limit success spills because the complete two-channel result exceeds the limit", async () => {
  await withSpillEnv(async (env) => {
    const payload = {
      schema_version: "near-limit.v1",
      value: `near-limit-payload-marker-${"n".repeat(5_000)}`
    };

    assert.ok(
      Buffer.byteLength(JSON.stringify(payload), "utf8") < TWO_CHANNEL_INLINE_LIMIT,
      "the fixture must fit a single-copy budget for this test to discriminate"
    );

    const result = jsonContent(payload, { env });

    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(result.structuredContent.response_spilled, true);
    assertTwoChannelEquivalence(result);
    assertWithinInlineLimit(result);
  });
});

test("already-formed result metadata participates in the complete-result spill decision", async () => {
  await withSpillEnv(async (env) => {
    const payload = {
      schema_version: "metadata-boundary.v1",
      value: `structured-payload-${"s".repeat(2_500)}`
    };
    const result = await guardToolHandler(async () => ({
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
      _meta: { note: "m".repeat(3_500) }
    }), { env })();

    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(result.structuredContent.response_spilled, true);
    assert.equal(result._meta.note.length, 3_500);
    assertTwoChannelEquivalence(result);
    assertWithinInlineLimit(result);
    const reference = result.structuredContent.content_reference;
    const chunks = [];
    let offset = 0;
    do {
      const recovered = readSpilledMcpContentReference({
        ref_id: reference.ref_id,
        offset,
        length: reference.range.max_length
      }, { env });
      chunks.push(Buffer.from(recovered.data_base64, "base64"));
      offset = recovered.next_offset;
    } while (offset !== null);
    assert.deepEqual(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      payload
    );
  });
});

test("an oversized structured error spills, keeps isError, and continues to the original envelope", async () => {
  await withSpillEnv(async (env) => {
    const envelope = {
      schema_version: "oversized-error.v1",
      code: "example_oversized_refusal",
      message: `oversized-error-marker-${"e".repeat(5_000)}`,
      details: { retryable: false }
    };
    assert.ok(Buffer.byteLength(JSON.stringify(envelope), "utf8") < TWO_CHANNEL_INLINE_LIMIT);

    const result = errorContent({ envelope }, { env });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assertTwoChannelEquivalence(result);
    assertWithinInlineLimit(result);

    assert.ok(!JSON.stringify(result).includes(envelope.message));
    assert.ok(
      result.structuredContent.preview.bytes <= getResponseSpillConfig(env).previewByteLimit
    );

    const reference = result.structuredContent.content_reference;
    const chunks = [];
    let offset = 0;
    for (;;) {
      const chunk = readSpilledMcpContentReference(
        { ref_id: reference.ref_id, offset, length: reference.range.max_length },
        { env }
      );
      chunks.push(Buffer.from(chunk.data_base64, "base64"));
      if (chunk.eof) break;
      offset = chunk.next_offset;
    }
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), envelope);
  });
});

test("a spill-persistence failure returns the deterministic bounded refusal envelope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-refusal-"));
  try {

    const blocker = path.join(root, "blocker");
    await writeFile(blocker, "not a directory\n");
    const env = {
      WIKI_MCP_RESPONSE_STATE_DIR: path.join(blocker, "response-spill"),
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(TWO_CHANNEL_INLINE_LIMIT)
    };
    const payload = {
      schema_version: "refusal-source.v1",
      value: `refusal-payload-marker-${"r".repeat(9_000)}`
    };

    for (const result of [
      jsonContent(payload, { env }),
      errorContent({ envelope: payload }, { env })
    ]) {
      const refusal = result.structuredContent;
      assert.equal(result.isError, true);
      assertTwoChannelEquivalence(result);
      assertWithinInlineLimit(result);
      assert.equal(refusal.schema_version, "mcp-response-refusal.v1");
      assert.equal(refusal.code, "mcp_response.spill_persistence_failed.v1");
      assert.equal(refusal.response_spilled, false);
      assert.equal(refusal.inline_byte_limit, TWO_CHANNEL_INLINE_LIMIT);
      assert.ok(refusal.total_bytes > TWO_CHANNEL_INLINE_LIMIT);

      assert.equal(refusal.content_reference, undefined);
      assert.equal(refusal.preview, undefined);

      assert.equal(typeof refusal.cause_diagnostic, "string");
      assert.ok(refusal.cause_diagnostic.includes(root));
      assert.deepEqual(refusal.cause_diagnostic_redactions, []);
      assert.ok(!JSON.stringify(result).includes("refusal-payload-marker"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the guard re-synchronizes a spilled result a handler mutated after shaping", async () => {
  await withSpillEnv(async (env) => {
    const payload = { schema_version: "mutated-spill.v1", value: "m".repeat(9_000) };
    const guarded = guardToolHandler(
      async () => {
        const response = jsonContent(payload, { env });

        response.structuredContent.selected_unit = "WK-2112#SLICE-002";
        return response;
      },
      { env }
    );

    const result = await guarded();

    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(result.structuredContent.selected_unit, "WK-2112#SLICE-002");
    assertTwoChannelEquivalence(result);
    assertWithinInlineLimit(result);
  });
});

test("the guard bounds oversized terminal mutations without spilling a second time", async () => {
  await withSpillEnv(async (env, stateDir) => {
    const payload = { schema_version: "terminal-source.v1", value: "t".repeat(9_000) };
    const terminal = errorContent({ envelope: payload }, { env });
    const originalReference = structuredClone(terminal.structuredContent.content_reference);
    const filesBefore = (await readdir(stateDir)).sort();
    terminal.structuredContent.selected_unit = "s".repeat(12_000);
    terminal.structuredContent.noncanonical = "n".repeat(12_000);

    const result = await guardToolHandler(async () => terminal, { env })();

    assertWithinInlineLimit(result);
    assertTwoChannelEquivalence(result);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.schema_version, "wiki-mcp-spilled-response.v1");
    assert.deepEqual(result.structuredContent.content_reference, originalReference);
    assert.equal(result.structuredContent.selected_unit, undefined);
    assert.equal(result.structuredContent.noncanonical, undefined);
    assert.deepEqual((await readdir(stateDir)).sort(), filesBefore);

    const chunks = [];
    let offset = 0;
    do {
      const chunk = readSpilledMcpContentReference({
        ref_id: originalReference.ref_id,
        offset,
        length: originalReference.range.max_length
      }, { env });
      chunks.push(Buffer.from(chunk.data_base64, "base64"));
      offset = chunk.next_offset;
    } while (offset !== null);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), payload);
  });
});

test("a diagnostic larger than the former cap is preserved completely", () => {
  const diagnostic = `Unicode 🚀\n${"z!?.,[]{}".repeat(1_000)}`;
  const result = errorContent(new Error(diagnostic));

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.diagnostic, diagnostic);
  assert.deepEqual(result.structuredContent.diagnostic_redactions, []);
  assertTwoChannelEquivalence(result);
  assertWithinInlineLimit(result, getResponseSpillConfig().inlineByteLimit);
});

test("an oversized diagnostic is exactly reconstructable through ranged retrieval", async () => {
  await withSpillEnv(async (env) => {
    const diagnostic = `start 🚀\n${"!?.,[]{}-diagnostic-".repeat(2_000)}\nend`;
    const result = errorContent(new Error(diagnostic), { env });
    const spilled = result.structuredContent;
    assert.equal(spilled.schema_version, "wiki-mcp-spilled-response.v1");
    assert.equal(spilled.response_spilled, true);
    assert.equal(spilled.total_bytes, spilled.content_reference.byte_count);

    const chunks = [];
    let offset = 0;
    do {
      const chunk = readSpilledMcpContentReference({
        ref_id: spilled.content_reference.ref_id,
        offset,
        length: spilled.content_reference.range.max_length
      }, { env });
      chunks.push(Buffer.from(chunk.data_base64, "base64"));
      offset = chunk.next_offset;
    } while (offset !== null);

    const completeBytes = Buffer.concat(chunks);
    assert.equal(completeBytes.byteLength, spilled.total_bytes);
    const complete = JSON.parse(completeBytes.toString("utf8"));
    assert.equal(complete.diagnostic, diagnostic);
    assert.deepEqual(complete.diagnostic_redactions, []);
  });
});

test("a structured secret redacts only the secret component", () => {
  const secret = "credential-secret-123";
  const diagnostic = captureStructuredDiagnostic(
    `ordinary prefix ${secret}\nordinary suffix!?`,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] }
  );
  const envelope = errorContent(diagnostic).structuredContent;
  assert.equal(envelope.diagnostic,
    "ordinary prefix [redacted:secret_material]\nordinary suffix!?");
  assert.deepEqual(envelope.diagnostic_redactions, [
    { field: "mcp_response.thrown_diagnostic.credential", reason: "secret_material" }
  ]);
  assert.equal(JSON.stringify(envelope).includes(secret), false);
  assert.equal(JSON.stringify(envelope.refusal.recovery).includes(secret), false);
});

test("an unknown structured redaction reason is schema-invalid", () => {
  assert.throws(() => captureStructuredDiagnostic("ordinary text", {
    sensitiveValues: [{ field: "value", value: "ordinary", reason: "unknown_reason" }]
  }), /structured diagnostic sensitive values/u);
});

function lifecycleSeams({ ppid = 42, closeServer = null } = {}) {
  const processLike = new EventEmitter();
  const stdin = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let intervalCallback;
  let timeoutCallback;
  let clearedIntervals = 0;
  let clearedTimeouts = 0;
  let timeoutSchedules = 0;
  let intervalHandle;
  const exits = [];
  let currentPpid = ppid;
  const controller = createStdioShutdownController({
    processLike,
    stdin,
    stdout,
    stderr,
    readPpid: () => currentPpid,
    setIntervalFn: (callback, delay) => {
      assert.equal(delay, 250);
      intervalCallback = callback;
      intervalHandle = { unref() { this.unrefed = true; } };
      return intervalHandle;
    },
    clearIntervalFn: () => { clearedIntervals += 1; },
    setTimeoutFn: (callback, delay) => {
      assert.equal(delay, 2000);
      timeoutSchedules += 1;
      timeoutCallback = callback;
      return { callback };
    },
    clearTimeoutFn: () => { clearedTimeouts += 1; },
    terminate: (code) => exits.push(code),
    disableDiagnostics: () => stderr.disabled = true
  });
  if (closeServer) controller.setServerCloseHook(closeServer);
  return {
    controller,
    stdin,
    stdout,
    stderr,
    exits,
    setPpid(value) { currentPpid = value; intervalCallback?.(); },
    fireTimeout() { timeoutCallback?.(); },
    get clearedIntervals() { return clearedIntervals; },
    get clearedTimeouts() { return clearedTimeouts; },
    get timeoutSchedules() { return timeoutSchedules; },
    get intervalUnrefed() { return intervalHandle?.unrefed === true; }
  };
}

test("diagnostic sink drops nested and post-failure emissions without throwing", () => {
  const stderr = new EventEmitter();
  const writes = [];
  let sink;
  sink = createDiagnosticSink({
    stderr,
    write: (_stream, text) => {
      writes.push(text);
      sink.emit({ nested: true });
    },
    serialize: (value) => JSON.stringify(value)
  });
  assert.equal(sink.emit({ ok: true }), true);
  assert.equal(writes.length, 1);
  assert.equal(sink.state, "active");
  const failing = createDiagnosticSink({ stderr: new EventEmitter(), write: () => { throw new Error("EPIPE"); } });
  assert.equal(failing.emit({}), false);
  assert.equal(failing.state, "disabled");
  assert.equal(failing.emit({}), false);
  assert.doesNotThrow(() => failing.stderr);
});

test("a synchronous stderr failure during emit leaves the sink terminally disabled", () => {
  const stderr = new EventEmitter();
  let sink;
  sink = createDiagnosticSink({
    stderr,

    write: () => { stderr.emit("error", new Error("EPIPE")); }
  });
  sink.emit({ ok: true });
  assert.equal(sink.state, "disabled");
  assert.equal(sink.disabled, true);
  assert.equal(sink.emit({ again: true }), false);

  const onClose = new EventEmitter();
  const closing = createDiagnosticSink({
    stderr: onClose,
    write: () => { onClose.emit("close"); }
  });
  closing.emit({ ok: true });
  assert.equal(closing.disabled, true);

  closing.disable();
  assert.equal(closing.state, "disabled");
  assert.equal(closing.emit({}), false);
});

test("diagnostic sink contains serialization and logger failures", () => {
  const serializationFailure = createDiagnosticSink({
    stderr: new EventEmitter(),
    serialize: () => { throw new Error("serialization failed"); },
    write: () => { throw new Error("write must not run"); }
  });
  assert.equal(serializationFailure.emit({}), false);
  assert.equal(serializationFailure.disabled, true);

  const loggerFailure = createDiagnosticSink({
    stderr: new EventEmitter(),
    write: () => {},
    log: () => { throw new Error("logger failed"); }
  });
  assert.equal(loggerFailure.emit({}), false);
  assert.equal(loggerFailure.disabled, true);
});

test("stderr error or close disables diagnostics only", () => {
  const stderr = new EventEmitter();
  const sink = createDiagnosticSink({ stderr, write: () => {} });
  stderr.emit("error", new Error("EPIPE"));
  assert.equal(sink.disabled, true);
  const seams = lifecycleSeams();
  seams.stderr.emit("close");
  assert.equal(seams.controller.phase, "running");
  assert.equal(seams.exits.length, 0);
});

test("stable and changed parent identities are classified and interval is unrefed", async () => {
  const seams = lifecycleSeams();
  assert.equal(seams.controller.phase, "running");
  assert.equal(seams.intervalUnrefed, true);
  seams.setPpid(42);
  assert.equal(seams.exits.length, 0);
  seams.setPpid(43);
  await seams.controller.cleanup();
  assert.equal(seams.controller.phase, "terminated");
  assert.deepEqual(seams.exits, [1]);
  assert.equal(seams.clearedIntervals, 1);
});

test("initial PPID values 0 and 1 are fatal without starting a probe interval", async () => {
  for (const ppid of [0, 1]) {
    const seams = lifecycleSeams({ ppid });
    await seams.controller.cleanup();
    assert.deepEqual(seams.exits, [1]);
    assert.equal(seams.controller.phase, "terminated");
    assert.equal(seams.clearedIntervals, 0);
  }
});

test("shutdown captures pre-assignment cleanup and ignores a hook assigned afterward", async () => {
  let closes = 0;
  const seams = lifecycleSeams({ ppid: 1 });
  seams.controller.setServerCloseHook(() => { closes += 1; });
  await seams.controller.cleanup();
  assert.deepEqual(seams.exits, [1]);
  assert.equal(seams.controller.phase, "terminated");
  assert.equal(closes, 0);
});

test("stdin error requests fatal shutdown and explicit orderly exit is preserved", async () => {
  const errorSeams = lifecycleSeams();
  errorSeams.stdin.emit("error", new Error("EPIPE"));
  await errorSeams.controller.cleanup();
  assert.deepEqual(errorSeams.exits, [1]);

  const orderlySeams = lifecycleSeams({ closeServer: async () => {} });
  orderlySeams.controller.requestShutdown(0);
  await orderlySeams.controller.cleanup();
  assert.deepEqual(orderlySeams.exits, [0]);
});

test("stdin EOF is orderly, but fatal events upgrade the in-flight cleanup", async () => {
  let closes = 0;
  const seams = lifecycleSeams({ closeServer: async () => { closes += 1; } });
  seams.stdin.emit("end");
  seams.stdout.emit("error", new Error("EPIPE"));
  await seams.controller.cleanup();
  assert.equal(closes, 1);
  assert.deepEqual(seams.exits, [1]);
  assert.equal(seams.timeoutSchedules, 1);
  seams.stdin.emit("close");
  assert.deepEqual(seams.exits, [1]);
});

test("stdin close without EOF and stdout close are fatal; cleanup rejection is bounded", async () => {
  const seams = lifecycleSeams({ closeServer: () => Promise.reject(new Error("close failed")) });
  seams.stdin.emit("close");
  await assert.rejects(seams.controller.cleanup(), /close failed/);
  assert.deepEqual(seams.exits, [1]);
  const hanging = lifecycleSeams({ closeServer: () => new Promise(() => {}) });
  hanging.stdout.emit("close");
  hanging.fireTimeout();
  assert.deepEqual(hanging.exits, [1]);
  assert.equal(hanging.controller.phase, "terminated");
});

test("shutdown storms invoke the late-bound server close hook exactly once", async () => {
  let closes = 0;
  const seams = lifecycleSeams({ closeServer: async () => { closes += 1; } });

  seams.stdin.emit("end");
  seams.stdin.emit("close");
  seams.stdout.emit("error", new Error("peer vanished"));
  seams.stdout.emit("close");
  seams.setPpid(43);

  await seams.controller.cleanup();
  assert.equal(closes, 1);
  assert.deepEqual(seams.exits, [1]);
});

test("WK-2359 the mcp-response public refusal codes are registered in the canonical taxonomy", async () => {
  const { getRuntimeBlockerEntry, isRuntimeBlockerCode } = await import(
    "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs"
  );

  for (const code of [
    "mcp_response.spill_persistence_failed.v1",
    "mcp_response.content_reference_ranged_read_unavailable.v1"
  ]) {
    assert.equal(isRuntimeBlockerCode(code), true, `${code} must be registered`);
    const entry = getRuntimeBlockerEntry(code);
    assert.equal(entry.category, "transport");
    assert.equal(entry.blocking, true);
    assert.equal(entry.actor_recovery, "operator");
    assert.ok(entry.summary.length > 0, `${code} must carry a summary`);
    assert.ok(entry.consumer_notes.length > 0, `${code} must tell a consumer what to do`);
  }
});

test("a spill-persistence refusal publishes its complete ordinary diagnostic", async () => {
  const { isRuntimeBlockerCode } = await import(
    "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs"
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), "wk2359-spill-"));
  try {

    const unwritable = path.join(dir, "not-a-directory");
    await writeFile(unwritable, "x", "utf8");
    const env = {
      WIKI_MCP_RESPONSE_STATE_DIR: path.join(unwritable, "nested"),
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(TWO_CHANNEL_INLINE_LIMIT)
    };
    const oversized = {
      schema_version: "wk2359-oversized.v1",
      blob: "y".repeat(TWO_CHANNEL_INLINE_LIMIT * 2)
    };

    const result = normalizeMcpToolResult(jsonContent(oversized), { env });
    const envelope = result.structuredContent;

    assert.equal(envelope.schema_version, "mcp-response-refusal.v1");
    assert.equal(envelope.code, "mcp_response.spill_persistence_failed.v1");
    assert.equal(isRuntimeBlockerCode(envelope.code), true,
      "the published code must be the registered identity");
    assert.equal(envelope.response_spilled, false);

    assert.equal(Object.hasOwn(envelope, "content_reference"), false);
    assert.equal(typeof envelope.cause_diagnostic, "string");
    assert.equal(envelope.cause_diagnostic.includes(os.tmpdir()), true);
    assert.deepEqual(envelope.cause_diagnostic_redactions, []);

    assert.equal(JSON.stringify(envelope).includes("y".repeat(64)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed spill discloses the failure without inventing a failed operation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-core-preserved-"));
  try {
    const blocker = path.join(root, "blocker");
    await writeFile(blocker, "not a directory\n");
    const env = {
      WIKI_MCP_RESPONSE_STATE_DIR: path.join(blocker, "response-spill"),
      WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(TWO_CHANNEL_INLINE_LIMIT)
    };

    const succeeded = jsonContent({
      schema_version: "core-success.v1",
      accepted: true,
      value: `core-marker-${"s".repeat(9_000)}`
    }, { env }).structuredContent;

    assert.equal(succeeded.code, "mcp_response.spill_persistence_failed.v1");
    assert.equal(succeeded.response_spilled, false);
    assert.deepEqual(succeeded.core_result, {
      outcome: "succeeded",
      preserved: "identity_only",
      schema_version: "core-success.v1",
      accepted: true
    });

    assert.equal(JSON.stringify(succeeded).includes("core-marker-"), false);

    const refusal = succeeded.refusal;
    const facts = Object.fromEntries(refusal.deciding_facts.map((f) => [f.field, f]));
    assert.equal(facts["mcp_response.spill_persisted"].value, false);
    assert.equal(facts["mcp_response.core_operation_outcome"].value, "succeeded");
    assert.equal(Object.hasOwn(facts, "mcp_response.spill_failure_cause"), false);
    assert.equal(typeof succeeded.cause_diagnostic, "string");
    assert.equal(refusal.no_supported_route, true);

    const failed = errorContent({
      envelope: {
        schema_version: "core-failure.v1",
        accepted: false,
        code: "validation_failure",
        value: `core-marker-${"f".repeat(9_000)}`
      }
    }, { env }).structuredContent;
    assert.equal(failed.core_result.outcome, "failed");
    assert.equal(failed.core_result.code, "validation_failure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function hostileAccessor(base, key, message) {
  const target = base;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error(message);
    }
  });
  return target;
}

function assertCanonicalUntypedRefusal(result, label) {
  assert.equal(result.isError, true, label);
  const envelope = result.structuredContent;
  assert.ok(envelope, `${label}: the boundary still answers`);
  assert.equal(envelope.code, "mcp_response.handler_exception.v1", label);
  assert.equal(envelope.refusal.schema_version, "public-mechanical-refusal.v1", label);
  const facts = Object.fromEntries(envelope.refusal.deciding_facts.map((f) => [f.field, f]));
  assert.equal(facts["mcp_response.handler_completed"].value, false, label);
  assert.equal(Object.hasOwn(facts, "mcp_response.thrown_diagnostic"), false, label);
  assert.equal(envelope.refusal.no_supported_route, true, label);
  assertTwoChannelEquivalence(result);
  return envelope;
}

test("a throwing code accessor does not escape errorContent", () => {
  const error = hostileAccessor(
    new Error("readable message"),
    "code",
    "hostile code getter at /home/secret/keys"
  );
  const envelope = assertCanonicalUntypedRefusal(
    errorContent(error),
    "throwing code"
  );

  assert.equal(envelope.diagnostic, "readable message");
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes("/home/secret"), false, "no private path escapes");
  assert.equal(serialized.includes("hostile code getter"), false, "no hostile text escapes");
  assert.equal(
    envelope.refusal.deciding_facts.some((fact) => fact.field === "mcp_response.cause_identity"),
    false,
    "an unreadable identity is not published as one"
  );
});

test("a throwing cause accessor does not escape errorContent", () => {
  const error = hostileAccessor(
    new Error("wrapper failed"),
    "cause",
    "hostile cause getter at /var/private/state"
  );
  const envelope = assertCanonicalUntypedRefusal(errorContent(error), "throwing cause");
  assert.equal(envelope.diagnostic, "wrapper failed");
  assert.equal(JSON.stringify(envelope).includes("/var/private"), false);
});

test("a throwing Error.message accessor does not escape errorContent", () => {
  const error = hostileAccessor(
    new Error("original"),
    "message",
    "hostile message getter at /home/secret/notes"
  );
  const envelope = assertCanonicalUntypedRefusal(errorContent(error), "throwing message");

  assert.equal(envelope.diagnostic, "[unreadable diagnostic]");
  assert.equal(JSON.stringify(envelope).includes("/home/secret"), false);
});

test("a throwing envelope accessor cannot decide whether the boundary answers", () => {
  const error = hostileAccessor({}, "envelope", "hostile envelope getter at /home/secret/x");
  const envelope = assertCanonicalUntypedRefusal(errorContent(error), "throwing envelope");
  assert.equal(JSON.stringify(envelope).includes("/home/secret"), false);
});

test("a hostile accessor on a nested cause is bounded like every other read", () => {
  const inner = hostileAccessor(new Error("inner"), "code", "hostile nested code getter");
  const outer = new Error("outer");
  outer.cause = inner;
  const envelope = assertCanonicalUntypedRefusal(errorContent(outer), "nested hostile cause");
  assert.equal(envelope.diagnostic, "outer");
  assert.equal(JSON.stringify(envelope).includes("hostile nested"), false);

  const again = errorContent(outer).structuredContent;
  assert.deepEqual(again, envelope);
});
