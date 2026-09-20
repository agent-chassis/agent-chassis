import test from "node:test";
import assert from "node:assert/strict";

import { isSupportedSidecarSchemaVersion, SIDECAR_SCHEMA_VERSION } from
  "../../packages/wiki-core/src/index.mjs";
import { SIDECAR_STORE_GRAPH_FILE, SIDECAR_STORE_SCHEMA_VERSION } from
  "../../packages/wiki-core/src/lib/sidecar-store-schema.mjs";
import { SIDECAR_DEFAULT_ARTIFACT_FILE } from
  "../../packages/wiki-core/src/lib/sidecar-status.mjs";

test("public result and SQLite store schemas are independently pinned", () => {
  assert.equal(SIDECAR_SCHEMA_VERSION, "repo-code-index.v1");
  assert.equal(SIDECAR_STORE_SCHEMA_VERSION, "repo-code-store.v5");
  assert.equal(SIDECAR_STORE_GRAPH_FILE, "graph.sqlite");
  assert.equal(SIDECAR_DEFAULT_ARTIFACT_FILE, "graph.sqlite");
  assert.equal(isSupportedSidecarSchemaVersion(SIDECAR_SCHEMA_VERSION), true);
  assert.equal(isSupportedSidecarSchemaVersion("repo-code-index.v0"), false);
});
