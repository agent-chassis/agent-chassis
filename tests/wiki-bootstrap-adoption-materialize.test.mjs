import { existsSync, readFileSync, readdirSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapRepo,
  createWikiRecord
} from "../packages/wiki-core/src/index.mjs";

import { materializeAdoptionWorkRecord } from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { withTempDir, WK0001_TEMPLATE_DATA } from "./wiki-bootstrap-adoption-helpers.mjs";

test("WK-0784 materialized wiki/work-records/WK-0001.json matches the standalone WK-0001 template", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    const written = JSON.parse(
      await readFile(path.join(tempDir, "wiki", "work-records", "WK-0001.json"), "utf8")
    );

    const expected = materializeAdoptionWorkRecord(WK0001_TEMPLATE_DATA, {
      repo: "agent-chassis/app-demo",
      date: written.created
    });

    const keepExisting = (docs) => docs.filter(
      (doc) => doc !== "wiki/work-records/WK-0001.json" && existsSync(path.join(tempDir, doc))
    );
    expected.read_scope = keepExisting(expected.read_scope);
    for (const slice of expected.slices) {
      slice.read_scope = keepExisting(slice.read_scope);
    }

    assert.deepEqual(
      written,
      expected,
      "the written WK-0001.json must equal the standalone template materialized through the canonical envelope"
    );
  });
});

test("WK-0784 fresh bootstrap seeds the AGENTS boilerplate helper template and does not create root AGENTS.md", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    const seededPath = path.join(tempDir, "wiki", "templates", "AGENTS.md.boilerplate.md");
    assert.ok(existsSync(seededPath), "bootstrap must seed wiki/templates/AGENTS.md.boilerplate.md");

    const sourceTemplate = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../packages/wiki-core/templates/AGENTS.md.boilerplate.md"
    );
    assert.equal(
      readFileSync(seededPath, "utf8"),
      readFileSync(sourceTemplate, "utf8"),
      "seeded helper must match the shipped wiki-core package template byte-for-byte"
    );

    assert.ok(
      !existsSync(path.join(tempDir, "AGENTS.md")),
      "bootstrap must not create root AGENTS.md"
    );

    assert.equal(result.agentsBoilerplateTemplate.path, "wiki/templates/AGENTS.md.boilerplate.md");
    assert.equal(result.agentsBoilerplateTemplate.state, "created");
    assert.equal(
      result.agentsNextStep.boilerplateSource,
      "wiki/templates/AGENTS.md.boilerplate.md"
    );

    const wk0001 = JSON.parse(
      readFileSync(path.join(tempDir, "wiki", "work-records", "WK-0001.json"), "utf8")
    );
    const repoLocalAgents = wk0001.slices.find((s) => s.id === "SLICE-001");
    assert.ok(repoLocalAgents, "WK-0001 must carry the SLICE-001 repo-local AGENTS.md slice");

    assert.deepEqual(
      repoLocalAgents.read_scope,
      ["wiki/templates/AGENTS.md.boilerplate.md"],
      "materialized SLICE-001 read_scope must keep only the seeded AGENTS helper"
    );

    const rerun = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
    assert.equal(
      rerun.agentsBoilerplateTemplate.state,
      "kept",
      "rerun must keep the unchanged seeded helper"
    );
  });
});

test("WK-1994 fresh bootstrap creates no docs/adoption.md and reports no adoption-guide field", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    assert.ok(
      !existsSync(path.join(tempDir, "docs", "adoption.md")),
      "bootstrap must not create a consumer-local docs/adoption.md"
    );

    const guideFields = Object.keys(result).filter((key) =>
      /adoption[-_]?(doc|guide)/i.test(key)
    );
    assert.deepEqual(
      guideFields,
      [],
      "the bootstrap result must carry no adoption-guide field"
    );
  });
});

test("WK-1994 the wiki-core adoption-guide template is not shipped", () => {
  const packageTemplatesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../packages/wiki-core/templates"
  );

  const adoptionGuideTemplates = readdirSync(packageTemplatesDir).filter((name) =>
    /^adoption\b/i.test(name)
  );
  assert.deepEqual(
    adoptionGuideTemplates,
    [],
    `no shipped wiki-core template may render a consumer adoption guide; found ${adoptionGuideTemplates.join(", ")}`
  );
});

test("WK-1994 bootstrap rerun neither inspects nor deletes a consumer-authored docs/adoption.md", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    const docsDir = path.join(tempDir, "docs");
    await mkdir(docsDir, { recursive: true });
    const docPath = path.join(docsDir, "adoption.md");
    const authored = "# Our own adoption notes\n\nRepo-specific operating notes.\n";
    await writeFile(docPath, authored, "utf8");

    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    assert.equal(
      readFileSync(docPath, "utf8"),
      authored,
      "bootstrap rerun must leave a consumer-authored docs/adoption.md byte-identical"
    );
  });
});

test("WK-0784 bootstrap materializes WK-0001 and advances the allocator so the first user WK is WK-0002", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    assert.deepEqual(
      result.adoptionWorkRecords.created.map((r) => r.recordId),
      ["WK-0001"],
      "fresh bootstrap must create the canonical WK-0001 work record"
    );
    await access(path.join(tempDir, "wiki", "work-records", "WK-0001.json"));

    const created = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "First user-created work item"
    });
    assert.equal(created.id, "WK-0002", "first user-created WK after bootstrap must be WK-0002");

    const rerun = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
    assert.deepEqual(
      rerun.adoptionWorkRecords.created.map((r) => r.recordId),
      [],
      "rerun must not recreate WK-0001"
    );
    assert.deepEqual(
      rerun.adoptionWorkRecords.kept.map((r) => r.recordId),
      ["WK-0001"],
      "rerun must keep the existing WK-0001"
    );
  });
});
