

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";

import * as wikiCore from "../packages/wiki-core/src/index.mjs";

import {
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME,
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH,
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH
} from "../packages/wiki-core/src/lib/tool-discovery.mjs";

const AGGREGATE_BASENAME = "tool-discovery.v1.json";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

test("wiki-core publicly exports the canonical fragment manifest/path constants", () => {
  assert.equal(wikiCore.TOOL_DISCOVERY_FRAGMENT_DIRNAME, "tool-discovery");
  assert.equal(wikiCore.TOOL_DISCOVERY_MANIFEST_FILENAME, "manifest.json");
  assert.equal(
    wikiCore.TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH,
    "packages/wiki-core/data/tool-discovery/manifest.json"
  );
  assert.equal(
    wikiCore.TOOL_DISCOVERY_MANIFEST_KIND,
    "tool-discovery-fragment-manifest"
  );
  assert.equal(wikiCore.TOOL_DISCOVERY_FRAGMENT_KIND, "tool-discovery-fragment");

  assert.equal(typeof wikiCore.TOOL_DISCOVERY_FRAGMENT_DIR, "string");
  assert.ok(path.isAbsolute(wikiCore.TOOL_DISCOVERY_FRAGMENT_DIR));
  assert.equal(path.basename(wikiCore.TOOL_DISCOVERY_FRAGMENT_DIR), "tool-discovery");

  assert.equal(typeof wikiCore.TOOL_DISCOVERY_MANIFEST_PATH, "string");
  assert.ok(path.isAbsolute(wikiCore.TOOL_DISCOVERY_MANIFEST_PATH));
  assert.equal(path.basename(wikiCore.TOOL_DISCOVERY_MANIFEST_PATH), "manifest.json");
  assert.equal(
    path.dirname(wikiCore.TOOL_DISCOVERY_MANIFEST_PATH),
    wikiCore.TOOL_DISCOVERY_FRAGMENT_DIR
  );
});

test("descriptor-named aliases resolve to the fragment manifest, never the aggregate", () => {
  assert.equal(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_FILENAME,
    wikiCore.TOOL_DISCOVERY_MANIFEST_FILENAME
  );
  assert.equal(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_PATH,
    wikiCore.TOOL_DISCOVERY_MANIFEST_PATH
  );
  assert.equal(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
    wikiCore.TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH
  );

  for (const value of [
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_FILENAME,
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_PATH,
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH
  ]) {
    assert.equal(typeof value, "string");
    assert.ok(
      !value.includes(AGGREGATE_BASENAME),
      `descriptor alias unexpectedly resolves to the aggregate: ${value}`
    );
  }
  assert.ok(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH.endsWith("/manifest.json")
  );
});

test("aggregate descriptor constants are not part of the public export surface", () => {
  for (const name of [
    "TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME",
    "TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH",
    "TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH"
  ]) {
    assert.ok(
      !(name in wikiCore),
      `public index unexpectedly re-exports ${name}`
    );
    assert.equal(wikiCore[name], undefined);
  }

  const aggregateExports = Object.keys(wikiCore).filter((key) =>
    key.includes("AGGREGATE")
  );
  assert.deepEqual(aggregateExports, []);

  assert.equal(TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME, AGGREGATE_BASENAME);
  assert.equal(
    TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH,
    "packages/wiki-core/data/tool-discovery.v1.json"
  );
  assert.ok(TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH.includes(AGGREGATE_BASENAME));

  assert.notEqual(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
    TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH
  );
});

test("public descriptor load + digest stay anchored on the assembled fragment registry", async () => {

  const fromDefault = await wikiCore.loadToolDiscoveryDescriptor();
  assert.equal(fromDefault.schema_version, wikiCore.TOOL_DISCOVERY_SCHEMA_VERSION);
  assert.equal(fromDefault.schema_version, "tool-discovery.v1");
  assert.equal(typeof fromDefault.repository, "string");
  assert.ok(Array.isArray(fromDefault.tools));
  assert.ok(fromDefault.tools.length > 0);

  const defaultDigest = wikiCore.digestToolDiscoveryDescriptor(fromDefault);
  assert.match(defaultDigest, DIGEST_PATTERN);

  const reload = await wikiCore.loadToolDiscoveryDescriptor();
  assert.equal(wikiCore.digestToolDiscoveryDescriptor(reload), defaultDigest);

  const fromAlias = await wikiCore.loadToolDiscoveryDescriptor(
    wikiCore.TOOL_DISCOVERY_DESCRIPTOR_PATH
  );
  assert.equal(wikiCore.digestToolDiscoveryDescriptor(fromAlias), defaultDigest);

  const fromManifest = await wikiCore.loadToolDiscoveryDescriptor(
    wikiCore.TOOL_DISCOVERY_MANIFEST_PATH
  );
  assert.equal(wikiCore.digestToolDiscoveryDescriptor(fromManifest), defaultDigest);

  if (existsSync(TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH)) {
    const fromAggregate = await wikiCore.loadToolDiscoveryDescriptor(
      TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_PATH
    );
    assert.notEqual(
      wikiCore.digestToolDiscoveryDescriptor(fromAggregate),
      defaultDigest
    );
  }
});
