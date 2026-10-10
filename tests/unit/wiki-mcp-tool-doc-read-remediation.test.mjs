import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { bindPackageDocsCarrier, TOOL_DOC_READ_DIAGNOSTIC_CODES } from
  "../../packages/wiki-mcp/src/lib/tool-doc-read-tools.mjs";
import { shouldExposeTool } from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";
import {
  assertPackageDocumentRefusal as assertReaderRefusal,
  assertReadWikiRequestShapeRefusal as assertRequestShapeRefusal,
  packageDocumentOwnerReader as ownerReader,
  packageDocumentPublicReader as publicReader,
  READ_WIKI_TOOL
} from "../helpers/package-document-public-reader.mjs";

const SINGLE_REFERENCE_TOOL = "start_agent";
const PLAIN_DOC_REFERENCE = "docs/mcp-operation-reference.md";
const PAIR_REFERENCE_TOOL = "workspace_run_test";
const PAIR_DOC_REFERENCES = ["docs/local-test-runtime-setup.md", "docs/mcp-selected-response-details.md"];

const REFS_DOC_REFERENCE = "packages/wiki-core/templates/AGENTS.md.boilerplate.md";
const REFS_BUNDLE_PATH = "docs/_refs/packages/wiki-core/templates/AGENTS.md.boilerplate.md";
const RETIRED_ADVERTISING_TOOL = "workspace_search_repo";

const FIXTURE_PACKAGE_NAME = "@agent-chassis/core";
const FIXTURE_PACKAGE_VERSION = "0.6.0";

async function makeTemporaryRoot(t, label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `wk2139-remediation-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function manifestBody(entries, overrides = {}) {
  return JSON.stringify({
    schema_version: "public-docs-manifest.v1",
    package: { name: FIXTURE_PACKAGE_NAME, version: FIXTURE_PACKAGE_VERSION },
    entries,
    ...overrides
  });
}

function entry(logicalPath, bundlePath) {
  return {
    logical_path: logicalPath,
    source_path: logicalPath,
    bundle_path: bundlePath,
    available: true,
    sha256: null,
    bytes: null
  };
}

async function writeServingPackage(packageDir, extraEntries = []) {
  await mkdir(path.join(packageDir, "docs", "_refs", "packages", "wiki-core", "templates"), {
    recursive: true
  });
  await writeFile(path.join(packageDir, PLAIN_DOC_REFERENCE), "PACKAGE DOC BYTES\n", "utf8");
  await writeFile(path.join(packageDir, REFS_BUNDLE_PATH), "BOILERPLATE BYTES\n", "utf8");
  await writeFile(
    path.join(packageDir, "docs", "public-docs-manifest.json"),
    manifestBody([
      entry(PLAIN_DOC_REFERENCE, PLAIN_DOC_REFERENCE),
      entry(REFS_DOC_REFERENCE, REFS_BUNDLE_PATH),
      ...extraEntries
    ]),
    "utf8"
  );
}

function carrierFor(packageDir, overrides = {}) {
  return bindPackageDocsCarrier({
    packageName: FIXTURE_PACKAGE_NAME,
    packageVersion: FIXTURE_PACKAGE_VERSION,
    packageRoot: packageDir,
    docsRoot: path.join(packageDir, "docs"),
    manifestPath: path.join(packageDir, "docs", "public-docs-manifest.json"),
    ...overrides
  });
}

function assertNoRootDisclosure(payload, roots, label) {
  const serialized = JSON.stringify(payload);
  for (const root of roots) {
    assert.equal(serialized.includes(root), false, `${label}: refusal disclosed ${root}`);
  }
  assert.doesNotMatch(
    serialized,
    /\/(?:tmp|home|usr|var|private|Users)\//u,
    `${label}: refusal disclosed an absolute filesystem path`
  );
}

test("WK-2139 remediation: each binding failure reaches the public read route under its own code", async (t) => {

  for (const tool of [READ_WIKI_TOOL, SINGLE_REFERENCE_TOOL, PAIR_REFERENCE_TOOL]) {
    assert.equal(shouldExposeTool("orchestrator", tool), true, `${tool} is visible to an orchestrator`);
  }
  assert.equal(shouldExposeTool("orchestrator", RETIRED_ADVERTISING_TOOL), false);

  const temporaryRoot = await makeTemporaryRoot(t, "binding");
  const open = publicReader(t, temporaryRoot);

  const absent = await bindPackageDocsCarrier(null);
  assert.equal(absent.bound, false);

  const missingManifestDir = path.join(temporaryRoot, "missing-manifest");
  await mkdir(path.join(missingManifestDir, "docs"), { recursive: true });
  const missingManifest = await carrierFor(missingManifestDir);

  const wrongSchemaDir = path.join(temporaryRoot, "wrong-schema");
  await mkdir(path.join(wrongSchemaDir, "docs"), { recursive: true });
  await writeFile(
    path.join(wrongSchemaDir, "docs", "public-docs-manifest.json"),
    JSON.stringify({ schema_version: "public-docs-manifest.v9", entries: [] }),
    "utf8"
  );
  const wrongSchema = await carrierFor(wrongSchemaDir);

  const renamedDir = path.join(temporaryRoot, "renamed");
  await mkdir(path.join(renamedDir, "docs"), { recursive: true });
  await writeFile(
    path.join(renamedDir, "docs", "public-docs-manifest.json"),
    JSON.stringify({
      schema_version: "public-docs-manifest.v1",
      package: { name: "@example/not-core", version: FIXTURE_PACKAGE_VERSION },
      entries: []
    }),
    "utf8"
  );
  const renamed = await carrierFor(renamedDir);

  const restampedDir = path.join(temporaryRoot, "restamped");
  await mkdir(path.join(restampedDir, "docs"), { recursive: true });
  await writeFile(
    path.join(restampedDir, "docs", "public-docs-manifest.json"),
    JSON.stringify({
      schema_version: "public-docs-manifest.v1",
      package: { name: FIXTURE_PACKAGE_NAME, version: "0.0.0-not-the-shipped-version" },
      entries: []
    }),
    "utf8"
  );
  const restamped = await carrierFor(restampedDir);

  const cases = [
    ["absent carrier", absent, TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE],
    ["non-object carrier", await bindPackageDocsCarrier("not-a-carrier"), TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE],
    ["incomplete carrier", await bindPackageDocsCarrier({ packageName: FIXTURE_PACKAGE_NAME }), TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE],
    ["unreadable manifest", missingManifest, TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_UNREADABLE],
    ["schema mismatch", wrongSchema, TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_SCHEMA_MISMATCH],
    ["package renamed", renamed, TOOL_DOC_READ_DIAGNOSTIC_CODES.PACKAGE_VERSION_MISMATCH],
    ["version mismatch", restamped, TOOL_DOC_READ_DIAGNOSTIC_CODES.PACKAGE_VERSION_MISMATCH]
  ];

  const observed = new Set();
  for (const [label, carrier, expected] of cases) {
    assert.equal(carrier.bound, false, `${label}: fixture precondition — binding must fail`);
    assert.equal(carrier.code, expected, `${label}: binding diagnostic`);

    const read = await open(carrier);
    const refused = await read({ tool_name: SINGLE_REFERENCE_TOOL, path: PLAIN_DOC_REFERENCE });
    assert.equal(refused.isError, true, `${label}: the read must refuse`);

    assert.notEqual(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE,
      `${label}: a broken carrier must not be reported as an unadvertised reference`
    );
    assertReaderRefusal(refused, expected, label);
    assertNoRootDisclosure(refused.structuredContent, [temporaryRoot], label);
    observed.add(refused.structuredContent.code);
  }

  assert.deepEqual(
    [...observed].sort(),
    [
      TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_SCHEMA_MISMATCH,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_UNREADABLE,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.PACKAGE_VERSION_MISMATCH
    ].sort(),
    "all four binding diagnostics must be reachable through the public read route"
  );
});

test("WK-2139 remediation: input shape and session visibility still refuse ahead of the carrier", async (t) => {

  const temporaryRoot = await makeTemporaryRoot(t, "precedence");
  const open = publicReader(t, temporaryRoot);
  const broken = await bindPackageDocsCarrier(null);
  assert.equal(broken.bound, false);

  const read = await open(broken);
  for (const candidate of ["/etc/passwd", "../../etc/passwd", "docs/../../package.json"]) {
    const label = `path ${JSON.stringify(candidate)}`;
    const refused = await read({ tool_name: SINGLE_REFERENCE_TOOL, path: candidate });

    assertReaderRefusal(refused, TOOL_DOC_READ_DIAGNOSTIC_CODES.INVALID_PATH, label);
  }

  assertRequestShapeRefusal(await read({ tool_name: SINGLE_REFERENCE_TOOL, path: "" }),
    "$.reference.path", "empty path");
  assertRequestShapeRefusal(await read({ tool_name: SINGLE_REFERENCE_TOOL, path: PLAIN_DOC_REFERENCE,
    package_root: temporaryRoot }), "$.reference", "caller-supplied package root");

  await assert.rejects(ownerReader({ docsCarrier: broken })({ tool_name: SINGLE_REFERENCE_TOOL, path: "" }),
    { code: TOOL_DOC_READ_DIAGNOSTIC_CODES.INVALID_PATH });

  for (const [label, toolName] of [["an unknown tool", "not_a_tool"],
    ["the retired advertising tool", RETIRED_ADVERTISING_TOOL]]) {
    const hidden = await read({ tool_name: toolName, path: PLAIN_DOC_REFERENCE });

    assertReaderRefusal(hidden, TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL, label);
    assert.equal(JSON.stringify(hidden.structuredContent).includes(toolName), false,
      `${label}: the refusal does not confirm the name back to the caller`);
  }

  const packageDir = path.join(temporaryRoot, "package");
  await writeServingPackage(packageDir);
  const carrier = await carrierFor(packageDir);
  assert.equal(carrier.bound, true);
  const boundRead = await open(carrier);
  const refused = await boundRead({ tool_name: SINGLE_REFERENCE_TOOL, path: "docs/tool-discovery.md" });
  assertReaderRefusal(refused, TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE,
    "a bound carrier that does not serve the path keeps the unadvertised attribution");
  assert.deepEqual(refused.structuredContent.advertised_paths, [PLAIN_DOC_REFERENCE]);

  assert.equal(shouldExposeTool("reviewer", SINGLE_REFERENCE_TOOL), false,
    "fixture precondition: a reviewer cannot see start_agent");
  const reviewerRead = await open(carrier, "reviewer");
  assertReaderRefusal(await reviewerRead({ tool_name: SINGLE_REFERENCE_TOOL, path: PLAIN_DOC_REFERENCE }),
    TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL, "a tool hidden from the reviewer");
  assertReaderRefusal(await boundRead({ tool_name: RETIRED_ADVERTISING_TOOL, path: PLAIN_DOC_REFERENCE }),
    TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL, "the retired advertising tool over a bound carrier");
});

test("WK-2139 remediation: a docsRoot that is not inside the package root is an unavailable carrier", async (t) => {
  const temporaryRoot = await makeTemporaryRoot(t, "docsroot");
  const open = publicReader(t, temporaryRoot);
  const packageDir = path.join(temporaryRoot, "package");
  await writeServingPackage(packageDir);

  const rejected = [
    ["relative docsRoot", "docs"],
    ["relative dotted docsRoot", "./docs"],
    ["docsRoot outside the package root", path.join(temporaryRoot, "elsewhere")],
    ["docsRoot above the package root", temporaryRoot],

    ["sibling sharing a name prefix", `${packageDir}-docs`],
    ["docsRoot equal to the package root", packageDir]
  ];

  for (const [label, docsRoot] of rejected) {
    const carrier = await carrierFor(packageDir, { docsRoot });
    assert.equal(carrier.bound, false, `${label}: must not bind`);
    assert.equal(
      carrier.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      `${label}: an unusable docsRoot is an incomplete carrier`
    );

    const read = await open(carrier);
    const refused = await read({ tool_name: SINGLE_REFERENCE_TOOL, path: PLAIN_DOC_REFERENCE });

    assertReaderRefusal(refused, TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE, label);
    assertNoRootDisclosure(refused.structuredContent, [temporaryRoot, packageDir], label);
  }

  const withoutDocsRoot = await bindPackageDocsCarrier({
    packageName: FIXTURE_PACKAGE_NAME,
    packageVersion: FIXTURE_PACKAGE_VERSION,
    packageRoot: packageDir,
    manifestPath: path.join(packageDir, "docs", "public-docs-manifest.json")
  });
  assert.equal(withoutDocsRoot.bound, false);
  assert.equal(withoutDocsRoot.code, TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE);

  const carrier = await carrierFor(packageDir);
  assert.equal(carrier.bound, true);
  assert.equal(carrier.docsRoot, path.resolve(packageDir, "docs"));
});

test("WK-2139 remediation: only bundle paths inside docsRoot are authorized", async (t) => {
  const temporaryRoot = await makeTemporaryRoot(t, "containment");
  const open = publicReader(t, temporaryRoot);
  const packageDir = path.join(temporaryRoot, "package");

  await mkdir(path.join(packageDir, "lib"), { recursive: true });
  await mkdir(path.join(packageDir, "docs-internal"), { recursive: true });
  await writeFile(path.join(packageDir, "lib", "internal.md"), "PACKAGE INTERNALS\n", "utf8");
  await writeFile(path.join(packageDir, "package.json"), '{"name":"fixture"}\n', "utf8");
  await writeFile(
    path.join(packageDir, "docs-internal", "notes.md"),
    "SIBLING PREFIX BYTES\n",
    "utf8"
  );

  await writeServingPackage(packageDir, [
    entry(PAIR_DOC_REFERENCES[0], "lib/internal.md"),
    entry(PAIR_DOC_REFERENCES[1], "docs-the project documentation")
  ]);

  const carrier = await carrierFor(packageDir);
  assert.equal(carrier.bound, true, "the fixture package must bind");
  const read = await open(carrier);

  for (const [label, reference, leaked] of [
    ["a sibling directory of the bundle", PAIR_DOC_REFERENCES[0], "PACKAGE INTERNALS"],
    ["a sibling sharing the bundle's name prefix", PAIR_DOC_REFERENCES[1], "SIBLING PREFIX BYTES"]
  ]) {
    for (const select of [undefined, { field: "text" }]) {
      const refused = await read({ tool_name: PAIR_REFERENCE_TOOL, path: reference }, select);
      assertReaderRefusal(refused, TOOL_DOC_READ_DIAGNOSTIC_CODES.PATH_CONTAINMENT, label);
      assert.doesNotMatch(
        JSON.stringify(refused),
        new RegExp(leaked, "u"),
        `${label}: the refusal must not carry the unauthorized bytes`
      );
      assertNoRootDisclosure(refused.structuredContent, [temporaryRoot, packageDir], label);
    }
  }

  const reference = { tool_name: SINGLE_REFERENCE_TOOL, path: PLAIN_DOC_REFERENCE };
  const context = await read(reference);
  assert.notEqual(context.isError, true, "a docs/… entry must still be served");
  assert.equal(context.structuredContent.source_kind, "package_document");
  assert.deepEqual(context.structuredContent.subject, reference);
  assert.deepEqual(context.structuredContent.next_calls.map((call) => call.arguments),
    [{ reference, select: { field: "text" } }]);
  const plain = await read(reference, { field: "text" });
  assert.notEqual(plain.isError, true, "a docs/… entry must still be served");
  assert.equal(plain.structuredContent.complete, true);
  assert.equal(plain.structuredContent.path, PLAIN_DOC_REFERENCE);
  assert.equal(plain.structuredContent.value, "PACKAGE DOC BYTES\n");

  const nestedDir = path.join(temporaryRoot, "nested-package");
  await writeServingPackage(nestedDir, [entry(PAIR_DOC_REFERENCES[0], REFS_BUNDLE_PATH)]);
  const nestedCarrier = await carrierFor(nestedDir);
  const nested = await (await open(nestedCarrier))(
    { tool_name: PAIR_REFERENCE_TOOL, path: PAIR_DOC_REFERENCES[0] }, { field: "text" });
  assert.notEqual(nested.isError, true, "a docs/_refs/… bundle path must still be served");
  assert.equal(nested.structuredContent.path, PAIR_DOC_REFERENCES[0]);
  assert.equal(nested.structuredContent.value, "BOILERPLATE BYTES\n");

  for (const served of [context, plain, nested]) {
    for (const root of [temporaryRoot, packageDir, nestedDir]) {
      assert.equal(
        JSON.stringify(served.structuredContent).includes(root),
        false,
        "a served result must never disclose the package installation root"
      );
    }
    const identity = served.structuredContent.facts ?? served.structuredContent;
    assert.equal(identity.owner_package, FIXTURE_PACKAGE_NAME);
    assert.equal(identity.owner_package_version, FIXTURE_PACKAGE_VERSION);
  }

  assertReaderRefusal(await read({ tool_name: SINGLE_REFERENCE_TOOL, path: REFS_DOC_REFERENCE }),
    TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE, "the docs/_refs reference through the public route");
  const refs = await ownerReader({ docsCarrier: carrier, augmentDescriptor: (descriptor) => ({ ...descriptor,
    tools: descriptor.tools.map((tool) => tool.tool_name === SINGLE_REFERENCE_TOOL
      ? { ...tool, docs_refs: [...tool.docs_refs, REFS_DOC_REFERENCE] } : tool) }) })(
    { tool_name: SINGLE_REFERENCE_TOOL, path: REFS_DOC_REFERENCE });
  assert.equal(refs.ok, true, "the owner still serves a docs/_refs/… entry");
  assert.equal(refs.path, REFS_DOC_REFERENCE);
  assert.equal(refs.text, "BOILERPLATE BYTES\n");
  assert.equal(JSON.stringify(refs).includes(packageDir), false);
  assert.equal(refs.owner_package, FIXTURE_PACKAGE_NAME);
  assert.equal(refs.owner_package_version, FIXTURE_PACKAGE_VERSION);
});
