

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

export function packageDocumentPublicReader(t, temporaryRoot, { workspaceDir = null } = {}) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  let sequence = 0;
  return async function open(docsCarrier, role = "orchestrator") {
    registrationPolicy ??= await loadMcpToolTierRegistrationPolicy();
    sequence += 1;
    const label = `package document reader ${sequence}`;
    const env = { WIKI_MCP_TOOL_PROFILE: role, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
      WIKI_MCP_RESPONSE_STATE_DIR: path.join(temporaryRoot, "responses") };
    const workspace = { repo: "fixture/consumer", dir: workspaceDir ?? path.join(temporaryRoot, "consumer") };
    await mkdir(workspace.dir, { recursive: true });
    const resolutions = [];
    const server = new McpServer({ name: `package-document-reader-${sequence}`, version: "1.0.0" });
    scope.add(`${label} server`, () => server.close());
    const registerTool = createRegisterTool({ server, toolProfile: role, registeredTier: "free_local",
      mcpToolTierRegistrationPolicy: registrationPolicy, registeredToolNames: new Set(), structuredLog() {},
      toolUsageAuditBoundary: { wrapHandler: (_name, handler) => handler }, responseEnv: env });
    registerAgentTaskTools({ registerTool,
      workspaceRepos: { currentAlias: "consumer", repos: new Map([["consumer", workspace.dir]]) },
      resolveWorkspaceRepo: (...args) => { resolutions.push(args); return workspace; },
      sessionRole: role, sessionEnv: env, responseEnv: env,
      registeredTier: "free_local", registeredToolNames: new Set(), docsCarrier,
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
    const read = (reference, select = undefined) => raw({ reference, ...(select === undefined ? {} : { select }) });
    return Object.assign(read, { raw, workspaceResolutions: resolutions,
      inputSchema: tools.find(({ name }) => name === READ_WIKI_TOOL).inputSchema });
  };
}

export function packageDocumentOwnerReader({ docsCarrier, augmentDescriptor = (descriptor) => descriptor }) {
  return registerToolDocReadTools({ registerTool: () => undefined, z, jsonContent, errorContent,
    docsCarrier, sessionRole: "orchestrator", registeredTier: "free_local", augmentDescriptor }).readAdvertisedDoc;
}

export function assertPackageDocumentRefusal(result, code, label) {
  assert.equal(result.isError, true, `${label}: the read must refuse`);
  assert.equal(result.structuredContent.code, code, `${label}: public read-route diagnostic`);
  assert.equal(result.structuredContent.tool, READ_WIKI_TOOL, `${label}: the refusal names the serving operation`);
  assert.equal(result.structuredContent.schema_version, PACKAGE_DOCUMENT_REFUSAL_SCHEMA_VERSION, label);
  assert.equal(result.structuredContent.ok, false, label);
}

export function assertReadWikiRequestShapeRefusal(result, fieldPath, label) {
  assert.equal(result.isError, true, `${label}: the read must refuse`);
  const { diagnostic } = result.structuredContent;
  assert.equal(diagnostic.code, "tool_input_validation_failed", `${label}: request-shape diagnostic`);
  assert.equal(diagnostic.tool, READ_WIKI_TOOL, label);
  assert.ok(diagnostic.rejected_field_paths.includes(fieldPath),
    `${label}: the refusal names ${fieldPath}, got ${JSON.stringify(diagnostic.rejected_field_paths)}`);
  assert.equal(Object.values(TOOL_DOC_READ_DIAGNOSTIC_CODES).includes(result.structuredContent.code), false,
    `${label}: the request never reached the reader`);
}
