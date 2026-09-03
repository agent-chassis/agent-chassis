import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWikiRecord,
  readWikiPage
} from "../../packages/wiki-core/src/operations/read.mjs";
import {
  writeValidatedKindRecord
} from "../../packages/wiki-core/src/lib/kind-record-store.mjs";

async function withTempRepo(run) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2400-slice-004-"));
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function validDecision(overrides = {}) {
  return {
    id: "DEC-9001",
    record_kind: "decision",
    title: "Canonical decision fixture",
    status: "proposed",
    date: "2026-08-30",
    owners: ["codex"],
    docs: ["docs/operating-model.md"],
    sections: {
      context: "Context body.",
      decision: "Decision body.",
      consequences: "Consequences body."
    },
    ...overrides
  };
}

function validInitiative(overrides = {}) {
  return {
    id: "IN-9001",
    record_kind: "initiative",
    title: "Canonical initiative fixture",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-08-30",
    updated: "2026-08-30",
    sections: {
      summary: "Summary body.",
      goals: "Goals body.",
      milestones: "Milestones body."
    },
    ...overrides
  };
}

function assertCanonicalResult(result, record, relativePath) {
  assert.equal(result.format, "json-kind-record");
  assert.equal(result.relativePath, relativePath);
  assert.equal(result.canonical_record_path, relativePath);
  assert.equal(result.id, record.id);
  assert.equal(result.record_id, record.id);
  assert.equal(result.record_kind, record.record_kind);
  assert.equal(result.source_classification, "canonical");
  assert.equal(result.classification, "loaded");
  assert.equal(result.valid, true);
  assert.match(result.source_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.record, record);
}

test("registered IN and DEC identity reads return canonical JSON records", async () => {
  await withTempRepo(async (repoRoot) => {
    for (const { record, relativePath } of [
      {
        record: validInitiative(),
        relativePath: "wiki/initiatives/IN-9001.json"
      },
      {
        record: validDecision(),
        relativePath: "wiki/decisions/DEC-9001.json"
      }
    ]) {
      const written = await writeValidatedKindRecord({ repoRoot, record });
      assert.equal(written.written, true);
      const result = await getWikiRecord({ dir: repoRoot, id: record.id });
      assertCanonicalResult(result, record, relativePath);
    }
  });
});

test("exact registered IN and DEC canonical paths return canonical JSON records", async () => {
  await withTempRepo(async (repoRoot) => {
    for (const { record, relativePath } of [
      {
        record: validInitiative(),
        relativePath: "wiki/initiatives/IN-9001.json"
      },
      {
        record: validDecision(),
        relativePath: "wiki/decisions/DEC-9001.json"
      }
    ]) {
      await writeValidatedKindRecord({ repoRoot, record });
      const result = await readWikiPage({ dir: repoRoot, path: relativePath });
      assertCanonicalResult(result, record, relativePath);
    }
  });
});

test("unregistered and arbitrary JSON paths remain rejected", async () => {
  await withTempRepo(async (repoRoot) => {
    const arbitraryPaths = [
      "wiki/initiatives/IN-9001-copy.json",
      "wiki/decisions/DEC-9001-copy.json",
      "wiki/sources/SRC-9001.json",
      "arbitrary.json"
    ];
    for (const relativePath of arbitraryPaths) {
      await mkdir(path.dirname(path.join(repoRoot, relativePath)), { recursive: true });
      await writeFile(path.join(repoRoot, relativePath), "{}\n");
      await assert.rejects(
        readWikiPage({ dir: repoRoot, path: relativePath }),
        /Only markdown pages can be read/u,
        relativePath
      );
    }
  });
});

test("missing canonical JSON propagates store diagnostics without Markdown fallback", async () => {
  await withTempRepo(async (repoRoot) => {
    const projectionPath = path.join(repoRoot, "wiki/initiatives/IN-9001.md");
    await mkdir(path.dirname(projectionPath), { recursive: true });
    await writeFile(projectionPath, "# Projection must not satisfy an identity read\n");

    const byId = await getWikiRecord({ dir: repoRoot, id: "IN-9001" });
    assert.equal(byId.valid, false);
    assert.equal(byId.classification, "missing");
    assert.equal(byId.source_classification, "canonical");
    assert.equal(byId.diagnostics[0].code, "missing_json_record");
    assert.equal("record" in byId, false);

    const explicitProjection = await readWikiPage({
      dir: repoRoot,
      path: "wiki/initiatives/IN-9001.md",
      include_body: true
    });
    assert.equal(explicitProjection.format, "markdown");
    assert.match(explicitProjection.body, /Projection must not satisfy/u);
  });
});

test("invalid JSON, invalid schema, and identity mismatch remain fail-loud store results", async () => {
  await withTempRepo(async (repoRoot) => {
    const decisionDirectory = path.join(repoRoot, "wiki/decisions");
    await mkdir(decisionDirectory, { recursive: true });
    const decisionPath = path.join(decisionDirectory, "DEC-9001.json");

    await writeFile(decisionPath, "{not-json\n");
    const malformed = await getWikiRecord({ dir: repoRoot, id: "DEC-9001" });
    assert.equal(malformed.valid, false);
    assert.equal(malformed.diagnostics[0].code, "invalid_json");

    const invalid = validDecision();
    delete invalid.owners;
    await writeFile(decisionPath, `${JSON.stringify(invalid)}\n`);
    const schemaInvalid = await readWikiPage({
      dir: repoRoot,
      path: "wiki/decisions/DEC-9001.json"
    });
    assert.equal(schemaInvalid.valid, false);
    assert.ok(schemaInvalid.diagnostics.some((entry) => entry.path === "owners"));

    await writeFile(decisionPath, `${JSON.stringify(validDecision({ id: "DEC-9002" }))}\n`);
    const mismatched = await getWikiRecord({ dir: repoRoot, id: "DEC-9001" });
    assert.equal(mismatched.valid, false);
    assert.equal(mismatched.diagnostics[0].code, "record_identity_mismatch");
  });
});

test("serialized IN and DEC mismatch results preserve the requested registered identity", async () => {
  await withTempRepo(async (repoRoot) => {
    for (const fixture of [
      { requestedId: "IN-9001", embeddedId: "IN-9002", record: validInitiative({ id: "IN-9002" }),
        relativePath: "wiki/initiatives/IN-9001.json" },
      { requestedId: "DEC-9001", embeddedId: "DEC-9002", record: validDecision({ id: "DEC-9002" }),
        relativePath: "wiki/decisions/DEC-9001.json" }
    ]) {
      const absolutePath = path.join(repoRoot, fixture.relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `${JSON.stringify(fixture.record)}\n`);
      for (const result of [
        await getWikiRecord({ dir: repoRoot, id: fixture.requestedId }),
        await readWikiPage({ dir: repoRoot, path: fixture.relativePath })
      ]) {
        assert.equal(result.format, "json-kind-record");
        assert.equal(result.id, fixture.requestedId);
        assert.equal(result.record_id, fixture.requestedId);
        assert.equal(result.record.id, fixture.embeddedId);
        assert.equal(result.valid, false);
        assert.equal(result.classification, "invalid_record");
        assert.equal(result.record_kind, fixture.record.record_kind);
        assert.equal(result.source_classification, "canonical");
        assert.equal(result.canonical_record_path, fixture.relativePath);
        assert.match(result.source_digest, /^sha256:[a-f0-9]{64}$/u);
        assert.deepEqual(result.diagnostics.map((entry) => entry.code), ["record_identity_mismatch"]);
      }
    }
  });
});

test("read operation delegates kind authority without local resolver, loader, validator, or fallback copies", async () => {
  const sourcePath = path.resolve(
    "packages/wiki-core/src/operations/read.mjs"
  );
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /from "\.\.\/lib\/kind-record-store\.mjs";/u);
  const implementationSections = [
    source.match(/function serializeJsonKindRecord[\s\S]+?(?=\/\/ ── Graph-evidence)/u)?.[0],
    source.match(/const kindRecordSource = [\s\S]+?(?=ensureReadablePathSuffix)/u)?.[0],
    source.match(/const kindRecordIdentity = [\s\S]+?(?=\n\s*if \(isWorkRecordId)/u)?.[0]
  ];
  assert.equal(
    implementationSections.every((section) => typeof section === "string"),
    true,
    "expected all kind-read delegation sections to remain discoverable"
  );
  const kindReadImplementation = implementationSections.join("\n");
  assert.doesNotMatch(kindReadImplementation, /wiki\/(?:initiatives|decisions)\//u);
  assert.doesNotMatch(kindReadImplementation, /\(IN\|DEC\)|\(DEC\|IN\)/u);
  assert.doesNotMatch(kindReadImplementation, /JSON\.parse/iu);
  assert.doesNotMatch(
    kindReadImplementation,
    /validateRecordByKind|validateDecision|validateInitiative/u
  );
  assert.doesNotMatch(kindReadImplementation, /replace\([^\n]*\.md[^\n]*\.json/iu);
});
