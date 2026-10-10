import {
  SIDECAR_ENVELOPE_REQUIRED_FIELDS,
  assertValidSidecarResultEnvelope,
  cloneSidecarTrustEnvelopeFixture
} from "./sidecar-schema.mjs";

export const SIDECAR_PARITY_TRANSPORTS = Object.freeze([
  "cli_json",
  "mcp_structured_content"
]);

export const SIDECAR_PARITY_SURFACE_EXPECTATIONS = Object.freeze({
  status: Object.freeze({
    owner: "WK-0035",
    cliCommand: "code-index status --json",
    mcpTool: "query_code_index",
    inputContract: "the CLI accepts repository/cache selection inputs owned by WK-0035; MCP takes status:true alone for the current repository",
    outputContract: "the MCP compact status envelope states the same publication, HEAD and freshness facts as the CLI sidecar result envelope",
    parityTestOwner: "WK-0035"
  }),
  build: Object.freeze({
    owner: "WK-0042",
    cliCommand: "code-index build --json",
    mcpTool: "workspace_code_index_build",
    inputContract: "build accepts explicit writer inputs owned by WK-0042",
    outputContract: "CLI JSON and MCP structuredContent must be the same sidecar result envelope",
    parityTestOwner: "WK-0042"
  }),
  impact: Object.freeze({
    owner: "WK-2535",
    cliCommand: "code-index impact --json",
    mcpTool: "query_code_index",
    inputContract: "impact accepts exactly one paths, patch, parsed diff or live Git subject",
    outputContract: "the MCP retained original must be the same sidecar result envelope as CLI JSON; its response is the compact summary",
    parityTestOwner: "WK-2535"
  }),
  context_for_path: Object.freeze({
    owner: "WK-0041",
    cliCommand: "code-index context-for-path --json",
    mcpTool: "query_code_index",
    inputContract: "context path inputs are owned by WK-0041 and path validation prerequisites",
    outputContract: "the MCP retained original must be the same sidecar result envelope as CLI JSON; its response is the compact summary",
    parityTestOwner: "WK-0041"
  })
});

export const SIDECAR_PARITY_REQUIRED_TRUST_FIELDS = SIDECAR_ENVELOPE_REQUIRED_FIELDS;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonKeys(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonKeys(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(sortJsonKeys(value));
}

function withoutPreparation(envelope) {
  const { preparation: _preparation, ...rest } = envelope;
  return rest;
}

function parseCliJson(cliJson) {
  if (typeof cliJson === "string") {
    try {
      return JSON.parse(cliJson);
    } catch (error) {
      throw new Error(
        `Sidecar CLI JSON output must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return cliJson;
}

function requireKnownSurface(surface) {
  const expectation = SIDECAR_PARITY_SURFACE_EXPECTATIONS[surface];
  if (!expectation) {
    throw new Error(
      `Unknown sidecar parity surface: ${surface}. Expected one of: ${Object.keys(
        SIDECAR_PARITY_SURFACE_EXPECTATIONS
      ).join(", ")}`
    );
  }
  return expectation;
}

export function normalizeSidecarCliJsonOutput(cliJson) {
  const normalized = parseCliJson(cliJson);
  assertValidSidecarResultEnvelope(normalized);
  return normalized;
}

export function normalizeSidecarMcpStructuredContent(mcpResult) {
  if (!mcpResult || typeof mcpResult !== "object" || Array.isArray(mcpResult)) {
    throw new Error("Sidecar MCP result must be an object with structuredContent");
  }

  if (!Object.prototype.hasOwnProperty.call(mcpResult, "structuredContent")) {
    throw new Error("Sidecar MCP result must include structuredContent");
  }

  const normalized = mcpResult.structuredContent;
  assertValidSidecarResultEnvelope(normalized);
  return normalized;
}

export function compareSidecarCliMcpParity({ surface, cliJson, mcpResult }) {
  const expectation = requireKnownSurface(surface);
  const normalizedCli = normalizeSidecarCliJsonOutput(cliJson);
  const normalizedMcp = normalizeSidecarMcpStructuredContent(mcpResult);

  if (stableJson(withoutPreparation(normalizedCli)) !== stableJson(withoutPreparation(normalizedMcp))) {
    throw new Error(
      `Sidecar ${surface} CLI JSON and MCP structuredContent differ for ${expectation.parityTestOwner}`
    );
  }

  return {
    surface,
    owner: expectation.owner,
    parityTestOwner: expectation.parityTestOwner,
    transports: SIDECAR_PARITY_TRANSPORTS,
    envelope: normalizedCli
  };
}

export function createSidecarParityFixture({
  surface,
  envelopeFixture = "fresh",
  envelopeOverrides = {}
}) {
  const expectation = requireKnownSurface(surface);
  const envelope = {
    ...cloneSidecarTrustEnvelopeFixture(envelopeFixture),
    ...cloneJson(envelopeOverrides)
  };
  assertValidSidecarResultEnvelope(envelope);

  return Object.freeze({
    surface,
    expectation,
    cliJson: cloneJson(envelope),
    mcpResult: Object.freeze({
      content: Object.freeze([]),
      structuredContent: cloneJson(envelope)
    })
  });
}
