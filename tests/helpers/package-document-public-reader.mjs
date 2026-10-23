

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONTROLLED_ACCEPTANCE_PUBLICATION_ENV, createExceptionPublication } from
  "../../packages/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";

import { errorContent, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerAgentTaskTools } from "../../packages/wiki-mcp/src/lib/register-agent-task-tools.mjs";
import { createRegisterTool } from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import { loadMcpToolTierRegistrationPolicy } from
  "../../packages/wiki-mcp/src/lib/server-composition-helpers.mjs";
import { registerToolDocReadTools, TOOL_DOC_READ_DIAGNOSTIC_CODES } from
  "../../packages/wiki-mcp/src/lib/tool-doc-read-tools.mjs";
import { createTestResourceScope } from "./test-resource-scope.mjs";

export const READ_WIKI_TOOL = "workspace_read_wiki";
export const PACKAGE_DOCUMENT_REFUSAL_SCHEMA_VERSION = "tool-doc-read-refusal.v1";

let registrationPolicy = null;

export function packageDocumentPublicReader(t, temporaryRoot, {
  workspaceDir = null, publishControlledAcceptanceOptOut = true
} = {}) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  let sequence = 0;
  return async function open(docsCarrier, role = "orchestrator", registeredTier = "free_local") {
    registrationPolicy ??= await loadMcpToolTierRegistrationPolicy();
    sequence += 1;
    const label = `package document reader ${sequence}`;
    const env = { WIKI_MCP_TOOL_PROFILE: role, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
      [CONTROLLED_ACCEPTANCE_PUBLICATION_ENV]: String(publishControlledAcceptanceOptOut),
      WIKI_MCP_RESPONSE_STATE_DIR: path.join(temporaryRoot, "responses") };
    const workspace = { repo: "fixture/consumer", dir: workspaceDir ?? path.join(temporaryRoot, "consumer") };
    await mkdir(workspace.dir, { recursive: true });
    const resolutions = [];
    const server = new McpServer({ name: `package-document-reader-${sequence}`, version: "1.0.0" });
    scope.add(`${label} server`, () => server.close());
    const registerTool = createRegisterTool({ server, toolProfile: role, registeredTier,
      mcpToolTierRegistrationPolicy: registrationPolicy, registeredToolNames: new Set(), structuredLog() {},
      toolUsageAuditBoundary: { wrapHandler: (_name, handler) => handler }, responseEnv: env });
    registerAgentTaskTools({ registerTool,
      workspaceRepos: { currentAlias: "consumer", repos: new Map([["consumer", workspace.dir]]) },
      resolveWorkspaceRepo: (...args) => { resolutions.push(args); return workspace; },
      sessionRole: role, sessionEnv: env, responseEnv: env,

      exceptionPublication: createExceptionPublication(publishControlledAcceptanceOptOut),
      registeredTier, registeredToolNames: new Set(), docsCarrier,
      jsonContent: (value) => jsonContent(value, { env }), errorContent: (error) => errorContent(error, { env }) });
    const client = new Client({ name: `package-document-reader-client-${sequence}`, version: "1.0.0" });
    scope.add(`${label} client`, () => client.close());
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(({ name }) => name === READ_WIKI_TOOL),
      "the production registration serves workspace_read_wiki");
    assert.equal(tools.some(({ name }) => name === "workspace_read_tool_doc"), false,
      "the retired read route is not registered");
    const raw = (args) => client.callTool({ name: READ_WIKI_TOOL, arguments: args });
    const read = (reference, select = undefined) => raw({ reads: [{ reference, ...(select === undefined ? {} : { select }) }] });
    return Object.assign(read, { raw, workspaceResolutions: resolutions,
      inputSchema: tools.find(({ name }) => name === READ_WIKI_TOOL).inputSchema });
  };
}

export function packageDocumentOwnerReader({ docsCarrier, registeredTier = "free_local", augmentDescriptor = (descriptor) => descriptor }) {
  return registerToolDocReadTools({ registerTool: () => undefined, z, jsonContent, errorContent,
    docsCarrier, sessionRole: "orchestrator", registeredTier, augmentDescriptor }).readAdvertisedDoc;
}

export function assertPackageDocumentRefusal(result, code, label) {
  const item = result.structuredContent.results[0];
  assert.notEqual(item.status, 'ok', `${label}: the read must refuse`);
  assert.equal(item.issue.code, code, `${label}: public read-route diagnostic`);
  assert.equal(item.issue.tool, READ_WIKI_TOOL, `${label}: the refusal names the serving operation`);
  assert.equal(item.issue.ok, false, label);
}

export function assertReadWikiRequestShapeRefusal(result, fieldPath, label) {
  const item = result.structuredContent.results[0];
  assert.equal(item.status, 'refused', `${label}: the read must refuse`);
  const diagnostic = item.issue;
  assert.equal(diagnostic.code, 'workspace_read_wiki_selection_invalid', JSON.stringify(item));
  assert.ok(diagnostic.invalid_fields.some(field => field.path.join('.') === fieldPath),
    `${label}: the refusal names ${fieldPath}, got ${JSON.stringify(diagnostic.invalid_fields)}`);
  assert.equal(Object.values(TOOL_DOC_READ_DIAGNOSTIC_CODES).includes(diagnostic.code), false,
    `${label}: the request never reached the package-document owner`);
}
