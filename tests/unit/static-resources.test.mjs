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

  const envelope = result.structuredContent;
  assert.equal(envelope.code, "operator_recovery_needed");
  assert.equal(envelope.diagnostic, "contract read failed");
  assert.equal(envelope.refusal.no_supported_route, true);
  assert.deepEqual(JSON.parse(result.content[0].text), envelope);
  assert.equal(result.contents[0].uri, "contract://schema");
  assert.equal(result.contents[0].mimeType, "application/json");
  assert.deepEqual(JSON.parse(result.contents[0].text), envelope);
});
