

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  createRegisterTool,
  createToolInputValidationError,
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  projectMcpCallableOwnerIssues
} from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import {
  errorContent,
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

const PRIMARY_ROUTE = "workspace_controlled_contract_obligation_coverage_upsert";
const PLAIN_ROUTE = "workspace_controlled_contract_obligation_coverage_query";
const UNENFORCEABLE_ROUTE = "workspace_controlled_contract_obligation_coverage_remove";
const REFINED_ROUTE = "workspace_validate_proof";

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

test("request-location guidance bindings are checked when a compact route registers", () => {
  const guidance = { overview: "Answer with a kind.", shapes: { answer: { required_fields: ["kind"] } } };
  const registerWith = (locations) => createBoundary().register({
    description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED,
    inputContractAuthoringGuidance: guidance, inputContractRequestGuidanceLocations: locations
  });
  assert.throws(() => registerWith([{ path: ["answer"], guidance_path: ["shapes", "missing"] }]),
    /tool_input_guidance_reference_unresolved/u);
  assert.throws(() => registerWith([
    { path: ["answer"], guidance_path: ["shapes", "answer"] },
    { path: ["answer"], guidance_path: ["overview"] }
  ]), /tool_input_guidance_request_locations_invalid/u);
  assert.throws(() => createBoundary().register({ description: "d", inputSchema: AUTHORITATIVE,
    advertisedInputSchema: ADVERTISED,
    inputContractRequestGuidanceLocations: [{ path: ["answer"], guidance_path: ["overview"] }] }),
  /tool_input_guidance_request_locations_invalid/u);
  registerWith([{ path: ["answer"], guidance_path: ["shapes", "answer"] }]);
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

test("a compact route with registered guidance serves an overview locator and callable references instead of the body", () => {
  const toolName = PRIMARY_ROUTE;
  const guidance = { schema_version: "fixture-guidance.v1",
    overview: "Answer with a wording statement or skip.", vocabulary: { kinds: ["wording", "skip"] } };
  const digest = toolInputGuidanceDigest(toolName, guidance);
  const { register } = createBoundary({ toolName });
  register({
    description: "d",
    inputSchema: AUTHORITATIVE,
    advertisedInputSchema: ADVERTISED,
    inputContractAuthoringGuidance: guidance,
    inputContractUnprojectedConstraints: [{
      path: "$.answer", reason: "owner_validated_semantic_constraints", guidance_path: ["vocabulary"]
    }]
  });

  const contract = completeToolInputContract(toolName);
  assert.equal(Object.hasOwn(contract, "authoring_guidance"), false,
    "the complete structural contract no longer inlines the guidance body");
  assert.equal(JSON.stringify(contract).includes("skip\"]"), false);
  const locator = contract.authoring_guidance_locator;
  assert.deepEqual(Object.keys(locator), ["call"], "the locator is one call and nothing to reconcile");
  assert.equal(locator.call.tool, "workspace_tools_describe");
  assert.deepEqual(locator.call.arguments,
    { tool_name: toolName, input_contract: { kind: "guidance", path: ["overview"],
      expected_source_digest: digest } });
  const declared = contract.unprojected.find((row) => row.path === "$.answer");
  assert.equal(Object.hasOwn(declared, "guidance_path"), false);
  assert.deepEqual(declared.guidance_call.arguments.input_contract.path, ["vocabulary"]);
  assert.equal(declared.guidance_call.arguments.input_contract.expected_source_digest, digest);

  const deliver = (selector) => deliverToolInputGuidance({ toolName, guidance, selector });
  const overview = { ok: true, source_digest: digest, value: guidance.overview };
  assert.deepEqual(deliver(locator.call.arguments.input_contract), overview);
  assert.deepEqual(deliver({ kind: "guidance" }), overview);
  assert.deepEqual(deliver({ kind: "guidance", path: [] }), { ok: true, source_digest: digest, value: guidance });
  assert.deepEqual(deliver({ kind: "guidance", path: ["vocabulary", "kinds", "1"] }).value, "skip");

  const stale = deliver({ kind: "guidance", path: ["vocabulary"], expected_source_digest: `sha256:${"0".repeat(64)}` });
  assert.equal(stale.diagnostic.code, TOOL_INPUT_GUIDANCE_CODES.STALE_SOURCE);
  assert.equal(stale.diagnostic.authority_limb, "mechanical_failure");
  assert.deepEqual(stale.next_calls[0].arguments.input_contract,
    { kind: "guidance", path: ["vocabulary"], expected_source_digest: digest });
  const unresolvedStale = deliver({ kind: "guidance", path: ["vocabulary", "gone"],
    expected_source_digest: `sha256:${"0".repeat(64)}` });
  assert.equal(unresolvedStale.diagnostic.code, TOOL_INPUT_GUIDANCE_CODES.STALE_SOURCE,
    "staleness is reported before an unresolvable path");
  assert.deepEqual(unresolvedStale.next_calls[0].arguments.input_contract.path, ["vocabulary"]);
  const invalid = deliver({ kind: "guidance", path: ["vocabulary", "kinds", "01"] });
  assert.equal(invalid.diagnostic.code, TOOL_INPUT_GUIDANCE_CODES.INVALID_PATH);
  assert.deepEqual(invalid.next_calls[0].arguments.input_contract.path, ["vocabulary", "kinds"]);

  const { register: registerUnresolved } = createBoundary({ toolName });
  assert.throws(() => {
    registerUnresolved({
      description: "d",
      inputSchema: AUTHORITATIVE,
      advertisedInputSchema: ADVERTISED,
      inputContractAuthoringGuidance: guidance,
      inputContractUnprojectedConstraints: [{
        path: "$.answer", reason: "owner_validated_semantic_constraints", guidance_path: ["missing"]
      }]
    });
    completeToolInputContract(toolName);
  }, /tool_input_guidance_reference_unresolved/u);

  for (const malformed of [
    { vocabulary: guidance.vocabulary },
    { overview: "" },
    { overview: "   " },
    { overview: ["Answer with a wording statement."] },
    ["overview"],
    "overview"
  ]) {
    const { register: registerMalformed } = createBoundary({ toolName });
    assert.throws(() => registerMalformed({
      description: "d",
      inputSchema: AUTHORITATIVE,
      advertisedInputSchema: ADVERTISED,
      inputContractAuthoringGuidance: malformed
    }), /tool_input_guidance_overview_required/u, JSON.stringify(malformed));
  }
});

const DESCRIBE_ROUTE = "workspace_tools_describe";
const DESCRIPTOR = await loadToolDiscoveryDescriptor();
const { CONFLICT, PROJECTION_UNAVAILABLE } = REGISTERED_TOOL_REQUEST_CONTRACT_CODES;
const { REQUEST_CONTRACT_INVALID, REQUEST_SCHEMA_UNAVAILABLE } = TOOL_ROUTER_PRODUCER_ERROR_CODES;

function fixtureVocabulary(recommendedFirstTool) {
  return {
    router_result_states: { unknown: { bounded_unsupported_intent_guidance: { guidance: [] } } },
    intents: [{
      intent: "fixture_route",
      match_phrases: ["fixture route"],
      recommended_first_tool: recommendedFirstTool
    }]
  };
}

function recommend(input, recommendedFirstTool, { descriptor = DESCRIPTOR, requestContracts }) {
  return recommendToolRouteFromVocabulary(input, fixtureVocabulary(recommendedFirstTool), {
    descriptor,
    completeDescriptor: DESCRIPTOR,
    requestContracts
  });
}

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

test("full-schema acceptance rejects malformed obligation-coverage input despite the owner's refusal wrapper", async () => {
  const boundary = createBoundary({ toolNames: CONTROLLED_CONTRACT_MCP_TOOL_NAMES });
  const handlerCalls = [];
  const inert = (label) => () => {
    throw new Error(`${label} must not run during a contract check`);
  };
  const registry = registerControlledContractTools({
    registerTool: (name, config, handler) => boundary.registerTool(name, config, async (...args) => {
      handlerCalls.push(name);
      return handler(...args);
    }),
    workspaceRepos: null,
    z,
    jsonContent: inert("jsonContent"),
    errorContent: inert("errorContent"),
    resolveWorkspaceRepo: inert("resolveWorkspaceRepo"),
    resolveControlledContractGenerationBinding: inert("generation binding"),
    persistControlledContractGeneration: inert("generation persistence")
  });

  const markedMalformed = async (name, args) => {
    const parsed = await registry.find((entry) => entry.name === name).config.inputSchema.safeParseAsync(args);
    assert.equal(parsed.success, true, `${name} wrapper reports success`);
    return Object.getOwnPropertySymbols(parsed.data).length > 0;
  };
  const duplicateRetirement = {
    unit: "WK-2643",
    expected_content_digest: null,
    contract_requirements: { retire_claim_ids: ["claim-a", "claim-a"] }
  };
  const cases = [
    [PRIMARY_ROUTE, duplicateRetirement, false],
    [PRIMARY_ROUTE, { ...duplicateRetirement, contract_requirements: { retire_claim_ids: ["claim-a"] } }, true],
    [PLAIN_ROUTE, { unit: "not-a-unit" }, false],
    [PLAIN_ROUTE, { unit: "WK-2643" }, true]
  ];
  for (const [name, args, valid] of cases) {
    const label = `${name} ${JSON.stringify(args)}`;
    assert.equal(await markedMalformed(name, args), !valid, label);
    assert.equal(await boundary.contracts.contractFor(name).acceptsArguments(args), valid, label);
  }
  assert.deepEqual(requestContractErrors(PRIMARY_ROUTE, duplicateRetirement,
    boundary.contracts.contractFor(PRIMARY_ROUTE).publishedRequestSchema()), [],
  "the compact published upsert shape admits the nested duplicate the full schema rejects");
  assert.deepEqual(handlerCalls, [], "no obligation-coverage handler runs");
});

test("a router call the compact declaration admits but the full contract refuses never becomes executable", async () => {
  const boundary = createBoundary({ toolNames: [PRIMARY_ROUTE, PLAIN_ROUTE] });
  boundary.register({ description: "d", inputSchema: AUTHORITATIVE, advertisedInputSchema: ADVERTISED });
  boundary.registerTool(PLAIN_ROUTE, { description: "d", inputSchema: z.object({ unit: z.string() }) },
    boundary.handler);
  const requestContracts = boundary.contracts;
  const task = { task_description: "fixture route WK-2520" };

  const accepted = await recommend(task,
    { name: PRIMARY_ROUTE, arguments: { unit: "WK-2520", answer: { kind: "skip" } } }, { requestContracts });
  assert.deepEqual(accepted.next_calls,
    [{ tool: PRIMARY_ROUTE, arguments: { unit: "WK-2520", answer: { kind: "skip" } }, recommended: true }]);

  for (const args of [
    { unit: "WK-2520", answer: { kind: "wording" } },
    { unit: "WK-2520", answer: { kind: "skip" }, cursor: "c1" }
  ]) {
    await assert.rejects(recommend(task, { name: PRIMARY_ROUTE, arguments: args }, { requestContracts }), {
      code: REQUEST_CONTRACT_INVALID,
      message: `${REQUEST_CONTRACT_INVALID}: ${PRIMARY_ROUTE} (full_input_schema)`
    });
  }

  const strayField = { unit: "WK-2520", stray: "value" };
  assert.equal(await requestContracts.contractFor(PLAIN_ROUTE).acceptsArguments(strayField), true,
    "the parser alone would strip the undeclared field");
  await assert.rejects(recommend(task, { name: PLAIN_ROUTE, arguments: strayField }, { requestContracts }), {
    code: REQUEST_CONTRACT_INVALID,
    message: `${REQUEST_CONTRACT_INVALID}: ${PLAIN_ROUTE} (published_request_schema)`
  });

  for (const absent of [null, createBoundary({ toolName: REFINED_ROUTE }).contracts]) {
    await assert.rejects(recommend(task, { name: PRIMARY_ROUTE, arguments: { unit: "WK-2520" } },
      { requestContracts: absent }), {
      code: REQUEST_SCHEMA_UNAVAILABLE,
      message: `${REQUEST_SCHEMA_UNAVAILABLE}: ${PRIMARY_ROUTE} (registration)`
    });
  }

  const partial = await recommend({ task_description: "fixture route" },
    { name: PRIMARY_ROUTE, arguments: { unit: "$unit_if_known" } }, { requestContracts });
  assert.equal(partial.result_state, "matched");
  assert.equal(partial.operation, PRIMARY_ROUTE);
  assert.deepEqual(partial.required_authored_fields, ["unit"]);
  assert.deepEqual(partial.next_calls, []);
  assert.equal(partial.next_calls_completeness.complete_total, 0);
  assert.deepEqual(boundary.calls, [], "no target handler runs");
});

const LARGE_SCHEMA_MARKER = "large_schema_sentinel";

function smallFullSchema() {
  return z.object({
    unit: z.string().regex(/^WK-[0-9]{4}$/u),
    answer: z.object({ kind: z.string() }).strict().optional()
  }).strict();
}

function largeFullSchema() {
  return z.object({
    unit: z.string().regex(/^WK-[0-9]{4}$/u),
    answer: z.discriminatedUnion("kind", Array.from({ length: 80 }, (_, index) => z.object({
      kind: z.literal(`${LARGE_SCHEMA_MARKER}_kind_${index}`),
      [`${LARGE_SCHEMA_MARKER}_field_${index}`]: z.string().min(1).describe(`${LARGE_SCHEMA_MARKER} ${index}`)
    }).strict())).optional()
  }).strict();
}

function compactDeclaration() {
  return z.object({
    unit: z.string(),
    answer: z.object({ kind: z.string() }).passthrough().optional()
  }).strict();
}

function observedContracts(contracts) {
  const looked = [];
  const projected = [];
  return {
    looked,
    projected,
    requestContracts: {
      contractFor(name) {
        looked.push(name);
        const contract = contracts.contractFor(name);
        return contract && {
          publishedRequestSchema() {
            projected.push(name);
            return contract.publishedRequestSchema();
          },
          acceptsArguments: (args) => contract.acceptsArguments(args)
        };
      }
    }
  };
}

async function routineRouterResponses(fullSchema) {
  const boundary = createBoundary({ toolNames: [PRIMARY_ROUTE, PLAIN_ROUTE, DESCRIBE_ROUTE] });
  boundary.register({ description: "d", inputSchema: fullSchema, advertisedInputSchema: compactDeclaration() });
  boundary.registerTool(PLAIN_ROUTE, { description: "d", inputSchema: largeFullSchema() }, boundary.handler);
  boundary.registerTool(DESCRIBE_ROUTE, { description: "d", inputSchema: WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA },
    boundary.handler);
  const observed = observedContracts(boundary.contracts);
  const context = { requestContracts: observed.requestContracts };
  const complete = { name: PRIMARY_ROUTE, arguments: { unit: "$unit_if_known" } };
  const responses = {
    matched: await recommend({ task_description: "fixture route WK-2520" }, complete, context),
    repeated: await recommend({ task_description: "fixture route WK-2520" }, complete, context),
    partial: await recommend({ task_description: "fixture route" },
      { ...complete, required_authored_fields: ["answer_choice"] }, context),
    recovery: await recommend({ task_description: "an unrelated request", known_resources: { tool_name: PRIMARY_ROUTE } },
      complete, context),
    error: await recommend({ task_description: "fixture route" },
      { name: PRIMARY_ROUTE, arguments: { unit: "not-a-work-record" } }, context)
      .then(() => null, ({ code, message }) => ({ code, message }))
  };
  return { responses, observed, boundary, complete };
}

test("routine router output neither embeds nor grows with a large full schema", async () => {
  const small = await routineRouterResponses(smallFullSchema());
  const large = await routineRouterResponses(largeFullSchema());
  assert.deepEqual(small.responses.partial.required_authored_fields, ["answer_choice", "unit"]);
  assert.equal(small.responses.recovery.recovery.state, "callable");
  assert.deepEqual(small.responses.error,
    { code: REQUEST_CONTRACT_INVALID, message: `${REQUEST_CONTRACT_INVALID}: ${PRIMARY_ROUTE} (full_input_schema)` });

  const largeText = JSON.stringify(large.responses);
  assert.equal(largeText, JSON.stringify(small.responses), "output depends on selected guidance, not schema size");
  for (const marker of [LARGE_SCHEMA_MARKER, "\"properties\"", "\"additionalProperties\"", "\"anyOf\""]) {
    assert.equal(largeText.includes(marker), false, marker);
  }
  assert.deepEqual([...new Set(large.observed.looked)].sort(), [PRIMARY_ROUTE, DESCRIBE_ROUTE].sort(),
    "only selected tools are looked up");
  assert.equal(large.observed.projected.includes(PLAIN_ROUTE), false, "an unrelated large schema is never projected");
  assert.match(JSON.stringify(completeToolInputContract(PRIMARY_ROUTE)), new RegExp(LARGE_SCHEMA_MARKER, "u"),
    "explicit selected-tool retrieval still serves the complete contract");

  const hiddenObserved = observedContracts(large.boundary.contracts);
  const hidden = await recommend({ task_description: "fixture route WK-2520" }, large.complete, {
    descriptor: { ...DESCRIPTOR, tools: DESCRIPTOR.tools.filter(({ tool_name: name }) => name !== PRIMARY_ROUTE) },
    requestContracts: hiddenObserved.requestContracts
  });
  assert.equal(hidden.result_state, "visibility_withheld");
  assert.deepEqual(hiddenObserved.looked, [], "a hidden target is never looked up");
  assert.deepEqual(large.boundary.calls, [], "no target handler runs");
});

const GENERATED = z.object({
  mode: z.enum(["scan", "read"]),
  count: z.number().int().max(3),
  label: z.string(),
  choice: z.union([
    z.object({ id: z.string() }).strict(),
    z.object({ name: z.string().min(2) }).strict()
  ])
}).strict().superRefine(() => {});

const asJson = (value) => JSON.parse(JSON.stringify(value));

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
