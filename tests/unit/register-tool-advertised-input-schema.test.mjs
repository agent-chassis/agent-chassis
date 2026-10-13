

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import {
  createRegisterTool,
  createToolInputValidationError,
  projectToolInputValidationFailure,
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  projectMcpCallableOwnerIssues
} from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import {
  errorContent,
  jsonContent,
  readSpilledMcpContentReference
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import {
  completeToolInputContract,
  hasCompactToolDeclaration,
  INPUT_CONTRACT_SCHEMA_SOURCES
} from "../../packages/wiki-mcp/src/lib/compact-tool-declaration-registry.mjs";
import { projectZodRequestContract } from
  "../../packages/wiki-mcp/src/lib/zod-request-contract-projection.mjs";
import {
  deliverToolInputGuidance,
  TOOL_INPUT_GUIDANCE_CODES,
  toolInputGuidanceDigest
} from "../../packages/wiki-mcp/src/lib/tool-discovery-input-guidance-delivery.mjs";
import {
  REGISTERED_TOOL_REQUEST_CONTRACT_CODES,
  registeredToolRequestContracts
} from "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";
import { WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA } from
  "../../packages/wiki-mcp/src/lib/tool-discovery-tools.mjs";
import {
  CONTROLLED_CONTRACT_MCP_TOOL_NAMES,
  registerControlledContractTools
} from "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { requestContractErrors } from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  TOOL_ROUTER_PRODUCER_ERROR_CODES,
  recommendToolRouteFromVocabulary
} from "../../packages/wiki-core/src/operations/tool-router.mjs";
import { assertStructuredCarrier } from "../helpers/mcp-journey-accounting.mjs";
import { createSaveRecordInputContract, saveRecordUnitVariant } from
  "../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs";
import { createRequire } from "node:module";
import { INPUT_SCHEMA_EXPOSURE_CODES } from "../../packages/wiki-mcp/src/lib/input-schema-exposure.mjs";
import { createSaveRecordInputExposure } from "../../packages/wiki-mcp/src/lib/save-record-input-exposure.mjs";

const AUTHORITATIVE = z.object({
  unit: z.string().regex(/^WK-[0-9]{4}$/u),
  answer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("wording"), statement: z.string().min(1).max(64) }).strict(),
    z.object({ kind: z.literal("skip") }).strict()
  ]).optional(),
  cursor: z.string().optional()
}).strict().superRefine((value, context) => {
  if (value.answer !== undefined && value.cursor !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "answer and cursor are exclusive" });
  }
});

const ADVERTISED = z.object({
  unit: z.string().regex(/^WK-[0-9]{4}$/u),
  answer: z.object({ kind: z.enum(["wording", "skip"]) }).passthrough().optional(),
  cursor: z.string().optional()
}).strict();

const { CONFLICT, PROJECTION_UNAVAILABLE } = REGISTERED_TOOL_REQUEST_CONTRACT_CODES;
const PRIMARY_ROUTE = "save_record";
const PLAIN_ROUTE = "workspace_read_wiki";
const UNENFORCEABLE_ROUTE = "workspace_create_record";
const REFINED_ROUTE = "workspace_assess_contract";

function createBoundary({
  toolName = PRIMARY_ROUTE,
  toolNames = [toolName],
  toolProfile = "operator",
  registeredTier = "paid_cce",
  freeLocalToolNames = toolNames,
  server = null,

  responseEnv = undefined,
  respond = () => ({ content: [{ type: "text", text: "ok" }] })
} = {}) {
  const registered = new Map();
  const calls = [];
  const names = new Set(toolNames);
  const registerTool = createRegisterTool({
    server: server ?? { registerTool: (name, config, handler) => registered.set(name, { config, handler }) },
    toolProfile,
    registeredTier,
    mcpToolTierRegistrationPolicy: {
      descriptorToolNames: names,
      registrationEligibleToolNames: names,
      descriptorLoaded: true,
      freeLocalToolNames: new Set(freeLocalToolNames)
    },
    toolUsageAuditBoundary: { wrapHandler: (_name, handler) => handler },
    registeredToolNames: new Set(),
    structuredLog: () => {},
    ...(responseEnv === undefined ? {} : { responseEnv })
  });
  const handler = async (args) => {
    calls.push(args);
    return respond(args);
  };
  const register = (config) => registerTool(toolName, config, handler);
  return {
    register,
    registerTool,
    handler,
    registered,
    calls,
    toolName,
    contracts: registeredToolRequestContracts(registerTool)
  };
}

const errorTextOf = (result) => JSON.stringify(result);

test('shared task projection bounds selected authoring paths and native constraint parameters', async () => {
  const longMember = 'x'.repeat(2048);
  const body = await projectToolInputValidationFailure({ tool: 'save_record', args: { unit: 'WK-0001' },
    ownerDiagnostics: [{ code: 'record_authoring_change_invalid', path: `changes.${longMember}`,
      message: `changes.${longMember} is not an accepted member`,
      constraint: { keyword: 'additionalProperties', additionalProperty: longMember } }],
    requestContract: { acceptsArguments: () => assert.fail('authored correction must remain a caller choice') }
  });
  const [issue] = body.invalid_fields;
  assert.deepEqual(issue.path, ['changes', { index: 1, utf8_bytes: 2048 }]);
  assert.equal(issue.message, undefined);
  assert.ok(issue.message_utf8_bytes > 2048);
  assert.deepEqual(issue.constraint, { keyword: 'additionalProperties', additionalProperty_utf8_bytes: 2048 });
  assert.deepEqual(body.next_calls, []);
});

test("shared task refusals preserve constraints and require real caller choices before owner effects", async () => {
  const boundary = createBoundary();
  const schema = z.object({ unit: z.string(), role: z.enum(["worker", "reviewer"]),
    count: z.number().int().min(1), answer: z.object({ statement: z.string().min(1) }).strict() }).strict();
  boundary.register({ description: "d", inputSchema: schema, advertisedInputSchema: schema,
    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
      ...jsonContent(await projectToolInputValidationFailure({ tool: boundary.toolName, args, validationError,
        requestContract: boundary.contracts.contractFor(boundary.toolName) })), isError: true
    } }) });
  const { handler } = boundary.registered.get(boundary.toolName);
  const valid = { unit: "WK-2665", role: "worker", count: 1, answer: { statement: "known wording" } };
  for (const args of [{ ...valid, role: undefined }, { ...valid, count: "1" },
    { ...valid, role: "invented" }, { ...valid, count: 0 }, { ...valid, answer: {} }]) {
    const refused = await handler(args);
    assert.equal(refused.isError, true);
    const body = refused.structuredContent;
    assert.equal(body.subject, valid.unit);
    assert.deepEqual(body.invalid_fields, schema.safeParse(args).error.issues);
    assert.deepEqual(body.next_calls, [], "caller meaning is never invented or coerced");
    assert.deepEqual(boundary.calls, [], "invalid input never reaches mutation/launch ownership");
  }
  const missing = (await handler({ ...valid, role: undefined })).structuredContent;
  assert.deepEqual(missing.required_inputs[0], { path: ["role"], expected: "'worker' | 'reviewer'",
    choice: "caller_supplied_value_required" });
  const enumRefusal = (await handler({ ...valid, role: "invented" })).structuredContent;
  assert.deepEqual(enumRefusal.invalid_fields[0].options, ["worker", "reviewer"]);
});

test("shared task correction removes only unsupported fields and passes the full serving validator", async () => {
  const boundary = createBoundary();
  boundary.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
      ...jsonContent(await projectToolInputValidationFailure({ tool: boundary.toolName, args, validationError,
        requestContract: boundary.contracts.contractFor(boundary.toolName) })), isError: true
    } }) });
  const { handler } = boundary.registered.get(boundary.toolName);
  const args = { unit: "WK-2665", answer: { kind: "skip", extra: true }, extra: "discard this member" };
  const body = (await handler(args)).structuredContent;
  assert.deepEqual(boundary.calls, []);
  assert.equal(body.invalid_fields[0].message, "Unrecognized key(s) in object: 'extra'");
  assert.deepEqual(body.invalid_fields[0].keys, ["extra"]);
  const corrected = body.next_calls[0];
  assert.equal(corrected.tool, boundary.toolName);
  assert.deepEqual(corrected.arguments, { unit: "WK-2665", answer: { kind: "skip" } });
  assert.equal(await boundary.contracts.contractFor(corrected.tool).acceptsArguments(corrected.arguments), true);
  assert.notEqual((await handler(corrected.arguments)).isError, true);
  assert.deepEqual(boundary.calls, [corrected.arguments]);
  assert.equal(args.answer.extra, true, "projection never changes the refused request");
});

test("owner-supplied read-only guidance stays beside the refusal's facts and is never a corrected request", async () => {

  const read = { tool: PLAIN_ROUTE, recommended: true, purpose: "the applicable contract",
    arguments: { reference: { ref_id: "aB3_dE9x" }, select: { context: true } } };
  const guided = (ownerGuidance) => {
    const boundary = createBoundary();
    boundary.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
      inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
        ...jsonContent(await projectToolInputValidationFailure({ tool: boundary.toolName, args, validationError,
          requestContract: boundary.contracts.contractFor(boundary.toolName),
          ...(ownerGuidance === undefined ? {} : { ownerGuidance }) })), isError: true
      } }) });
    return { ...boundary, handler: boundary.registered.get(boundary.toolName).handler };
  };
  const authored = { unit: "WK-2665", answer: { kind: "wording" } };
  const removable = { unit: "WK-2665", answer: { kind: "skip", extra: true } };
  const plain = guided();
  const defaults = { authored: (await plain.handler(authored)).structuredContent,
    removable: (await plain.handler(removable)).structuredContent };

  const withRead = guided({ calls: [read], reference_acquisition: { reads: ["record"], writes: [] } });
  const body = (await withRead.handler(authored)).structuredContent;
  assert.deepEqual(body.next_calls, [read]);
  assert.match(body.correction, /^Supply the missing caller choices.*they write nothing and are not a corrected request\.$/u);
  assert.deepEqual(body.owner_guidance, { reference_acquisition: { reads: ["record"], writes: [] } });
  assert.deepEqual([body.invalid_fields, body.required_inputs, body.issue_count, body.code, body.accepted],
    [defaults.authored.invalid_fields, defaults.authored.required_inputs, defaults.authored.issue_count,
      "tool_input_validation_failed", false], "the field and caller-choice facts are unchanged");
  assert.deepEqual(withRead.calls, [], "the full validator still refuses before the handler");

  const both = (await withRead.handler(removable)).structuredContent;
  assert.deepEqual(both.next_calls[0], defaults.removable.next_calls[0]);
  const { recommended: _recommended, ...alongside } = read;
  assert.deepEqual(both.next_calls.slice(1), [alongside]);
  assert.match(both.correction, /^Call the corrected request with the unsupported fields removed\. The read-only calls/u);

  const unavailable = { state: "unavailable", missing_capability: "c", owner: "o", reason: "r" };
  const none = (await guided({ calls: [], unavailable }).handler(authored)).structuredContent;
  assert.deepEqual([none.next_calls, none.owner_guidance, none.correction],
    [[], { unavailable }, defaults.authored.correction]);
  for (const absent of [null, { calls: [] }]) {
    assert.deepEqual((await guided(absent).handler(authored)).structuredContent, defaults.authored);
    assert.deepEqual((await guided(absent).handler(removable)).structuredContent, defaults.removable);
  }
  assert.equal(Object.hasOwn(defaults.authored, "owner_guidance"), false);
});

test("shared task refusals retain each union branch's useful schema diagnosis", async () => {
  const boundary = createBoundary();
  const schema = z.object({ answer: z.union([z.string().min(1), z.number().min(1)]) }).strict();
  boundary.register({ description: "d", inputSchema: schema, advertisedInputSchema: schema,
    inputValidationErrorProjector: async ({ args, validationError }) => ({ terminal_result: {
      ...jsonContent(await projectToolInputValidationFailure({ tool: boundary.toolName, args, validationError,
        requestContract: boundary.contracts.contractFor(boundary.toolName) })), isError: true
    } }) });
  const { handler } = boundary.registered.get(boundary.toolName);
  const body = (await handler({ answer: false })).structuredContent;
  assert.deepEqual(body.invalid_fields[0].path, ["answer"]);
  assert.deepEqual(body.invalid_fields[0].union_errors.map(branch => branch.issues[0].expected), ["string", "number"]);
  assert.ok(body.invalid_fields[0].union_errors.every(branch => branch.issues[0].received === "boolean"));
  assert.deepEqual(body.next_calls, []);
  assert.deepEqual(boundary.calls, []);
});

test("the advertised schema is what tools/list receives", () => {
  const { register, registered, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });

  const published = registered.get(toolName).config.inputSchema;
  assert.equal(
    Object.keys(published.shape.answer._def.innerType.shape).join(),
    "kind",
    "the published answer shape is the compact one"
  );
});

test("the authoritative schema refuses an answer the compact declaration would admit, before the handler runs", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  const result = await handler({ unit: "WK-2520", answer: { kind: "wording" } });

  assert.equal(result.isError, true, "an answer missing a required field must be refused");
  assert.match(errorTextOf(result), /\$\.answer\.statement/u);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.diagnostic.code, "tool_input_validation_failed");
  assert.equal(result.structuredContent.diagnostic.authority_limb, "mechanical_failure");
  assert.deepEqual(result.structuredContent.diagnostic.validator_diagnostics,
    AUTHORITATIVE.safeParse({ unit: "WK-2520", answer: { kind: "wording" } }).error.issues);
  assert.equal(Object.hasOwn(result.structuredContent, "next_calls"), false,
    "a failed request proposes no replacement call");
  assert.match(errorTextOf(result), /Required/u,
    "the field path supplements rather than replaces validator detail");
  assert.deepEqual(calls, [], "refusal must happen before the handler is reached");
});

test("an unknown nested field is refused even though the advertised answer is passthrough", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  const result = await handler({
    unit: "WK-2520",
    answer: { kind: "skip", carrier_path: "/etc/passwd" }
  });

  assert.equal(result.isError, true, "a compact advertisement is not permission to send arbitrary fields");
  assert.deepEqual(calls, []);
});

test("an unknown top-level field is still refused", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  const result = await handler({ unit: "WK-2520", authority: "operator" });
  assert.equal(result.isError, true);
  assert.deepEqual(calls, []);
});

test("a cross-field rule the advertisement cannot express is still enforced", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  const result = await handler({
    unit: "WK-2520", answer: { kind: "skip" }, cursor: "c1"
  });
  assert.equal(result.isError, true, "mixed request modes must still refuse");
  assert.deepEqual(calls, []);
});

test("a wrong scalar shape is refused by the field's own declared constraint", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  for (const bad of [{ unit: "not-a-wk" }, { unit: 2520 }, { unit: "WK-2520", answer: "wording" }]) {
    const result = await handler(bad);
    assert.equal(result.isError, true, `${errorTextOf(bad)} must be refused`);
  }
  assert.deepEqual(calls, []);
});

test("a valid request still reaches the handler, fully parsed", async () => {
  const { register, registered, calls, toolName } = createBoundary();
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const { handler } = registered.get(toolName);

  const result = await handler({ unit: "WK-2520", answer: { kind: "wording", statement: "s" } });

  assert.notEqual(result.isError, true, errorTextOf(result));
  assert.deepEqual(calls, [{ unit: "WK-2520", answer: { kind: "wording", statement: "s" } }]);
});

test("a compacted route registers its complete contract for discovery to serve", () => {
  const toolName = PRIMARY_ROUTE;
  const { register } = createBoundary({ toolName });
  register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });

  assert.equal(hasCompactToolDeclaration(toolName), true);
  const contract = completeToolInputContract(toolName);
  assert.equal(contract.advertised_declaration, "compact");
  assert.equal(contract.enforcement, "server_side_on_every_call");

  const serialized = JSON.stringify(contract);
  assert.match(serialized, /statement/u);
  assert.match(serialized, /"maxLength":64/u);
});

test("the complete contract is projected from the selected schema source, and enforcement never moves", async () => {
  const outcomes = async ({ registered, calls, contracts }) => {
    const { handler } = registered.get(PRIMARY_ROUTE);
    const incomplete = { unit: "WK-2520", answer: { kind: "wording" } };
    const refused = await handler(incomplete);
    const valid = { unit: "WK-2520", answer: { kind: "wording", statement: "s" } };
    const accepted = await handler(valid);
    return {
      refused_code: refused.structuredContent.diagnostic.code,
      refused_issues: refused.structuredContent.diagnostic.validator_diagnostics,
      accepted_error: accepted.isError === true,
      calls: structuredClone(calls),
      full_accepts_incomplete: await contracts.contractFor(PRIMARY_ROUTE).acceptsArguments(incomplete),
      published: contracts.contractFor(PRIMARY_ROUTE).publishedRequestSchema()
    };
  };
  const register = (extra) => {
    const boundary = createBoundary();
    boundary.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED, ...extra });
    return { boundary, contract: completeToolInputContract(PRIMARY_ROUTE) };
  };

  const omitted = register({});
  const explicit = register({ inputContractSchemaSource: INPUT_CONTRACT_SCHEMA_SOURCES.AUTHORITATIVE });
  const advertised = register({ inputContractSchemaSource: INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED });

  const fromAuthority = projectZodRequestContract(AUTHORITATIVE);
  for (const { contract } of [omitted, explicit]) {
    assert.deepEqual(contract.contract, fromAuthority.contract, "an omitted or explicit authoritative source");
    assert.deepEqual(contract.unprojected, fromAuthority.unprojected);
  }
  const fromAdvertisement = projectZodRequestContract(ADVERTISED);
  assert.deepEqual(advertised.contract.contract, fromAdvertisement.contract,
    "the advertised source projects the raw advertised schema, not the SDK's declaration-only view");
  assert.equal(Object.hasOwn(advertised.contract, "unprojected"), false);
  assert.equal(advertised.contract.completeness, "exact");
  for (const { contract } of [omitted, advertised]) {
    assert.equal(contract.advertised_declaration, "compact");
    assert.equal(contract.enforcement, "server_side_on_every_call");
  }

  const baseline = await outcomes(omitted.boundary);
  const selected = await outcomes(advertised.boundary);
  assert.deepEqual(selected, baseline, "the selected source changes no accepted or refused request");
  assert.equal(baseline.refused_code, "tool_input_validation_failed");
  assert.deepEqual(baseline.refused_issues,
    AUTHORITATIVE.safeParse({ unit: "WK-2520", answer: { kind: "wording" } }).error.issues);
  assert.equal(baseline.accepted_error, false);
  assert.equal(baseline.full_accepts_incomplete, false);
  assert.deepEqual(baseline.calls, [{ unit: "WK-2520", answer: { kind: "wording", statement: "s" } }]);

  for (const { boundary } of [omitted, explicit, advertised]) {
    assert.equal(Object.hasOwn(boundary.registered.get(PRIMARY_ROUTE).config, "inputContractSchemaSource"), false,
      "the selector is a registration declaration and never reaches the SDK");
  }
});

test("a malformed input contract source is refused before anything is published", () => {
  const cases = [
    [{ advertisedInputSchema: ADVERTISED, inputContractSchemaSource: "compact" },
      /^agent_tool_input_contract_schema_source_invalid: /u],
    [{ advertisedInputSchema: ADVERTISED, inputContractSchemaSource: null },
      /^agent_tool_input_contract_schema_source_invalid: /u],
    [{ advertisedInputSchema: ADVERTISED, inputContractSchemaSource: "ADVERTISED" },
      /^agent_tool_input_contract_schema_source_invalid: /u],
    [{ inputContractSchemaSource: INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED },
      /^agent_tool_input_contract_schema_source_without_advertised_schema: /u]
  ];
  for (const [config, code] of cases) {
    const boundary = createBoundary({ toolName: PLAIN_ROUTE });
    assert.throws(() => boundary.register({ description: "d", inputSchema: AUTHORITATIVE, ...config }),
      (error) => code.test(error.message), JSON.stringify(config));
    assert.equal(boundary.registered.size, 0, "the SDK received nothing");
    assert.equal(boundary.contracts.contractFor(PLAIN_ROUTE), null, "no request contract is retained");
    assert.equal(hasCompactToolDeclaration(PLAIN_ROUTE), false, "no compact declaration is recorded");
  }
});

test("a route that advertises nothing registers no compact contract", () => {
  const toolName = PLAIN_ROUTE;
  const { register } = createBoundary({ toolName });
  register({ description: "d", inputSchema: AUTHORITATIVE });

  assert.equal(hasCompactToolDeclaration(toolName), false);
  assert.equal(completeToolInputContract(toolName), null);
});

test("advertising a compact schema without an enforceable contract is refused at registration", () => {
  const { register } = createBoundary({ toolName: UNENFORCEABLE_ROUTE });
  assert.throws(
    () => register({ description: "d", advertisedInputSchema: ADVERTISED }),
    /agent_tool_advertised_schema_without_authority/u,
    "a compact advertisement with nothing behind it is the one shape that must never register"
  );
});

test("an input-failure projector without an enforcement boundary is refused at registration", () => {
  const { register } = createBoundary();
  assert.throws(
    () => register({
      description: "d",
      inputSchema: z.object({ value: z.string() }).strict(),
      inputValidationErrorProjector() {
        return null;
      }
    }),
    /agent_tool_input_failure_projector_without_boundary/u
  );
});

test("an ordinary refined route still publishes its own inner object and enforces its refinements", async () => {
  const toolName = REFINED_ROUTE;
  const { register, registered, calls } = createBoundary({ toolName });
  register({ description: "d", inputSchema: AUTHORITATIVE });
  const { config, handler } = registered.get(toolName);

  assert.equal(config.inputSchema._def.typeName, "ZodObject", "the refined route publishes its inner object");
  assert.equal(
    config.inputSchema.shape.answer._def.innerType._def.typeName,
    "ZodDiscriminatedUnion",
    "the published answer is the complete union, not a compact stand-in"
  );
  const refused = await handler({ unit: "WK-2520", answer: { kind: "skip" }, cursor: "c1" });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.diagnostic.code, "tool_input_validation_failed");
  assert.deepEqual(refused.structuredContent.diagnostic.validator_diagnostics,
    AUTHORITATIVE.safeParse({ unit: "WK-2520", answer: { kind: "skip" }, cursor: "c1" }).error.issues);
  assert.deepEqual(calls, []);
});

test("a refined route with an input-failure projector publishes its inner object as a declaration only", async () => {
  const toolName = REFINED_ROUTE;
  const { register, registered, calls } = createBoundary({ toolName });
  const seen = [];
  register({
    description: "d",
    inputSchema: AUTHORITATIVE,
    inputValidationErrorProjector({ validationError }) {
      seen.push(validationError.issues.map(({ code, path, keys }) => ({ code, path, keys })));
      return null;
    }
  });
  const { config, handler } = registered.get(toolName);
  assert.equal(config.inputSchema._def.typeName, "ZodObject", "the published shape is the inner object");
  assert.equal(config.inputSchema._def.unknownKeys, "strict");
  assert.deepEqual(await config.inputSchema.safeParseAsync({ unit: "WK-2520", stray: true }),
    { success: true, data: { unit: "WK-2520", stray: true } },
    "the published declaration decides nothing");

  const refused = await handler({ unit: "WK-2520", stray: true });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.diagnostic.code, "tool_input_validation_failed");
  assert.deepEqual(seen, [[{ code: "unrecognized_keys", path: [], keys: ["stray"] }]]);
  const accepted = await handler({ unit: "WK-2520", answer: { kind: "skip" } });
  assert.notEqual(accepted.isError, true, errorTextOf(accepted));
  assert.deepEqual(calls, [{ unit: "WK-2520", answer: { kind: "skip" } }]);
});

test("a validation failure keeps checked route calls beside the generated report", () => {
  const validationError = AUTHORITATIVE.safeParse({ unit: "WK-2520", stray: true }).error;
  const nextCall = { tool: REFINED_ROUTE, arguments: { unit: "WK-2520" }, recommended: true };
  const { envelope } = createToolInputValidationError({ tool: REFINED_ROUTE, validationError,
    details: { placement: "fact" }, nextCalls: [nextCall] });
  assert.deepEqual(envelope.next_calls, [nextCall]);
  assert.equal(envelope.diagnostic.placement, "fact");
  assert.deepEqual(envelope.diagnostic.validator_diagnostics, validationError.issues);
  assert.equal(Object.hasOwn(createToolInputValidationError({ tool: REFINED_ROUTE, validationError })
    .envelope, "next_calls"), false, "no call is added unless the route names one");
});

test("a compact route preserves an incumbent owner-projected refusal without replacement guidance", async () => {
  const toolName = PRIMARY_ROUTE;
  const ownerProjection = projectMcpCallableOwnerIssues({
    ownerId: "WK-2029",
    tool: toolName,
    issues: [{
      code: "selector_path_unsupported",
      path: ["answer", "kind"],
      message: "the route owner selected this diagnostic"
    }]
  });
  const ownerSchema = z.object({ unit: z.string() }).strict().superRefine((_value, context) => {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answer", "kind"],
      message: "the route owner selected this diagnostic",
      params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection }
    });
  });
  const { register, registered, calls } = createBoundary({ toolName });
  register({ description: "d", inputSchema: ownerSchema, advertisedInputSchema: ADVERTISED });

  const result = await registered.get(toolName).handler({ unit: "WK-2520" });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.schema_version, "work-record-selector-refusal.v1");
  assert.equal(result.structuredContent.diagnostics[0].code, "selector_path_unsupported");
  assert.equal(Object.hasOwn(result.structuredContent, "diagnostic"), false,
    "owner-projected envelopes take precedence over the generated input failure");
  assert.deepEqual(calls, []);
});

test("an optional input-failure projector augments only rejected calls outside owner conformance facts", async () => {
  const toolName = PRIMARY_ROUTE;
  const { register, registered, calls } = createBoundary({ toolName });
  let projections = 0;
  const nextCall = {
    tool: "workspace_tools_describe",
    arguments: { tool_name: toolName },
    recommended: true
  };
  register({
    description: "d",
    inputSchema: AUTHORITATIVE,
    advertisedInputSchema: ADVERTISED,
    inputValidationErrorProjector({ validationError }) {
      projections += 1;
      return {
        projection: projectMcpCallableOwnerIssues({
          ownerId: "fixture-owner",
          tool: toolName,
          issues: [{
            code: "invalid_fixture_input",
            path: ["answer"],
            message: validationError.message
          }]
        }),
        next_calls: [nextCall]
      };
    }
  });

  const accepted = await registered.get(toolName).handler({
    unit: "WK-2520", answer: { kind: "skip" }
  });
  assert.notEqual(accepted.isError, true, errorTextOf(accepted));
  assert.equal(projections, 0, "the failure projector must not run after a successful parse");

  const rejected = await registered.get(toolName).handler({ unit: "WK-2520", answer: "bad" });
  assert.equal(rejected.isError, true);
  assert.equal(projections, 1);
  assert.deepEqual(rejected.structuredContent.next_calls, [nextCall]);
  assert.deepEqual(calls, [{ unit: "WK-2520", answer: { kind: "skip" } }]);
});

test("an input-failure projector terminal result bypasses owner projection unchanged", async () => {
  const toolName = PRIMARY_ROUTE;
  const { register, registered, calls } = createBoundary({ toolName });
  const terminal = {
    schema_version: "fixture-terminal-refusal.v1",
    code: "fixture_persistence_failed",
    response_spilled: false
  };
  register({
    description: "d",
    inputSchema: AUTHORITATIVE,
    advertisedInputSchema: ADVERTISED,
    inputValidationErrorProjector() {
      return {
        terminal_result: {
          content: [],
          structuredContent: terminal,
          isError: true
        }
      };
    }
  });

  const result = await registered.get(toolName).handler({ unit: "WK-2520", answer: "bad" });
  assert.deepEqual(result.structuredContent, terminal);
  assertStructuredCarrier(result);
  assert.equal(result.isError, true);
  assert.deepEqual(calls, []);
});

test("a successful registration retains its published declaration and its full validator", async () => {
  const raw = createBoundary({ toolName: PLAIN_ROUTE });
  raw.register({ description: "d", inputSchema: { unit: z.string(), limit: z.number().int().optional() } });
  const rawContract = raw.contracts.contractFor(PLAIN_ROUTE);
  assert.deepEqual(Object.keys(rawContract.publishedRequestSchema().properties), ["unit", "limit"]);
  assert.deepEqual(rawContract.publishedRequestSchema().required, ["unit"]);
  assert.equal(await rawContract.acceptsArguments({ unit: "WK-2520" }), true);
  assert.equal(await rawContract.acceptsArguments({ limit: 1 }), false);

  const refined = createBoundary({ toolName: REFINED_ROUTE });
  refined.register({ description: "d", inputSchema: AUTHORITATIVE });
  const refinedContract = refined.contracts.contractFor(REFINED_ROUTE);
  const mixedModes = { unit: "WK-2520", answer: { kind: "skip" }, cursor: "c1" };
  assert.match(JSON.stringify(refinedContract.publishedRequestSchema().properties.answer), /statement/u,
    "a refined route publishes its complete inner object");
  assert.deepEqual(requestContractErrors(REFINED_ROUTE, mixedModes, refinedContract.publishedRequestSchema()), []);
  assert.equal(await refinedContract.acceptsArguments(mixedModes), false, "the refinement stays with the full schema");

  const compact = createBoundary();
  compact.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  const compactContract = compact.contracts.contractFor(PRIMARY_ROUTE);
  const incompleteAnswer = { unit: "WK-2520", answer: { kind: "wording" } };
  assert.equal(JSON.stringify(compactContract.publishedRequestSchema()).includes("statement"), false,
    "the compact declaration is what the route publishes");
  assert.deepEqual(requestContractErrors(PRIMARY_ROUTE, incompleteAnswer, compactContract.publishedRequestSchema()), []);
  assert.equal(await compactContract.acceptsArguments(incompleteAnswer), false);
  assert.equal(await compactContract.acceptsArguments({ unit: "WK-2520", answer: { kind: "wording", statement: "s" } }),
    true);
  assert.equal(compactContract.publishedRequestSchema(), compactContract.publishedRequestSchema(),
    "the selected projection is reused");

  const noArgument = createBoundary({ toolName: UNENFORCEABLE_ROUTE });
  noArgument.register({ description: "d" });
  const noArgumentContract = noArgument.contracts.contractFor(UNENFORCEABLE_ROUTE);
  assert.deepEqual(noArgumentContract.publishedRequestSchema(), { type: "object", properties: {} });
  assert.equal(await noArgumentContract.acceptsArguments({}), true);
  assert.equal(await noArgumentContract.acceptsArguments({ unit: "WK-2520" }), false);
  assert.equal(noArgument.contracts.contractFor(PRIMARY_ROUTE), null,
    "an absent registration is not a no-argument contract");

  const malformed = createBoundary({ toolName: PLAIN_ROUTE });
  malformed.register({ description: "d", inputSchema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]) });
  assert.throws(() => malformed.contracts.contractFor(PLAIN_ROUTE).publishedRequestSchema(),
    (error) => error.code === PROJECTION_UNAVAILABLE);
});

test("a declared published-schema projection is listed and retained as one declaration and decides nothing", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const row = (identity, title) => z.object({ ...identity, title, note: z.string().max(8).optional() }).strict();
  const keyed = z.object({ unit: z.string(), rows: z.array(z.union([
    row({ key: z.string().regex(/^[a-z]+$/u) }, z.string()), row({ id: z.number().int() }, z.string().optional())])) }).strict();

  const deferRows = (schema) => ({ ...schema, properties: { ...schema.properties,
    rows: { description: "Rows are declared in full by the owner." } } });
  let servers = 0;
  const connected = async () => {
    const server = new McpServer({ name: "projection", version: "1" });
    const client = new Client({ name: "reader", version: "1" });
    servers += 1;
    scope.add(`projection server ${servers}`, () => server.close());
    scope.add(`projection client ${servers}`, () => client.close());
    const connect = async () => {
      const [left, right] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(right), client.connect(left)]);
      return client;
    };
    return { server, connect };
  };

  const { server, connect } = await connected();
  const boundary = createBoundary({ server, toolNames: [PRIMARY_ROUTE, PLAIN_ROUTE] });
  const handled = [];
  const handler = async (args) => { handled.push(args); return { content: [{ type: "text", text: "ok" }] }; };
  boundary.registerTool(PRIMARY_ROUTE, { description: "d", inputSchema: keyed, advertisedInputSchema: keyed,
    publishedInputSchemaProjection: deferRows }, handler);
  boundary.registerTool(PLAIN_ROUTE, { description: "d", inputSchema: keyed }, handler);
  const client = await connect();
  const listed = new Map((await client.listTools()).tools.map(tool => [tool.name, tool.inputSchema]));
  const converted = toJsonSchemaCompat(keyed, { strictUnions: true, pipeStrategy: "input" });
  assert.deepEqual(listed.get(PRIMARY_ROUTE), { ...converted, properties: { ...converted.properties,
    rows: { description: "Rows are declared in full by the owner." } } }, "the projection of the SDK conversion is what is listed");
  assert.deepEqual(listed.get(PRIMARY_ROUTE), boundary.contracts.contractFor(PRIMARY_ROUTE).publishedRequestSchema(),
    "tools/list and the retained contract state one declaration");
  assert.deepEqual(listed.get(PLAIN_ROUTE), converted, "a registration without a projection lists the SDK conversion");
  assert.deepEqual(boundary.contracts.contractFor(PLAIN_ROUTE).publishedRequestSchema(), converted);

  const refused = await client.callTool({ name: PRIMARY_ROUTE,
    arguments: { unit: "WK-2520", rows: [{ key: "new", title: "T", unlisted: true }] } });
  assert.equal(refused.isError, true);
  assert.deepEqual(handled, []);
  const both = await client.callTool({ name: PRIMARY_ROUTE, arguments: { unit: "WK-2520", rows: [{ key: "new", id: 1, title: "T" }] } });
  assert.equal(both.isError, true);
  await client.callTool({ name: PRIMARY_ROUTE, arguments: { unit: "WK-2520", rows: [{ key: "new", title: "T" }, { id: 1 }] } });
  assert.deepEqual(handled, [{ unit: "WK-2520", rows: [{ key: "new", title: "T" }, { id: 1 }] }]);

  assert.throws(() => createBoundary().register({ description: "d", inputSchema: keyed, publishedInputSchemaProjection: {} }),
    /agent_tool_published_schema_projection_invalid/u);

  const late = await connected();
  late.server.registerTool("unmanaged", { description: "d" }, handler);
  const lateBoundary = createBoundary({ server: late.server });
  assert.throws(() => lateBoundary.register({ description: "d", inputSchema: keyed,
    publishedInputSchemaProjection: deferRows }), /agent_tool_published_schema_projection_unavailable/u);
});

test("compact advertisements preserve registrar authority and full validation", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const contract = createSaveRecordInputContract(z);
  const declaration = { description: "d", inputSchema: contract.inputSchema,
    advertisedInputSchema: contract.advertisedInputSchema,
    publishedInputSchemaProjection: contract.publishedInputSchemaProjection, inputSchemaExposure: saveExposure() };
  const server = new McpServer({ name: "compact", version: "1" });
  const client = new Client({ name: "reader", version: "1" });
  scope.add("compact server", () => server.close());
  scope.add("compact client", () => client.close());
  const boundary = createBoundary({ server });
  boundary.register(declaration);
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  const listed = (await client.listTools()).tools.find(tool => tool.name === PRIMARY_ROUTE).inputSchema;
  const retained = boundary.contracts.contractFor(PRIMARY_ROUTE);
  assert.deepEqual(listed, retained.publishedRequestSchema(), "tools/list and the retained contract state one declaration");

  const flat = toJsonSchemaCompat(contract.advertisedInputSchema, { strictUnions: true, pipeStrategy: "input" });
  const { changes: listedChanges, ...listedEnvelope } = listed.properties;
  const { changes: flatChanges, ...flatEnvelope } = flat.properties;
  assert.deepEqual([listedEnvelope, listed.required, listed.additionalProperties, listedChanges.description],
    [flatEnvelope, flat.required, flat.additionalProperties, flatChanges.description]);
  const published = { work_item_slice: 0, initiative: 1, decision: 2 };
  for (const [variant, index] of Object.entries(published)) {
    const source = SAVE_SOURCES[variant], compact = listedChanges.anyOf[index];
    assert.deepEqual(Object.keys(compact.properties), Object.keys(source.properties), `${variant}: every member, in owner order`);
    assert.deepEqual([compact.type, compact.additionalProperties, compact.minProperties], ["object", false, 1]);
    for (const [member, node] of Object.entries(compact.properties)) {
      const owner = source.properties[member];
      const deferred = Object.keys(node).every(keyword => keyword === "description");
      if (deferred) assert.equal(node.description, owner.description, `${variant}.${member}: deferred with the owner's description`);
      else assert.deepEqual(node, owner, `${variant}.${member}: a published member is the owner's complete declaration`);
    }
    assert.equal(JSON.stringify(compact).includes("$ref") || Object.hasOwn(compact, "$defs"), false);
  }
  assert.deepEqual(Object.entries(listedChanges.anyOf[0].properties).filter(([, node]) => Object.keys(node).length > 0 &&
    !Object.keys(node).every(keyword => keyword === "description")).map(([member]) => member),
  ["title", "priority", "base_branch", "owner", "initiative", "work_kind", "target_unit", "agent_role",
    "expected_changed_line_budget", "status"], "exactly the scalar members stay typed");
  const bytes = { flat: Buffer.byteLength(JSON.stringify(flat)), compact: Buffer.byteLength(JSON.stringify(listed)) };
  assert.ok(bytes.compact * 8 < bytes.flat, JSON.stringify(bytes));

  const Ajv = createRequire(import.meta.url)("ajv");
  const admits = new Ajv({ strict: false, allErrors: true }).compile(listed);
  const revision = `sha256:${"a".repeat(64)}`;
  const ownerValid = [
    { unit: "WK-0001", revision, changes: { title: "T", notes: "N", tasks: [{ action: "append_todo", value: "t" }] } },
    { unit: "WK-0001", revision, changes: { criteria: [{ key: "criterion", text: "Meaning." }, { id: "criterion-a" }],
      entries: [{ key: "design", title: "Design", content: { text: "Body." } }, { id: 1, title: "Retitled" }],
      controlled_acceptance: { disposition: "required" },
      obligations: [{ key: "proof", statement: "S", criteria: ["$criterion"], proof: { name: "p", parameters: { any: [1, { open: true }] } } }] } },
    { unit: "WK-0001#SLICE-001", revision, changes: { work_kind: "implementation", expected_changed_line_budget: 3, priority: "high" } },
    { unit: "IN-0001", revision, changes: { title: "Initiative", summary: "S" } },
    { unit: "DEC-0001", revision, changes: { title: "Decision" } },
    { unit: "WK-0001", maintenance_retry: { save_result: { ref_id: "aB3_dE9x" } } }];
  for (const request of ownerValid) {
    assert.equal(contract.inputSchema.safeParse(request).success, true, `owner-valid: ${JSON.stringify(request)}`);
    assert.equal(admits(request), true, `admitted by the compact declaration: ${JSON.stringify(request)}`);
  }

  for (const request of [{ unit: "WK-0001", revision, changes: { no_such_member: 1 } },
    { unit: "WK-0001", revision, changes: { priority: "urgent" } }, { unit: "WK-0001", revision, changes: {}, extra: 1 }]) {
    assert.equal(admits(request), false, JSON.stringify(request));
  }

  const handler = (args) => client.callTool({ name: PRIMARY_ROUTE, arguments: args });
  for (const changes of [{ entries: [{ id: 1, content: { texts: "x" } }] }, { criteria: [{ key: "INVALID LABEL", text: "t" }] },
    { obligations: [{ key: "proof", case: { key: "case", unavailable: true } }] }, { notes: 7 }]) {
    const request = { unit: "WK-0001", revision, changes };
    assert.equal(admits(request), true, `the compact declaration admits it: ${JSON.stringify(changes)}`);
    assert.equal(await retained.acceptsArguments(request), false, JSON.stringify(changes));
    assert.equal((await handler(request)).isError, true, JSON.stringify(changes));
  }
  assert.deepEqual(boundary.calls, [], "no refused request reached the handler");
  const valid = { unit: "WK-0001", revision, changes: { criteria: [{ key: "criterion", text: "Meaning." }],
    entries: [{ id: 1, title: "Retitled" }] } };
  assert.equal(await retained.acceptsArguments(valid), true);
  assert.notEqual((await handler(valid)).isError, true);
  assert.deepEqual(boundary.calls, [valid], "the first call is the save itself");

  assert.equal(retained.inputSchemaExposure.source("work_item_slice").select({ members: ["obligations"] }).schema.properties.obligations,
    SAVE_SOURCES.work_item_slice.properties.obligations);

  const hidden = createBoundary({ toolProfile: "reviewer" });
  hidden.register(declaration);
  assert.deepEqual([hidden.registered.size, hidden.contracts.contractFor(PRIMARY_ROUTE)], [0, null]);
  const failed = createBoundary({ server: { registerTool() { throw new Error("sdk refused registration"); } } });
  assert.throws(() => failed.register(declaration), /sdk refused registration/u);
  assert.equal(failed.contracts.contractFor(PRIMARY_ROUTE), null);
  assert.equal(createBoundary().contracts.contractFor(PRIMARY_ROUTE), null, "another registrar holds no declaration of this one");
});

test("hidden, skipped and failed registrations lend no contract, and registrars stay isolated", async () => {
  const hidden = createBoundary({ toolProfile: "reviewer" });
  hidden.register({ description: "d", inputSchema: AUTHORITATIVE });
  assert.equal(hidden.registered.size, 0);
  assert.equal(hidden.contracts.contractFor(PRIMARY_ROUTE), null);

  const skipped = createBoundary({ registeredTier: "free_local", freeLocalToolNames: [] });
  skipped.register({ description: "d", inputSchema: AUTHORITATIVE });
  assert.equal(skipped.registered.size, 0);
  assert.equal(skipped.contracts.contractFor(PRIMARY_ROUTE), null);

  const invalid = createBoundary();
  assert.throws(() => invalid.register({ description: "", inputSchema: AUTHORITATIVE }),
    /agent_tool_description_missing/u);
  assert.equal(invalid.contracts.contractFor(PRIMARY_ROUTE), null);

  const refused = createBoundary({ server: { registerTool() { throw new Error("sdk refused registration"); } } });
  assert.throws(() => refused.register({ description: "d", inputSchema: AUTHORITATIVE }), /sdk refused registration/u);
  assert.equal(refused.contracts.contractFor(PRIMARY_ROUTE), null);

  const first = createBoundary({ toolName: PLAIN_ROUTE });
  const second = createBoundary({ toolName: PLAIN_ROUTE });
  const lookupObtainedBeforeRegistration = second.contracts;
  first.register({ description: "d", inputSchema: z.object({ unit: z.string() }).strict() });
  assert.equal(lookupObtainedBeforeRegistration.contractFor(PLAIN_ROUTE), null,
    "another registrar's registration is invisible");
  second.register({ description: "d", inputSchema: z.object({ id: z.string() }).strict() });
  assert.deepEqual(Object.keys(first.contracts.contractFor(PLAIN_ROUTE).publishedRequestSchema().properties), ["unit"]);
  assert.deepEqual(
    Object.keys(lookupObtainedBeforeRegistration.contractFor(PLAIN_ROUTE).publishedRequestSchema().properties),
    ["id"], "a registration after the lookup was obtained resolves at request time");
  assert.equal(registeredToolRequestContracts((...args) => second.registerTool(...args)), null,
    "a wrapped registrar has no contracts of its own");
});

test("a conflicting registration withdraws the retained contract instead of leaving it cached", () => {
  const boundary = createBoundary({ toolName: PLAIN_ROUTE });
  const original = z.object({ unit: z.string() }).strict();
  boundary.register({ description: "d", inputSchema: original });
  assert.ok(boundary.contracts.contractFor(PLAIN_ROUTE).publishedRequestSchema());
  assert.throws(() => boundary.register({ description: "d", inputSchema: z.object({ id: z.string() }).strict() }),
    (error) => error.code === CONFLICT);
  assert.equal(boundary.contracts.contractFor(PLAIN_ROUTE), null);
  assert.throws(() => boundary.register({ description: "d", inputSchema: original }),
    (error) => error.code === CONFLICT);
  assert.equal(boundary.contracts.contractFor(PLAIN_ROUTE), null);
});

const SAVE_SOURCES = createSaveRecordInputContract(z).changeSchemas;
const saveExposure = (changeSchemas = SAVE_SOURCES) => createSaveRecordInputExposure({ changeSchemas,
  variants: ["WK-0001", "WK-0001#SLICE-001", "IN-0001", "DEC-0001"].map(unit => saveRecordUnitVariant(unit)) });

test("a declared input schema exposure is bound with a successful registration and decides nothing", async () => {
  const boundary = createBoundary();
  const declared = { description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
    inputSchemaExposure: saveExposure() };
  boundary.register(declared);
  const { config, handler } = boundary.registered.get(PRIMARY_ROUTE);
  assert.equal(Object.hasOwn(config, "inputSchemaExposure"), false, "the declaration never reaches the SDK");
  const contract = boundary.contracts.contractFor(PRIMARY_ROUTE);
  const selected = contract.inputSchemaExposure.source("work_item").select({ groups: ["acceptance"], members: ["title"] });
  assert.deepEqual(selected.members, ["title", "criteria", "requirements", "obligations", "controlled_acceptance"]);
  assert.equal(selected.schema.properties.obligations, SAVE_SOURCES.work_item.properties.obligations);

  const without = createBoundary();
  without.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  assert.deepEqual(contract.publishedRequestSchema(), without.contracts.contractFor(PRIMARY_ROUTE).publishedRequestSchema());
  assert.equal(without.contracts.contractFor(PRIMARY_ROUTE).inputSchemaExposure, null);
  assert.equal(await contract.acceptsArguments({ unit: "WK-2520", answer: { kind: "wording" } }), false);
  const refused = await handler({ unit: "WK-2520", answer: { kind: "wording" } });
  assert.deepEqual([refused.isError, refused.structuredContent.diagnostic.code], [true, "tool_input_validation_failed"]);
  assert.deepEqual(boundary.calls, [], "the full validator refuses before the handler, whatever a selection disclosed");

  boundary.register({ ...declared, inputSchemaExposure: saveExposure() });
  assert.equal(boundary.contracts.contractFor(PRIMARY_ROUTE), contract);
});

test("an input schema exposure is lent by no hidden, invalid, failed or conflicting registration", () => {
  const declared = { description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
    inputSchemaExposure: saveExposure() };
  const hidden = createBoundary({ toolProfile: "reviewer" });
  hidden.register(declared);
  assert.equal(hidden.contracts.contractFor(PRIMARY_ROUTE), null);

  const invalid = createBoundary();
  const { groups } = declared.inputSchemaExposure.sources.work_item;
  assert.throws(() => invalid.register({ ...declared, inputSchemaExposure: { ...declared.inputSchemaExposure,
    sources: { ...declared.inputSchemaExposure.sources,
      work_item: { ...declared.inputSchemaExposure.sources.work_item, groups: groups.slice(1) } } } }),
  (error) => error.code === INPUT_SCHEMA_EXPOSURE_CODES.MEMBER_UNASSIGNED);
  assert.equal(invalid.registered.size, 0);
  assert.equal(invalid.contracts.contractFor(PRIMARY_ROUTE), null);

  const failed = createBoundary({ server: { registerTool() { throw new Error("sdk refused registration"); } } });
  assert.throws(() => failed.register(declared), /sdk refused registration/u);
  assert.equal(failed.contracts.contractFor(PRIMARY_ROUTE), null);

  const first = createBoundary(), second = createBoundary();
  first.register(declared);
  assert.equal(second.contracts.contractFor(PRIMARY_ROUTE), null);
  second.register(declared);
  assert.notEqual(first.contracts.contractFor(PRIMARY_ROUTE).inputSchemaExposure,
    second.contracts.contractFor(PRIMARY_ROUTE).inputSchemaExposure);

  const changedSource = JSON.parse(JSON.stringify(SAVE_SOURCES.work_item));
  changedSource.properties.title = { type: "string", maxLength: 8 };
  assert.throws(() => first.register({ ...declared, inputSchemaExposure: saveExposure({ ...SAVE_SOURCES, work_item: changedSource }) }),
    (error) => error.code === CONFLICT);
  assert.equal(first.contracts.contractFor(PRIMARY_ROUTE), null);
  assert.throws(() => second.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED }),
    (error) => error.code === CONFLICT, "dropping the declaration is a different contract");
  assert.equal(second.contracts.contractFor(PRIMARY_ROUTE), null);
});

const GENERATED = z.object({
  mode: z.enum(["scan", "read"]), count: z.number().int().max(3), label: z.string(),
  choice: z.union([z.object({ id: z.string() }).strict(), z.object({ name: z.string().min(2) }).strict()])
}).strict().superRefine(() => {});
const asJson = value => JSON.parse(JSON.stringify(value));

test("an ordinary input failure carries the schema's own enum options, types, bounds and union branches", async () => {
  const { register, registered, calls } = createBoundary({ toolName: REFINED_ROUTE });
  register({ description: "d", inputSchema: GENERATED });
  const args = { mode: "write", count: 9, label: 7, choice: { name: 5 } };
  const supplied = structuredClone(args);
  const validationError = GENERATED.safeParse(supplied).error;

  const result = await registered.get(REFINED_ROUTE).handler(args);

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    ok: false,
    diagnostic: {
      code: "tool_input_validation_failed",
      severity: "error",
      authority_limb: "mechanical_failure",
      message: `${REFINED_ROUTE}: ${validationError.message}`,
      tool: REFINED_ROUTE,
      rejected_field_paths: ["$.mode", "$.count", "$.label", "$.choice"],
      validator_diagnostics: asJson(validationError.issues)
    }
  }, "the failure is the generated diagnostic alone: no retry, substitute or reduced result");
  const byCode = Object.fromEntries(result.structuredContent.diagnostic.validator_diagnostics
    .map((issue) => [issue.code, issue]));
  assert.deepEqual(byCode.invalid_enum_value.options, ["scan", "read"]);
  assert.equal(byCode.too_big.maximum, 3);
  assert.deepEqual([byCode.invalid_type.expected, byCode.invalid_type.received], ["string", "number"]);
  assert.deepEqual(byCode.invalid_union.unionErrors.map(({ issues }) => issues[0].path),
    [["choice", "id"], ["choice", "name"]], "every union branch's errors are retained");
  assert.deepEqual(args, supplied, "the supplied request is not rewritten");
  assert.deepEqual(calls, [], "invalid input never reaches the downstream handler");
});

test("a throwing validator or projector, or an unrecognized projector result, stays an internal failure", async () => {
  const bad = { unit: "WK-2520", answer: "bad" };
  for (const config of [
    { inputSchema: z.object({ unit: z.string() }).strict().superRefine(() => {
      throw new Error("validator exploded");
    }) },
    { inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
      inputValidationErrorProjector() { throw new Error("projector exploded"); } },
    { inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
      inputValidationErrorProjector: () => ({}) }
  ]) {
    const { register, registered, calls, toolName } = createBoundary();
    register({ description: "d", ...config });
    const result = await registered.get(toolName).handler(bad);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, "mcp_response.handler_exception.v1", errorTextOf(result));
    assert.equal(errorTextOf(result).includes("tool_input_validation_failed"), false);
    assert.deepEqual(calls, []);
  }
});

test("an oversized generated failure is retrieved completely through the existing spill transport", async () => {
  const scope = createTestResourceScope();
  try {
    const stateDir = await scope.acquire("spill-directory",
      () => mkdtemp(path.join(tmpdir(), "tool-input-failure-spill-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const env = { WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192", WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    const schema = z.object({ rows: z.array(z.union([
      z.object({ id: z.string().min(40) }).strict(),
      z.object({ name: z.enum(["alpha", "beta"]) }).strict()
    ])) }).strict();
    const validationError = schema.safeParse({
      rows: Array.from({ length: 60 }, (_, index) => ({ id: index }))
    }).error;
    const error = createToolInputValidationError({ tool: REFINED_ROUTE, validationError });

    const result = errorContent(error, { env });

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.response_spilled, true);
    const reference = result.structuredContent.content_reference;
    const chunks = [];
    for (let offset = 0; ;) {
      const chunk = readSpilledMcpContentReference({
        ref_id: reference.ref_id, offset, length: reference.range.max_length
      }, { env });
      chunks.push(Buffer.from(chunk.data_base64, "base64"));
      if (chunk.eof) break;
      offset = chunk.next_offset;
    }
    const recovered = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.deepEqual(recovered, asJson(error.envelope));
    assert.equal(recovered.diagnostic.validator_diagnostics.length, 60);
    assert.equal(recovered.diagnostic.validator_diagnostics[59].unionErrors.length, 2);
  } finally {
    await scope.dispose();
  }
});

test("the registered final guard uses the injected response environment for formed results and throws", async (t) => {
  const scope = createTestResourceScope({ label: "register-tool-response-env" });
  t.after(() => scope.dispose());
  const root = (label) => scope.acquire(label, () => mkdtemp(path.join(tmpdir(), "wk2716-guard-")),
    (dir) => rm(dir, { recursive: true, force: true }));
  const injected = await root("injected response state");
  const ambient = await root("ambient response state");
  const priorStateDir = process.env.WIKI_MCP_RESPONSE_STATE_DIR;
  const priorLimit = process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT;
  process.env.WIKI_MCP_RESPONSE_STATE_DIR = ambient;
  delete process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT;
  t.after(() => {
    if (priorStateDir === undefined) delete process.env.WIKI_MCP_RESPONSE_STATE_DIR;
    else process.env.WIKI_MCP_RESPONSE_STATE_DIR = priorStateDir;
    if (priorLimit !== undefined) process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = priorLimit;
  });
  const responseEnv = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: injected,
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192" };
  const large = "w".repeat(20_000);
  const cases = [

    ["formed", () => ({ content: [], structuredContent: { ok: true, value: large } })],

    ["thrown", () => { throw new Error(large); }]
  ];
  for (const [label, respond] of cases) {
    const boundary = createBoundary({ responseEnv, respond });
    boundary.register({ description: "Guarded route.", inputSchema: z.object({}).strict() });
    const before = readdirSync(injected).length;
    const result = await boundary.registered.get(boundary.toolName).handler({});
    assert.equal(result.structuredContent.response_spilled, true, `${label}: ${JSON.stringify(result).slice(0, 300)}`);
    assert.equal(result.structuredContent.inline_byte_limit, 8192, label);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 8192, label);
    assert.equal(readdirSync(injected).length > before, true, `${label}: retained in the injected root`);
    assert.deepEqual(readdirSync(ambient), [], `${label}: nothing written to the ambient root`);

    const read = readSpilledMcpContentReference(
      { ref_id: result.structuredContent.content_reference.ref_id }, { env: responseEnv });
    assert.equal(read.ref_id, result.structuredContent.content_reference.ref_id, label);
    assert.throws(() => readSpilledMcpContentReference(
      { ref_id: result.structuredContent.content_reference.ref_id }), undefined, label);
  }
});
