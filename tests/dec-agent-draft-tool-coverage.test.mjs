

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";

import {
  writeValidatedKindRecord,
  getKindRecordPath
} from "../packages/wiki-core/src/lib/kind-record-store.mjs";
import { renderRecordByKindMarkdown } from "../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";
import * as planners from "../packages/wiki-core/src/lib/kind-record-edit.mjs";
import * as operations from "../packages/wiki-core/src/operations/kind-record-edit.mjs";

const {
  amendKindRecordScalar,
  amendKindRecordSection,
  rejectDecisionRecord
} = operations;
const { setScalar } = planners;

const WHOAMI = os.userInfo().username;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function withTempRepo(fn) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-wk-1513-slice-006-"));
  try {
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function proposedDecision(overrides = {}) {
  return {
    id: "DEC-9513",
    record_kind: "decision",
    title: "Agent draft-lane fixture decision",
    status: "proposed",
    date: "2026-07-11",
    owners: ["codex"],
    sections: {
      context: "Original context body.",
      decision: "Original decision body.",
      consequences: "Original consequences body."
    },
    ...overrides
  };
}

async function seed(repoRoot, record) {
  const result = await writeValidatedKindRecord({ repoRoot, record });
  assert.equal(result.written, true, `seed write should succeed for ${record.id}`);
  return result;
}

async function readJson(repoRoot, record) {
  const relativeJsonPath = await getKindRecordPath(record.record_kind, record.id);
  return JSON.parse(await readFile(path.resolve(repoRoot, relativeJsonPath), "utf8"));
}

async function readMarkdown(repoRoot, record) {
  const relativeJsonPath = await getKindRecordPath(record.record_kind, record.id);
  const relativeMarkdownPath = relativeJsonPath.replace(/\.json$/, ".md");
  return readFile(path.resolve(repoRoot, relativeMarkdownPath), "utf8");
}

async function assertLockstep(repoRoot, record) {
  const onDiskJson = await readJson(repoRoot, record);
  const projection = renderRecordByKindMarkdown(onDiskJson);
  assert.equal(projection.valid, true, "projection of the on-disk record must be valid");
  const onDiskMarkdown = await readMarkdown(repoRoot, record);
  assert.equal(onDiskMarkdown, projection.markdown, ".md must match the canonical projection of the .json");
  return onDiskJson;
}

test("agent fully authors and rejects a proposed DEC via the kind-record-edit operations", async () => {
  await withTempRepo(async (repoRoot) => {
    const record = proposedDecision();
    await seed(repoRoot, record);

    const owners = await amendKindRecordScalar({
      repoRoot,
      id: record.id,
      field: "owners",
      value: ["codex", "bryan"]
    });
    assert.equal(owners.ok, true, "owners is settable on a proposed DEC");
    assert.equal(owners.written, true);
    assert.ok(owners.changedFields.includes("owners"));

    const date = await amendKindRecordScalar({
      repoRoot,
      id: record.id,
      field: "date",
      value: "2026-07-12"
    });
    assert.equal(date.ok, true, "date is settable on a proposed DEC");
    assert.equal(date.written, true);

    for (const [field, value] of [
      ["area", "governance"],
      ["docs", ["docs/decisions.md"]],
      ["related", ["DEC-0152", "DEC-0155"]]
    ]) {
      const scalar = await amendKindRecordScalar({ repoRoot, id: record.id, field, value });
      assert.equal(scalar.ok, true, `${field} is settable on a proposed DEC`);
      assert.equal(scalar.written, true, `${field} edit persisted`);
    }

    for (const section of ["context", "decision", "consequences"]) {
      const result = await amendKindRecordSection({
        repoRoot,
        id: record.id,
        section,
        value: `Agent-authored ${section} body.`
      });
      assert.equal(result.ok, true, `section ${section} is amendable on a proposed DEC`);
      assert.equal(result.written, true, `section ${section} edit persisted`);
    }

    let onDiskJson = await assertLockstep(repoRoot, record);
    assert.deepEqual(onDiskJson.owners, ["codex", "bryan"]);
    assert.equal(onDiskJson.date, "2026-07-12");
    assert.equal(onDiskJson.area, "governance");
    assert.deepEqual(onDiskJson.docs, ["docs/decisions.md"]);
    assert.deepEqual(onDiskJson.related, ["DEC-0152", "DEC-0155"]);
    assert.equal(onDiskJson.sections.context, "Agent-authored context body.");
    assert.equal(onDiskJson.sections.decision, "Agent-authored decision body.");
    assert.equal(onDiskJson.sections.consequences, "Agent-authored consequences body.");
    assert.equal(onDiskJson.status, "proposed", "still proposed before the reject flip");
    assert.equal(onDiskJson.updated_by, WHOAMI, "server-resolved actor stamped on edits");
    assert.match(onDiskJson.updated, DATE_RE);

    const rejected = await rejectDecisionRecord({ repoRoot, id: record.id });
    assert.equal(rejected.ok, true, "an agent may reject its own proposed draft");
    assert.equal(rejected.written, true);
    assert.ok(rejected.changedFields.includes("status"));

    onDiskJson = await assertLockstep(repoRoot, record);
    assert.equal(onDiskJson.status, "rejected", "proposed -> rejected persisted");

    assert.ok(!("ratified" in onDiskJson) || onDiskJson.ratified == null, "reject leaves ratified unset");
    assert.ok(
      !("ratified_by" in onDiskJson) || onDiskJson.ratified_by == null,
      "reject leaves ratified_by unset"
    );
    assert.equal(onDiskJson.updated_by, WHOAMI);
  });
});

test("rejectDecisionRecord refuses an accepted DEC with no write (symmetric guarantee)", async () => {
  await withTempRepo(async (repoRoot) => {
    const record = proposedDecision({ status: "accepted", ratified: "2026-07-10", ratified_by: WHOAMI });
    await seed(repoRoot, record);

    const jsonBefore = await readJson(repoRoot, record);
    const mdBefore = await readMarkdown(repoRoot, record);

    const refused = await rejectDecisionRecord({ repoRoot, id: record.id });
    assert.equal(refused.ok, false, "an agent cannot reject an accepted DEC");
    assert.equal(refused.written, false);
    assert.ok(
      refused.diagnostics.some((entry) => entry.code === "invalid_lifecycle_transition"),
      "the refusal is an invalid_lifecycle_transition, not a silent success"
    );

    assert.deepEqual(await readJson(repoRoot, record), jsonBefore, ".json untouched after refusal");
    assert.equal(await readMarkdown(repoRoot, record), mdBefore, ".md untouched after refusal");
  });
});

test("setScalar refuses managed status/ratified fields - no scalar backdoor to accepted-unlock", () => {
  const record = proposedDecision();
  for (const [field, value] of [
    ["status", "superseded"],
    ["status", "expired"],
    ["status", "deprecated"],
    ["status", "accepted"],
    ["ratified", "2026-07-12"],
    ["ratified_by", WHOAMI]
  ]) {
    const result = setScalar({ record, field, value, actor: WHOAMI, now: "2026-07-12" });
    assert.equal(result.ok, false, `setScalar must refuse managed field ${field}`);
    assert.equal(result.updatedRecord, null, "a refused scalar edit yields no record");
    assert.ok(
      result.diagnostics.some((entry) => entry.code === "managed_field"),
      `refusing ${field} is a managed_field diagnostic`
    );
  }
});

test("the kind-record-edit surface exposes no accepted-unlocking transition", () => {
  const unlockPattern = /supersede|expire|deprecat/i;
  for (const [label, module] of [
    ["planners", planners],
    ["operations", operations]
  ]) {
    for (const exportName of Object.keys(module)) {
      assert.ok(
        !unlockPattern.test(exportName),
        `${label} must not export an accepted-unlocking transition (${exportName})`
      );
    }
  }

  assert.equal(typeof planners.ratify, "function");
  assert.equal(typeof planners.unratify, "function");
  assert.equal(typeof planners.reject, "function");
});

test("session-role-tool-access grants reject to orchestrator; ratify/unratify are not MCP tools at all", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const policyPath = path.resolve(
    here,
    "../packages/wiki-core/data/tool-discovery/session-role-tool-access.json"
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const access = policy.access;

  assert.ok(
    access.workspace_decision_reject.includes("orchestrator"),
    "an agent role (orchestrator) may reject its own proposed draft"
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(access, "workspace_decision_ratify"),
    false,
    "workspace_decision_ratify must not appear in the role-access policy"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(access, "workspace_decision_unratify"),
    false,
    "workspace_decision_unratify must not appear in the role-access policy"
  );
  for (const [toolName, roles] of Object.entries(access)) {
    assert.ok(
      !/^workspace_decision_(?:un)?ratify$/u.test(toolName),
      `${toolName} must not be granted to ${JSON.stringify(roles)}`
    );
  }

  assert.deepEqual(
    Object.keys(access).filter((name) => name.startsWith("workspace_decision_")).sort(),
    [
      "workspace_decision_amend_scalar",
      "workspace_decision_amend_section",
      "workspace_decision_create",
      "workspace_decision_reject"
    ],
    "the MCP decision surface is exactly the proposed lane"
  );
});

test("registerKindRecordWriteTools registers the proposed lane without ratify/unratify", async () => {
  const { registerKindRecordWriteTools } = await import(
    "../packages/wiki-mcp/src/lib/kind-record-write-tools.mjs"
  );
  const { z } = await import("zod");

  const registered = [];
  registerKindRecordWriteTools({
    registerTool: (name) => {
      registered.push(name);
    },
    workspaceRepos: [],
    z,
    jsonContent: () => ({}),
    errorContent: () => ({}),
    resolveWorkspaceRepo: () => ({ repo: "test", dir: "/tmp/does-not-exist" })
  });

  assert.deepEqual(
    registered.filter((name) => name.startsWith("workspace_decision_")).sort(),
    [
      "workspace_decision_amend_scalar",
      "workspace_decision_amend_section",
      "workspace_decision_create",
      "workspace_decision_reject"
    ]
  );
  assert.equal(registered.includes("workspace_decision_ratify"), false);
  assert.equal(registered.includes("workspace_decision_unratify"), false);
});
