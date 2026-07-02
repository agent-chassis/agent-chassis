import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  bootstrapRepo,
  lintRepo
} from "../packages/wiki-core/src/index.mjs";

async function withTempDir(fn) {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "agent-chassis-wiki-non-wk-doc-backlinks-")
  );
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFixtureFile(tempDir, relativePath, content) {
  const filePath = path.join(tempDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function buildMinimalWorkRecordJson({ id, title, docs }) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/app-demo",
    title,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "codex",
    created: "2026-05-19",
    updated: "2026-05-19",
    initiative: null,
    area: null,
    resolution: "unresolved",
    severity: null,
    target: null,
    started: null,
    completed: null,
    tags: [],
    docs,
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    assignees: [],
    agents: [],
    reviewers: [],
    children: [],
    slices: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [],
      validation: []
    },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: {
        items: [],
        out_of_scope: []
      },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    escalations: [],
    projections: [],
    migration: null
  };
}

async function writeBacklinkFixtureRepo(
  tempDir,
  {
    includeBacklinks,
    sourceRelatedDocsTarget = "docs/src-reference.md",
    backlinkRelation = "tracks"
  }
) {
  await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/app-demo" });
  await writeFixtureFile(
    tempDir,
    "wiki/.id-state.json",
    `${JSON.stringify({ work_item: 1, initiative: 1, decision: 1, source: 1 }, null, 2)}\n`
  );

  const docBodies = {
    "docs/in-reference.md": includeBacklinks
      ? `<!-- wiki: id=IN-0001 relation=${backlinkRelation} -->\n# Initiative Reference\n`
      : "# Initiative Reference\n",
    "docs/dec-reference.md": includeBacklinks
      ? `<!-- wiki: id=DEC-0001 relation=${backlinkRelation} -->\n# Decision Reference\n`
      : "# Decision Reference\n",
    "docs/src-reference.md": includeBacklinks
      ? `<!-- wiki: id=SRC-0001 relation=${backlinkRelation} -->\n# Source Reference\n`
      : "# Source Reference\n",
    "docs/wk-reference.md": includeBacklinks
      ? `<!-- wiki: id=WK-0001 relation=${backlinkRelation} -->\n# Work Record Reference\n`
      : "# Work Record Reference\n"
  };
  for (const [relativePath, body] of Object.entries(docBodies)) {
    await writeFixtureFile(tempDir, relativePath, body);
  }

  await writeFixtureFile(
    tempDir,
    "wiki/initiatives/IN-0001.md",
    `---
id: IN-0001
title: Fixture Initiative
status: todo
priority: medium
owner: codex
created: 2026-05-19
updated: 2026-05-19
docs:
  - docs/in-reference.md
---

# Fixture Initiative
`
  );

  await writeFixtureFile(
    tempDir,
    "wiki/decisions/DEC-0001.md",
    `---
id: DEC-0001
title: Fixture Decision
status: accepted
date: 2026-05-19
owners:
  - codex
docs:
  - docs/dec-reference.md
related: []
supersedes:
superseded_by:
---

# Fixture Decision
`
  );

  await writeFixtureFile(
    tempDir,
    "wiki/sources/SRC-0001.md",
    `---
id: SRC-0001
title: Fixture Source
kind: web
captured: 2026-05-19
updated: 2026-05-19
source_uri: https://example.com/source
authority: primary
immutable_hint: url
related_docs:
  - ${sourceRelatedDocsTarget}
related_work: []
---

# Fixture Source
`
  );

  await writeFixtureFile(
    tempDir,
    "wiki/work-records/WK-0001.json",
    `${JSON.stringify(
      buildMinimalWorkRecordJson({
        id: "WK-0001",
        title: "Fixture Work Record",
        docs: ["docs/wk-reference.md"]
      }),
      null,
      2
    )}\n`
  );
}

test("lint reports missing docs backlinks for IN, DEC, SRC, and unchanged WK JSON references", async () => {
  await withTempDir(async (tempDir) => {
    await writeBacklinkFixtureRepo(tempDir, { includeBacklinks: false });

    const lint = await lintRepo({ dir: tempDir });

    assert.equal(lint.ok, false);
    for (const docPath of [
      "docs/in-reference.md",
      "docs/dec-reference.md",
      "docs/src-reference.md",
      "docs/wk-reference.md"
    ]) {
      assert.ok(
        lint.findings.some(
          (finding) =>
            finding.code === "missing_docs_backlink" &&
            finding.path === docPath
        ),
        `expected missing_docs_backlink for ${docPath}`
      );
    }
  });
});

test("lint accepts satisfied docs backlinks for IN, DEC, SRC, and unchanged WK JSON references", async () => {
  await withTempDir(async (tempDir) => {
    await writeBacklinkFixtureRepo(tempDir, { includeBacklinks: true });

    const lint = await lintRepo({ dir: tempDir });

    assert.equal(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_docs_backlink" &&
          finding.path === "docs/in-reference.md"
      ),
      false
    );
    assert.equal(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_docs_backlink" &&
          finding.path === "docs/dec-reference.md"
      ),
      false
    );
    assert.equal(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_docs_backlink" &&
          finding.path === "docs/src-reference.md"
      ),
      false
    );
    assert.equal(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_docs_backlink" &&
          finding.path === "docs/wk-reference.md"
      ),
      false
    );
  });
});

test("lint reports missing docs backlinks when comment id matches but relation is not tracks", async () => {
  await withTempDir(async (tempDir) => {
    await writeBacklinkFixtureRepo(tempDir, {
      includeBacklinks: true,
      backlinkRelation: "evidence_for"
    });

    const lint = await lintRepo({ dir: tempDir });

    assert.equal(lint.ok, false);
    for (const docPath of [
      "docs/in-reference.md",
      "docs/dec-reference.md",
      "docs/src-reference.md",
      "docs/wk-reference.md"
    ]) {
      assert.ok(
        lint.findings.some(
          (finding) =>
            finding.code === "missing_docs_backlink" &&
            finding.path === docPath
        ),
        `expected missing_docs_backlink for ${docPath} when backlink relation is evidence_for instead of tracks`
      );
    }
  });
});

test("lint reports missing_related_docs_target for nonexistent SRC related_docs targets", async () => {
  await withTempDir(async (tempDir) => {
    await writeBacklinkFixtureRepo(tempDir, {
      includeBacklinks: true,
      sourceRelatedDocsTarget: "docs/missing-source-target.md"
    });

    const lint = await lintRepo({ dir: tempDir });

    assert.equal(lint.ok, false);
    assert.ok(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_related_docs_target" &&
          finding.path === "wiki/sources/SRC-0001.md"
      ),
      "expected missing_related_docs_target for SRC-0001.md"
    );
    assert.equal(
      lint.findings.some(
        (finding) =>
          finding.code === "missing_docs_backlink" &&
          finding.path === "docs/missing-source-target.md"
      ),
      false
    );
  });
});
