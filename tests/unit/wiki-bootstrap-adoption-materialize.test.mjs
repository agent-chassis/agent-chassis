import { existsSync, readFileSync, readdirSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapRepo,
  createWikiRecord
} from "../../packages/wiki-core/src/index.mjs";

import { withTempDir } from "../wiki-bootstrap-adoption-helpers.mjs";

test("WK-0784 fresh bootstrap seeds the AGENTS boilerplate helper template and does not create root AGENTS.md", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    const seededPath = path.join(tempDir, "wiki", "templates", "AGENTS.md.boilerplate.md");
    assert.ok(existsSync(seededPath), "bootstrap must seed wiki/templates/AGENTS.md.boilerplate.md");

    const sourceTemplate = path.resolve(
      path.dirname(path.dirname(fileURLToPath(import.meta.url))),
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

    await assert.rejects(
      access(path.join(tempDir, "wiki", "work-records", "WK-0001.json")),
      /ENOENT/
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
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
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

test("fresh bootstrap leaves WK-0001 allocator-eligible", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });

    assert.equal("adoptionWorkRecords" in result, false);
    await assert.rejects(
      access(path.join(tempDir, "wiki", "work-records", "WK-0001.json")),
      /ENOENT/
    );

    const created = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "First user-created work item"
    });
    assert.equal(created.id, "WK-0001");

    const rerun = await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
    assert.equal("adoptionWorkRecords" in rerun, false);
  });
});
