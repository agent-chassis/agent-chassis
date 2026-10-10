import test from "node:test";
import assert from "node:assert/strict";

import { registerStaticResources } from "../../packages/wiki-mcp/src/lib/static-resources.mjs";
import { errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

test("static resources convert loader failures into MCP error payloads", async () => {
  const resources = [];
  const server = {
    registerResource(name, uri, config, handler) {
      resources.push({ name, uri, config, handler });
    }
  };

  registerStaticResources(server, {
    readContractFile: async () => {
      throw new Error("contract read failed");
    },
    errorContent
  });

  const schemaResource = resources.find((entry) => entry.uri === "contract://schema");
  assert.ok(schemaResource, "schema resource must be registered");

  const result = await schemaResource.handler();

  assert.equal(result.isError, true);

  assert.deepEqual(Object.keys(result).sort(), ["contents", "isError"]);
  assert.equal(Object.hasOwn(result, "structuredContent"), false);
  assert.equal(Object.hasOwn(result, "content"), false);
  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].uri, "contract://schema");
  assert.equal(result.contents[0].mimeType, "application/json");
  const envelope = JSON.parse(result.contents[0].text);
  assert.equal(envelope.code, "mcp_response.handler_exception.v1");
  assert.notEqual(envelope.code, "operator_recovery_needed");
  assert.equal(envelope.diagnostic, "contract read failed");
  assert.equal(envelope.refusal.no_supported_route, true);
  assert.deepEqual(envelope, errorContent(new Error("contract read failed")).structuredContent);
});

test("static resources return successful loader text unchanged", async () => {
  const resources = [];
  const server = {
    registerResource(name, uri, config, handler) {
      resources.push({ name, uri, config, handler });
    }
  };

  registerStaticResources(server, {
    readContractFile: async (file) => `contract text for ${file}`,
    errorContent
  });

  const schemaResource = resources.find((entry) => entry.uri === "contract://schema");
  assert.deepEqual(await schemaResource.handler(), {
    contents: [
      { uri: "contract://schema", mimeType: "text/markdown", text: "contract text for schema.md" }
    ]
  });
});
