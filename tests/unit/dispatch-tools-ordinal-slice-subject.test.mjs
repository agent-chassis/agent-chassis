import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { z } from "zod";

import { registerDispatchTools } from "../../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function buildDispatchToolHarness() {
  const handlers = new Map();
  const registeredToolNames = new Set();
  const workspaceRepos = new Map([["demo", REPO_ROOT]]);

  registerDispatchTools({
    registerTool: (name, _definition, handler) => {
      registeredToolNames.add(name);
      handlers.set(name, handler);
    },
    registeredToolNames,
    workspaceRepos,
    z,
    jsonContent: (structuredContent) => ({ structuredContent }),
    errorContent: (error) => {
      throw error;
    },
    resolveWorkspaceRepo: (repos, repo) => {
      const resolvedRepo = repo ?? "demo";
      return {
        repo: resolvedRepo,
        dir: repos.get(resolvedRepo) ?? REPO_ROOT
      };
    },
    dispatchBackend: {
      async startLaunch() {
        throw new Error("startLaunch must not be reached in this subject-grammar test");
      }
    },
    dispatchSessionIdentity: "ordinal-slice-subject-test-session"
  });

  return { handlers };
}

async function callDispatch(handlers, args) {
  const handler = handlers.get("workspace_agent_dispatch");
  assert.ok(handler, "workspace_agent_dispatch must be registered");
  const result = await handler(args);
  return result.structuredContent;
}

test("workspace_agent_dispatch accepts canonical uppercase ordinal slice subjects past the subject-role matrix", async () => {
  const { handlers } = buildDispatchToolHarness();

  const result = await callDispatch(handlers, {
    repo: "demo",
    role: "worker",
    subject: "WK-0949#SLICE-001"
  });

  assert.equal(result.accepted, false);
  assert.notEqual(
    result.blocker?.reason,
    "subject_role_matrix_violation",
    "uppercase ordinal slice must clear the subject-role matrix"
  );
});

test("workspace_agent_dispatch still fail-closes malformed ordinal slice subjects", async () => {
  const { handlers } = buildDispatchToolHarness();

  const result = await callDispatch(handlers, {
    repo: "demo",
    role: "worker",
    subject: "WK-0949#SLICE-21"
  });

  assert.equal(result.accepted, false);
  assert.equal(result.blocker.code, "role_policy_violation");
  assert.equal(result.blocker.reason, "subject_role_matrix_violation");
  assert.equal(result.blocker.detail.subject_kind, null);
});
