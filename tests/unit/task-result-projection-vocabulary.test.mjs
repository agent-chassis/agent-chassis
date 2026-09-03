import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  TASK_RESULT_PROJECTION_VOCABULARY,
  defineTaskResultCollectionDescriptors,
  taskResultPageAccounting,
  taskResultScalarRangeAccounting
} from "../../packages/controlled-contract/current.mjs";

test("neutral projection vocabulary owns descriptors and exact page accounting", () => {
  const descriptors = defineTaskResultCollectionDescriptors([
    { collection: "rows", stable_id: "row_id", fields: ["row_id", "value"], selectors: ["id"] }
  ]);
  assert.equal(Object.isFrozen(descriptors), true);
  assert.equal(descriptors[0].collection, "rows");
  assert.deepEqual(TASK_RESULT_PROJECTION_VOCABULARY.accounting, {
    total: "total",
    returned: "returned",
    remaining: "remaining",
    continuation: "continuation"
  });
  assert.deepEqual(taskResultPageAccounting({
    total: 9,
    offset: 3,
    returned: 3,
    cursor: "next"
  }), {
    total: 9,
    returned: 3,
    remaining: 3,
    continuation: { kind: "cursor", cursor: "next" },
    complete: false
  });
  assert.deepEqual(taskResultPageAccounting({ total: 9, offset: 6, returned: 3 }), {
    total: 9,
    returned: 3,
    remaining: 0,
    continuation: null,
    complete: true
  });
});

test("scalar ranges use the same total returned remaining continuation vocabulary", () => {
  assert.deepEqual(taskResultScalarRangeAccounting({ total: 10, offset: 2, length: 4 }), {
    total: 10,
    returned: 4,
    remaining: 4,
    continuation: { kind: "scalar_range", next_offset: 6 },
    complete: false
  });
  assert.throws(() => taskResultScalarRangeAccounting({ total: 2, offset: 1, length: 2 }));
  assert.throws(() => taskResultPageAccounting({
    total: 2, offset: 0, returned: 1, cursor: null
  }), /continuation/);
  assert.throws(() => defineTaskResultCollectionDescriptors([
    { collection: "rows", stable_id: "id", fields: ["value"], selectors: ["id"] }
  ]), /must include stable_id/);
});

test("the public documentation defines complete as exhaustion after the current page", async () => {
  const reference = await readFile(new URL(
    "../../docs/mcp-operation-reference.md", import.meta.url
  ), "utf8");
  assert.match(reference, /`complete` field means exactly that no rows remain after the\s+current page/u);
  assert.match(reference, /remaining === 0/u);
  assert.match(reference, /offset` is nonzero/u);
});

test("the neutral package exports both owners without importing either wiki layer", async () => {
  const [entrypoint, snapshots, vocabulary] = await Promise.all([
    readFile(new URL("../../packages/controlled-contract/current.mjs", import.meta.url), "utf8"),
    readFile(new URL(
      "../../packages/controlled-contract/lib/task-result-snapshots.mjs", import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../packages/controlled-contract/lib/task-result-projection-vocabulary.mjs",
      import.meta.url
    ), "utf8")
  ]);
  assert.match(entrypoint, /task-result-snapshots\.mjs/u);
  assert.match(entrypoint, /task-result-projection-vocabulary\.mjs/u);
  for (const source of [snapshots, vocabulary]) {
    assert.doesNotMatch(source, /@agent-chassis\/wiki-(?:core|mcp)|packages\/wiki-(?:core|mcp)/u);
  }
});

test("the neutral owner dependency graph remains inside controlled-contract and acyclic", async () => {
  const packageRoot = new URL("../../packages/controlled-contract/", import.meta.url);
  const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
  const roots = [
    "lib/task-result-snapshots.mjs",
    "lib/task-result-projection-vocabulary.mjs"
  ];
  const graph = new Map();
  for (const relativePath of roots) {
    const source = await readFile(new URL(relativePath, packageRoot), "utf8");
    const specifiers = Array.from(source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu
    ), (match) => match[1]);
    assert.equal(specifiers.some((specifier) =>
      specifier.includes("wiki-core") || specifier.includes("wiki-mcp")), false);
    graph.set(relativePath, specifiers.filter((specifier) => specifier.startsWith(".")).map(
      (specifier) => new URL(specifier, new URL(relativePath, packageRoot)).pathname
        .slice(packageRoot.pathname.length)
    ));
  }
  assert.deepEqual(graph.get("lib/task-result-snapshots.mjs"),
    ["lib/task-result-projection-vocabulary.mjs"]);
  assert.deepEqual(graph.get("lib/task-result-projection-vocabulary.mjs"), []);

  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    assert.equal(visiting.has(node), false, `dependency cycle reaches ${node}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  };
  for (const root of roots) visit(root);
  for (const dependencySet of [
    packageJson.dependencies ?? {},
    packageJson.peerDependencies ?? {},
    packageJson.optionalDependencies ?? {}
  ]) {
    assert.equal(Object.keys(dependencySet).some((name) =>
      name === "@agent-chassis/wiki-core" || name === "@agent-chassis/wiki-mcp"), false);
  }
});
