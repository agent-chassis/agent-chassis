import test from "node:test";
import assert from "node:assert/strict";

import { extractSidecarGraph } from "../packages/wiki-core/src/lib/sidecar-graph-extractors.mjs";

const nestingDepth = 20000;
const deeplyNestedSource = () =>
  `const x = ${"[".repeat(nestingDepth)}1${"]".repeat(nestingDepth)};\n`;

const failingParseIterations = 10;

const maxExternalGrowthBytes = 24 * 1024 * 1024;

test("supported-language parse failure does not leak the tree-sitter parse tree", async () => {

  const supported = await extractSidecarGraph({
    sources: [
      {
        path: "packages/app/src/a.mjs",
        content: "import { b } from './b.mjs';\nexport const a = b;\n"
      },
      { path: "packages/app/src/b.mjs", content: "export const b = 1;\n" }
    ]
  });
  assert.ok(
    (supported.graph_edges ?? []).some((edge) => edge.kind === "imports_module"),
    "expected JavaScript import extraction to be supported"
  );

  const failed = await extractSidecarGraph({
    sources: [{ path: "packages/app/src/deep.mjs", content: deeplyNestedSource() }]
  });
  assert.deepEqual(
    failed.graph_state?.unavailable_paths ?? [],
    ["packages/app/src/deep.mjs"],
    "expected the deeply nested source to fail import-fact collection"
  );

  await extractSidecarGraph({
    sources: [{ path: "packages/app/src/warm.mjs", content: deeplyNestedSource() }]
  });

  global.gc?.();
  const before = process.memoryUsage().external;
  for (let iteration = 0; iteration < failingParseIterations; iteration += 1) {
    await extractSidecarGraph({
      sources: [
        { path: `packages/app/src/deep${iteration}.mjs`, content: deeplyNestedSource() }
      ]
    });
  }
  global.gc?.();
  const growth = process.memoryUsage().external - before;

  assert.ok(
    growth < maxExternalGrowthBytes,
    `WASM linear memory grew ${(growth / 1024 / 1024).toFixed(1)} MB across ` +
      `${failingParseIterations} failed parses (ceiling ` +
      `${(maxExternalGrowthBytes / 1024 / 1024).toFixed(1)} MB) -- a parse tree is leaking`
  );
});
