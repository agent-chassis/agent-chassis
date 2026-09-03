import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  assembleToolDiscoveryDescriptor,
  assembleToolDiscoveryDescriptorFromManifest,
  digestToolDiscoveryDescriptor,
  isToolDiscoveryFragmentManifest,
  loadToolDiscoveryDescriptor,
  ToolDiscoveryFragmentError,
  TOOL_DISCOVERY_FRAGMENT_KIND,
  TOOL_DISCOVERY_MANIFEST_FILENAME,
  TOOL_DISCOVERY_MANIFEST_KIND,
  TOOL_DISCOVERY_SCHEMA_VERSION
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import { makeTool } from "../tool-discovery-helpers.mjs";

function makeFragment(file, tools, overrides = {}) {
  return {
    schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
    kind: TOOL_DISCOVERY_FRAGMENT_KIND,
    repository: "fixture/tool-discovery",
    fragment: file,
    summary: `Fixture fragment ${file}`,
    tool_count: tools.length,
    tools,
    ...overrides
  };
}

function makeManifest(fragmentDefs, overrides = {}) {
  return {
    schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
    kind: TOOL_DISCOVERY_MANIFEST_KIND,
    repository: "fixture/tool-discovery",
    fragments: fragmentDefs.map((def) => ({
      file: def.file,
      tool_count: def.tools.length,
      ...(def.manifestEntryOverrides ?? {})
    })),
    expected_tool_count: fragmentDefs.reduce((total, def) => total + def.tools.length, 0),
    ...overrides
  };
}

function makeFragmentsByFile(fragmentDefs) {
  const map = new Map();
  for (const def of fragmentDefs) {
    map.set(def.file, makeFragment(def.file, def.tools, def.fragmentOverrides ?? {}));
  }
  return map;
}

function sampleFragmentDefs() {
  return [
    { file: "frag-a.json", tools: [makeTool("alpha"), makeTool("bravo")] },
    { file: "frag-b.json", tools: [makeTool("charlie")] }
  ];
}

function expectFragmentError(code) {
  return (error) => {
    assert.ok(
      error instanceof ToolDiscoveryFragmentError,
      `expected ToolDiscoveryFragmentError, got ${error && error.name}: ${error && error.message}`
    );
    assert.equal(error.code, code, `expected fragment error code ${code}, got ${error.code}`);
    return true;
  };
}

async function writeFragmentCorpus(fragmentDefs, { manifestOverrides = {}, fragmentFiles } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tool-discovery-fragments-"));
  const manifest = makeManifest(fragmentDefs, manifestOverrides);
  const manifestPath = path.join(tempDir, TOOL_DISCOVERY_MANIFEST_FILENAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  for (const def of fragmentDefs) {
    if (fragmentFiles && Object.prototype.hasOwnProperty.call(fragmentFiles, def.file)) {
      const raw = fragmentFiles[def.file];
      if (raw === null) {
        continue;
      }
      await writeFile(path.join(tempDir, def.file), raw);
      continue;
    }
    await writeFile(
      path.join(tempDir, def.file),
      JSON.stringify(makeFragment(def.file, def.tools, def.fragmentOverrides ?? {}), null, 2)
    );
  }

  return { tempDir, manifest, manifestPath };
}

test("assembles fragments strictly in manifest order regardless of input order", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);

  const reversed = new Map([...makeFragmentsByFile(fragmentDefs)].reverse());
  const descriptor = assembleToolDiscoveryDescriptor(manifest, reversed);

  assert.equal(descriptor.schema_version, TOOL_DISCOVERY_SCHEMA_VERSION);
  assert.equal(descriptor.repository, "fixture/tool-discovery");
  assert.deepEqual(
    descriptor.tools.map((tool) => tool.tool_name),
    ["alpha", "bravo", "charlie"]
  );
});

test("accepts a plain object fragment map equivalently to a Map", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);
  const asObject = Object.fromEntries(makeFragmentsByFile(fragmentDefs));

  const descriptor = assembleToolDiscoveryDescriptor(manifest, asObject);
  assert.deepEqual(
    descriptor.tools.map((tool) => tool.tool_name),
    ["alpha", "bravo", "charlie"]
  );
});

test("descriptor digest is order-independent of input but tied to manifest order", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);

  const forward = assembleToolDiscoveryDescriptor(manifest, makeFragmentsByFile(fragmentDefs));
  const reversedInput = assembleToolDiscoveryDescriptor(
    manifest,
    new Map([...makeFragmentsByFile(fragmentDefs)].reverse())
  );

  const forwardDigest = digestToolDiscoveryDescriptor(forward);

  assert.equal(forwardDigest, digestToolDiscoveryDescriptor(reversedInput));
  assert.match(forwardDigest, /^sha256:[0-9a-f]{64}$/);

  const reorderedDefs = [...fragmentDefs].reverse();
  const reorderedManifest = makeManifest(reorderedDefs);
  const reorderedDescriptor = assembleToolDiscoveryDescriptor(
    reorderedManifest,
    makeFragmentsByFile(reorderedDefs)
  );
  assert.deepEqual(
    reorderedDescriptor.tools.map((tool) => tool.tool_name),
    ["charlie", "alpha", "bravo"]
  );
  assert.notEqual(forwardDigest, digestToolDiscoveryDescriptor(reorderedDescriptor));
});

test("rejects a duplicate tool_name across fragments (no last-writer-wins)", () => {
  const fragmentDefs = [
    { file: "frag-a.json", tools: [makeTool("alpha"), makeTool("dup")] },
    { file: "frag-b.json", tools: [makeTool("dup")] }
  ];
  const manifest = makeManifest(fragmentDefs);

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, makeFragmentsByFile(fragmentDefs)),
    expectFragmentError("duplicate_tool_name")
  );
});

test("rejects a fragment whose tool count drifts from the manifest entry", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);

  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);
  fragmentsByFile.set("frag-a.json", makeFragment("frag-a.json", [makeTool("alpha")]));

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, fragmentsByFile),
    expectFragmentError("fragment_count_mismatch")
  );
});

test("rejects a fragment whose self-declared tool_count is internally inconsistent", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);
  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);

  fragmentsByFile.set(
    "frag-a.json",
    makeFragment("frag-a.json", [makeTool("alpha"), makeTool("bravo")], { tool_count: 5 })
  );

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, fragmentsByFile),
    expectFragmentError("fragment_self_count_mismatch")
  );
});

test("rejects a manifest fragment that was not provided (partial-corpus omission)", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);
  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);
  fragmentsByFile.delete("frag-b.json");

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, fragmentsByFile),
    expectFragmentError("missing_fragment_file")
  );
});

test("rejects an invalid tool entry (missing tool_name)", () => {
  const fragmentDefs = [
    { file: "frag-a.json", tools: [makeTool("alpha"), { display_name: "no name" }] }
  ];
  const manifest = makeManifest(fragmentDefs);

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, makeFragmentsByFile(fragmentDefs)),
    expectFragmentError("invalid_tool_entry")
  );
});

test("rejects a fragment with the wrong kind (invalid fragment shape)", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);
  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);
  fragmentsByFile.set(
    "frag-a.json",
    makeFragment("frag-a.json", [makeTool("alpha"), makeTool("bravo")], { kind: "not-a-fragment" })
  );

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, fragmentsByFile),
    expectFragmentError("invalid_fragment_shape")
  );
});

test("rejects a fragment that self-identifies as a different file", () => {
  const fragmentDefs = sampleFragmentDefs();
  const manifest = makeManifest(fragmentDefs);
  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);
  fragmentsByFile.set(
    "frag-a.json",
    makeFragment("frag-a.json", [makeTool("alpha"), makeTool("bravo")], { fragment: "frag-z.json" })
  );

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, fragmentsByFile),
    expectFragmentError("invalid_fragment_shape")
  );
});

test("rejects a manifest whose declared counts do not sum to expected_tool_count", () => {
  const fragmentDefs = sampleFragmentDefs();

  const manifest = makeManifest(fragmentDefs, { expected_tool_count: 99 });

  assert.throws(
    () => assembleToolDiscoveryDescriptor(manifest, makeFragmentsByFile(fragmentDefs)),
    expectFragmentError("manifest_count_mismatch")
  );
});

test("rejects a manifest with an invalid shape", () => {
  const fragmentDefs = sampleFragmentDefs();
  const fragmentsByFile = makeFragmentsByFile(fragmentDefs);

  assert.throws(
    () =>
      assembleToolDiscoveryDescriptor(
        makeManifest(fragmentDefs, { kind: "not-a-manifest" }),
        fragmentsByFile
      ),
    expectFragmentError("invalid_manifest_shape")
  );

  const dupManifest = makeManifest(fragmentDefs);
  dupManifest.fragments.push({ file: "frag-a.json", tool_count: 2 });
  dupManifest.expected_tool_count += 2;
  assert.throws(
    () => assembleToolDiscoveryDescriptor(dupManifest, fragmentsByFile),
    expectFragmentError("invalid_manifest_shape")
  );

  assert.throws(
    () =>
      assembleToolDiscoveryDescriptor(
        { ...makeManifest(fragmentDefs), fragments: [], expected_tool_count: 0 },
        fragmentsByFile
      ),
    expectFragmentError("invalid_manifest_shape")
  );
});

test("isToolDiscoveryFragmentManifest detects manifest objects, not full descriptors", () => {
  const fragmentDefs = sampleFragmentDefs();
  assert.equal(isToolDiscoveryFragmentManifest(makeManifest(fragmentDefs)), true);
  assert.equal(
    isToolDiscoveryFragmentManifest({
      schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
      repository: "fixture/tool-discovery",
      tools: []
    }),
    false
  );
});

test("assembles and loads a fragment corpus from disk via the manifest", async () => {
  const fragmentDefs = sampleFragmentDefs();
  const { tempDir, manifest, manifestPath } = await writeFragmentCorpus(fragmentDefs);
  try {
    const fromManifest = await assembleToolDiscoveryDescriptorFromManifest(manifest, { manifestPath });
    assert.deepEqual(
      fromManifest.tools.map((tool) => tool.tool_name),
      ["alpha", "bravo", "charlie"]
    );

    const loaded = await loadToolDiscoveryDescriptor(manifestPath);
    assert.deepEqual(
      loaded.tools.map((tool) => tool.tool_name),
      ["alpha", "bravo", "charlie"]
    );
    assert.equal(
      digestToolDiscoveryDescriptor(loaded),
      digestToolDiscoveryDescriptor(fromManifest)
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loader fails loudly when a manifest fragment file is missing on disk", async () => {
  const fragmentDefs = sampleFragmentDefs();
  const { tempDir, manifestPath } = await writeFragmentCorpus(fragmentDefs, {
    fragmentFiles: { "frag-b.json": null }
  });
  try {
    await assert.rejects(
      () => loadToolDiscoveryDescriptor(manifestPath),
      expectFragmentError("missing_fragment_file")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loader fails loudly when a fragment file holds malformed JSON", async () => {
  const fragmentDefs = sampleFragmentDefs();
  const { tempDir, manifestPath } = await writeFragmentCorpus(fragmentDefs, {
    fragmentFiles: { "frag-b.json": "{ not valid json" }
  });
  try {
    await assert.rejects(
      () => loadToolDiscoveryDescriptor(manifestPath),
      expectFragmentError("invalid_fragment_shape")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loader fails loudly when the manifest source is not valid JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tool-discovery-manifest-"));
  const manifestPath = path.join(tempDir, TOOL_DISCOVERY_MANIFEST_FILENAME);
  try {
    await writeFile(manifestPath, "{ this is not json");
    await assert.rejects(
      () => loadToolDiscoveryDescriptor(manifestPath),
      expectFragmentError("invalid_descriptor_source")
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
