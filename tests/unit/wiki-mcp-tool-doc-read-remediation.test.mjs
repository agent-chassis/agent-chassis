import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  errorContent,
  guardToolHandler,
  jsonContent
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  bindPackageDocsCarrier,
  registerToolDocReadTools,
  TOOL_DOC_READ_DIAGNOSTIC_CODES
} from "../../packages/wiki-mcp/src/lib/tool-doc-read-tools.mjs";

const ADVERTISING_TOOL = "workspace_search_repo";
const PLAIN_DOC_REFERENCE = "docs/mcp-integration.md";
const REFS_DOC_REFERENCE = "packages/wiki-core/templates/AGENTS.md.boilerplate.md";
const REFS_BUNDLE_PATH = "docs/_refs/packages/wiki-core/templates/AGENTS.md.boilerplate.md";

const FIXTURE_PACKAGE_NAME = "@agent-chassis/core";
const FIXTURE_PACKAGE_VERSION = "0.6.0";

function registerDocReadHandler({
  docsCarrier,
  sessionRole = "orchestrator",
  registeredTier = "free_local"
} = {}) {
  const handlers = new Map();
  registerToolDocReadTools({
    registerTool(name, _definition, handler) {
      handlers.set(name, guardToolHandler(handler, { name }));
    },
    z,
    jsonContent,
    errorContent,
    docsCarrier,
    sessionRole,
    registeredTier
  });
  return handlers.get("workspace_read_tool_doc");
}

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
  await writeFile(path.join(packageDir, "docs", "mcp-integration.md"), "PACKAGE DOC BYTES\n", "utf8");
  await writeFile(path.join(packageDir, REFS_BUNDLE_PATH), "BOILERPLATE BYTES\n", "utf8");
  await writeFile(
    path.join(packageDir, "docs", "public-docs-manifest.json"),
    manifestBody([
      entry(PLAIN_DOC_REFERENCE, "docs/mcp-integration.md"),
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
  const temporaryRoot = await makeTemporaryRoot(t, "binding");

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

    const read = registerDocReadHandler({ docsCarrier: carrier });
    const refused = await read({ tool_name: ADVERTISING_TOOL, path: PLAIN_DOC_REFERENCE });
    assert.equal(refused.isError, true, `${label}: the read must refuse`);

    assert.notEqual(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE,
      `${label}: a broken carrier must not be reported as an unadvertised reference`
    );
    assert.equal(refused.structuredContent.code, expected, `${label}: public read-route diagnostic`);
    assert.equal(refused.structuredContent.schema_version, "tool-doc-read-refusal.v1");
    assert.equal(refused.structuredContent.ok, false);
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

test("WK-2139 remediation: input shape and session visibility still refuse ahead of the carrier", async () => {

  const broken = await bindPackageDocsCarrier(null);
  assert.equal(broken.bound, false);

  const read = registerDocReadHandler({ docsCarrier: broken });
  for (const candidate of ["/etc/passwd", "../../etc/passwd", "docs/../../package.json", ""]) {
    const refused = await read({ tool_name: ADVERTISING_TOOL, path: candidate });
    assert.equal(refused.isError, true, `path ${JSON.stringify(candidate)} must refuse`);
    assert.equal(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.INVALID_PATH,
      `path ${JSON.stringify(candidate)} must still refuse on input shape, before the carrier`
    );
  }

  const hidden = await read({ tool_name: "not_a_tool", path: PLAIN_DOC_REFERENCE });
  assert.equal(hidden.isError, true);
  assert.equal(
    hidden.structuredContent.code,
    TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL,
    "a tool this session cannot see must still refuse on visibility, before the carrier"
  );

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "wk2139-remediation-still-"));
  try {
    const packageDir = path.join(temporaryRoot, "package");
    await writeServingPackage(packageDir);
    const carrier = await carrierFor(packageDir);
    assert.equal(carrier.bound, true);
    const boundRead = registerDocReadHandler({ docsCarrier: carrier });
    const refused = await boundRead({ tool_name: ADVERTISING_TOOL, path: "docs/tool-discovery.md" });
    assert.equal(refused.isError, true);
    assert.equal(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE,
      "a bound carrier that does not serve the path keeps the unadvertised attribution"
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("WK-2139 remediation: a docsRoot that is not inside the package root is an unavailable carrier", async (t) => {
  const temporaryRoot = await makeTemporaryRoot(t, "docsroot");
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

    const read = registerDocReadHandler({ docsCarrier: carrier });
    const refused = await read({ tool_name: ADVERTISING_TOOL, path: PLAIN_DOC_REFERENCE });
    assert.equal(refused.isError, true, `${label}: the read must refuse`);
    assert.equal(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      `${label}: the public read route must report the carrier as unavailable`
    );
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
    entry("docs/tool-discovery.md", "lib/internal.md"),
    entry("docs/tool-discovery-surfaces.md", "docs-the project documentation")
  ]);

  const carrier = await carrierFor(packageDir);
  assert.equal(carrier.bound, true, "the fixture package must bind");
  const read = registerDocReadHandler({ docsCarrier: carrier });

  for (const [label, reference, leaked] of [
    ["a sibling directory of the bundle", "docs/tool-discovery.md", "PACKAGE INTERNALS"],
    [
      "a sibling sharing the bundle's name prefix",
      "docs/tool-discovery-surfaces.md",
      "SIBLING PREFIX BYTES"
    ]
  ]) {
    const refused = await read({ tool_name: ADVERTISING_TOOL, path: reference });
    assert.equal(refused.isError, true, `${label}: must refuse`);
    assert.equal(
      refused.structuredContent.code,
      TOOL_DOC_READ_DIAGNOSTIC_CODES.PATH_CONTAINMENT,
      `${label}: must refuse with the containment diagnostic`
    );
    assert.doesNotMatch(
      JSON.stringify(refused),
      new RegExp(leaked, "u"),
      `${label}: the refusal must not carry the unauthorized bytes`
    );
    assertNoRootDisclosure(refused.structuredContent, [temporaryRoot, packageDir], label);
  }

  const plain = await read({ tool_name: ADVERTISING_TOOL, path: PLAIN_DOC_REFERENCE });
  assert.equal(plain.isError, undefined, "a docs/… entry must still be served");
  assert.equal(plain.structuredContent.ok, true);
  assert.equal(plain.structuredContent.path, PLAIN_DOC_REFERENCE);
  assert.equal(plain.structuredContent.text, "PACKAGE DOC BYTES\n");

  const refs = await read({ tool_name: ADVERTISING_TOOL, path: REFS_DOC_REFERENCE });
  assert.equal(refs.isError, undefined, "a docs/_refs/… entry must still be served");
  assert.equal(refs.structuredContent.ok, true);
  assert.equal(refs.structuredContent.path, REFS_DOC_REFERENCE);
  assert.equal(refs.structuredContent.text, "BOILERPLATE BYTES\n");

  for (const served of [plain, refs]) {
    assert.equal(
      JSON.stringify(served.structuredContent).includes(packageDir),
      false,
      "a served result must never disclose the package installation root"
    );
    assert.equal(served.structuredContent.owner_package, FIXTURE_PACKAGE_NAME);
    assert.equal(served.structuredContent.owner_package_version, FIXTURE_PACKAGE_VERSION);
  }
});
