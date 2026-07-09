import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { registerIntegrationStatusTools } from "../packages/wiki-mcp/src/lib/integration-status-tools.mjs";

const fakeZ = { string: () => ({ optional() { return this; } }) };

async function withWorkspace(files, fn) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "workspace-integration-status-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(workspaceDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

function createRegisteredTool(workspaceDir) {
  const registrations = new Map();
  registerIntegrationStatusTools({
    registerTool(name, definition, handler) {
      registrations.set(name, { definition, handler });
    },
    workspaceRepos: [{ repo: "fixture", dir: workspaceDir }],
    z: fakeZ,
    jsonContent(structuredContent) {
      return { structuredContent, isError: false };
    },
    errorContent(error) {
      return {
        isError: true,
        structuredContent: {
          message: error instanceof Error ? error.message : String(error)
        }
      };
    },
    resolveWorkspaceRepo(workspaceRepos, repo) {
      const selected = workspaceRepos.find((entry) => entry.repo === (repo || "fixture"));
      if (!selected) throw new Error(`unknown repo: ${repo}`);
      return selected;
    }
  });

  const tool = registrations.get("workspace_integration_status");
  assert.ok(tool, "workspace_integration_status should be registered");
  return tool;
}

async function callStatus(workspaceDir, args) {
  const tool = createRegisteredTool(workspaceDir);
  return tool.handler(args);
}

const fixtureInitiative = (related) =>
  ["---", "related:", ...related.map((id) => `  - ${id}`), "---", "", "# Fixture initiative", ""].join("\n");

function fixtureRecord(overrides) {
  const base = {
    schema_version: "work-record.v1",
    repo: "agent-chassis/agent-chassis",
    title: `${overrides.id} title`,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-07-08",
    updated: "2026-07-08",
    related: ["IN-0021"],
    slices: [{ id: "SLICE-001" }]
  };
  return JSON.stringify({ ...base, ...overrides }, null, 2);
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

test("workspace_integration_status requires initiative and rejects caller authority fields", async () => {
  await withWorkspace({}, async (workspaceDir) => {
    const missing = await callStatus(workspaceDir, { repo: "fixture" });
    assert.equal(missing.isError, true);
    assert.match(missing.structuredContent.message, /requires initiative like IN-0021/);

    const forbiddenFields = ["root", "gitDir", "branch", "worktreePath", "policy", "evidence", "identity"];
    for (const field of forbiddenFields) {
      const response = await callStatus(workspaceDir, { repo: "fixture", initiative: "IN-0021", [field]: "caller supplied" });
      assert.equal(response.isError, true, `${field} should be rejected`);
      assert.match(response.structuredContent.message, /accepts only repo and initiative/);
      assert.match(response.structuredContent.message, new RegExp(field));
    }
  });
});

test("workspace_integration_status reports fixture WK inventory and explicit non-authority local facts", async () => {
  await withWorkspace({
    "wiki/initiatives/IN-0021.md": fixtureInitiative(["WK-1442", "WK-1999"]),
    "wiki/work-records/WK-1442.json": fixtureRecord({
      id: "WK-1442",
      title: "Adopt branch worktree dispatch",
      status: "done"
    })
  }, async (workspaceDir) => {
    const response = await callStatus(workspaceDir, { repo: "fixture", initiative: "IN-0021" });
    assert.equal(response.isError, false);

    const body = response.structuredContent;
    assert.equal(body.schema_version, "workspace-integration-status.v1");
    assert.equal(body.initiative, "IN-0021");
    assert.equal(body.expected_integration_ref, "integration/IN-0021");
    assert.equal(body.expected_wk_branch_pattern, "wk/IN-0021/WK-YYYY");
    assert.equal(body.sources.initiative.exists, true);
    assert.deepEqual(body.sources.initiative.related, ["WK-1442", "WK-1999"]);
    assert.equal(body.sources.work_records.matched_count, 1);
    assert.deepEqual(body.sources.work_records.record_errors, []);

    const byId = Object.fromEntries(body.work_records.map((row) => [row.id, row]));
    assert.equal(body.work_records.length, 2);
    assert.deepEqual(byId["WK-1442"], {
      id: "WK-1442",
      title: "Adopt branch worktree dispatch",
      status: "done",
      work_kind: "implementation",
      source_path_relative: "wiki/work-records/WK-1442.json",
      expected_branch: "wk/IN-0021/WK-1442",
      slice_count: 1
    });
    assert.deepEqual(byId["WK-1999"], {
      id: "WK-1999",
      title: null,
      status: "unknown",
      work_kind: "unknown",
      source_path_relative: null,
      expected_branch: "wk/IN-0021/WK-1999",
      slice_count: null
    });

    assert.deepEqual(
      Object.fromEntries(Object.entries(body.local_facts).map(([key, fact]) => [key, fact.status])),
      {
        git_tip: "unknown",
        worktree_path: "unknown",
        lease: "not_available",
        quiescence: "not_evaluated",
        detached_merge_workspace: "not_available",
        complete_touched_paths: "unknown",
        mergeability: "not_evaluated",
        policy_admissibility: "not_evaluated"
      }
    );
    assert.deepEqual(body.local_facts.policy_admissibility, {
      status: "not_evaluated",
      authority: "not_available",
      reason: "local coordination status is not a policy authority"
    });

    const forbiddenGreenLightKeys = ["dispatchable", "review_passed", "promotion_authorized", "policy_admitted", "policy_satisfied", "merge_authorized"];
    const keys = collectKeys(body);
    assert.deepEqual(keys.filter((key) => forbiddenGreenLightKeys.includes(key)), []);
  });
});

test("workspace_integration_status reports malformed WK JSON as an explicit inventory error", async () => {
  await withWorkspace({
    "wiki/initiatives/IN-0021.md": fixtureInitiative([]),
    "wiki/work-records/WK-1442.json": "{ invalid json"
  }, async (workspaceDir) => {
    const response = await callStatus(workspaceDir, { repo: "fixture", initiative: "IN-0021" });
    assert.equal(response.isError, false);

    const errors = response.structuredContent.sources.work_records.record_errors;
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, "WK-1442");
    assert.equal(errors[0].status, "unknown");
    assert.equal(errors[0].source_path_relative, "wiki/work-records/WK-1442.json");
    assert.equal(errors[0].error_kind, "parse_error");
    assert.match(errors[0].reason, /failed to parse canonical work-record JSON/);
  });
});
