import test from "node:test";
import assert from "node:assert/strict";

import { registerStaticResources } from "../packages/wiki-mcp/src/lib/static-resources.mjs";
import { errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";

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
  assert.equal(result.content[0].text, "contract read failed");
  assert.equal(result.contents[0].uri, "contract://schema");
  assert.equal(result.contents[0].mimeType, "application/json");
  assert.equal(result.contents[0].text, "contract read failed");
});
