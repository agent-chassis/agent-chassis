import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySidecarArtifactSchema,
  isSupportedSidecarArtifactSchema,
  isSupportedSidecarSchemaVersion,
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION
} from "../packages/wiki-core/src/index.mjs";

test("sidecar schema version constants are pinned", () => {
  assert.equal(SIDECAR_SCHEMA_VERSION, "repo-code-index.v1");
  assert.equal(SIDECAR_ARTIFACT_SCHEMA_VERSION, "repo-code-index.v1");
});

test("sidecar schema version helpers fail closed for incompatible artifacts", () => {
  assert.equal(isSupportedSidecarSchemaVersion(SIDECAR_SCHEMA_VERSION), true);
  assert.equal(isSupportedSidecarSchemaVersion("repo-code-index.v0"), false);
  assert.equal(
    isSupportedSidecarArtifactSchema({
      [SIDECAR_ARTIFACT_SCHEMA_FIELD]: SIDECAR_ARTIFACT_SCHEMA_VERSION
    }),
    true
  );
  assert.equal(isSupportedSidecarArtifactSchema({}), false);

  assert.deepEqual(classifySidecarArtifactSchema(null), {
    compatible: false,
    staleness: "missing",
    reason: "artifact_missing"
  });
  assert.deepEqual(
    classifySidecarArtifactSchema({
      [SIDECAR_ARTIFACT_SCHEMA_FIELD]: SIDECAR_ARTIFACT_SCHEMA_VERSION
    }),
    {
      compatible: true,
      staleness: "unknown",
      reason: "schema_compatible"
    }
  );
  assert.deepEqual(classifySidecarArtifactSchema({}), {
    compatible: false,
    staleness: "rebuild_required",
    reason: "schema_incompatible"
  });
  assert.notEqual(classifySidecarArtifactSchema({}).staleness, "fresh");
  assert.notEqual(
    classifySidecarArtifactSchema({
      [SIDECAR_ARTIFACT_SCHEMA_FIELD]: "repo-code-index.v0"
    }).staleness,
    "fresh"
  );
});
