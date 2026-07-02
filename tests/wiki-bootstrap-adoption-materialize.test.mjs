import { existsSync, readFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
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
    const keepExisting = (docs) => docs.filter((doc) => existsSync(path.join(tempDir, doc)));
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
    const repoLocalAgents = wk0001.slices.find((s) => s.id === "repo-local-agents");
    assert.ok(repoLocalAgents, "WK-0001 must carry the repo-local-agents slice");

    assert.deepEqual(
      repoLocalAgents.read_scope,
      ["docs/adoption.md", "wiki/templates/AGENTS.md.boilerplate.md"],
      "materialized repo-local-agents.read_scope must keep the seeded docs/adoption.md and AGENTS helper"
    );

    const rerun = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
    assert.equal(
      rerun.agentsBoilerplateTemplate.state,
      "kept",
      "rerun must keep the unchanged seeded helper"
    );
  });
});

test("WK-0795 fresh bootstrap seeds docs/adoption.md from the package template with the repo substituted", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    assert.ok(result.adoptionDoc, "bootstrapRepo must report adoptionDoc");
    assert.equal(result.adoptionDoc.path, "docs/adoption.md");
    assert.equal(result.adoptionDoc.state, "created");

    const docPath = path.join(tempDir, "docs", "adoption.md");
    assert.ok(existsSync(docPath), "bootstrap must seed docs/adoption.md");
    const doc = readFileSync(docPath, "utf8");

    assert.ok(doc.includes("agent-chassis/app-demo"), "seeded doc must substitute {{REPO}} with the repo id");
    assert.ok(!doc.includes("{{REPO}}"), "seeded doc must not leave {{REPO}} unresolved");

    assert.match(doc, /npx -p @agent-chassis\/wiki-cli wiki /, "seeded doc must show the canonical command form");

    assert.ok(
      doc.includes("wiki/work-records/WK-*.json"),
      "seeded doc must name wiki/work-records/WK-*.json as canonical work-record authority"
    );
    assert.doesNotMatch(
      doc,
      /`wiki\/issues\/WK-\*\.md` is (the )?canonical/i,
      "seeded doc must NOT claim wiki/issues/WK-*.md is canonical work authority"
    );

    assert.match(doc, /<!--\s*wiki:\s*id=WK-0001/, "seeded doc must carry the WK-0001 backlink for reciprocity");

    assert.ok(doc.includes("wiki/.wiki-mcp.json"), "seeded doc must describe wiki/.wiki-mcp.json local metadata");
  });
});

test("WK-0795 bootstrap rerun preserves a customized docs/adoption.md (create-if-missing)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    const docPath = path.join(tempDir, "docs", "adoption.md");
    const customized = "# Custom adoption guide\n\nRepo-specific operating notes.\n";
    await writeFile(docPath, customized, "utf8");

    const rerun = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
    assert.equal(
      rerun.adoptionDoc.state,
      "kept",
      "rerun must report the customized docs/adoption.md as kept"
    );
    assert.equal(
      readFileSync(docPath, "utf8"),
      customized,
      "bootstrap rerun must not overwrite a customized docs/adoption.md"
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
