import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { z } from "zod";

import { registerDispatchTools } from "../../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET_SUBJECT = "WK-0764#mcp-dispatch-app-required-final-redteam-test";

const EXPECTED_FAIL_CLOSED = Object.freeze({
  code: "worker_admission_carrier_invalid",
  reason: "canonical_carrier_revalidation_failed",
  issue: "admission_sidecar_integrity_failure"
});

function buildDispatchToolHarness({ dispatchBackend }) {
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
    dispatchBackend,
    dispatchSessionIdentity: "wk0764-missing-app-test-session"
  });

  return { handlers };
}

async function callDispatch(handlers, args) {
  const handler = handlers.get("workspace_agent_dispatch");
  assert.ok(handler, "workspace_agent_dispatch must be registered");
  const result = await handler(args);
  return result.structuredContent;
}

function createRecordingBackend(records) {
  return {
    async startLaunch(input) {
      records.startLaunch.push(input);
      return {
        accepted: true,
        app: input.app,
        role: input.role,
        subject: input.subject,
        status: "launching",
        terminal: false,
        run_id: "wkdb_test_run",
        monitor_handle: "wkmh_test_handle"
      };
    }
  };
}

async function assertFailsClosedRegardlessOfSelection(selectionArgs) {
  const records = { startLaunch: [] };
  const backend = createRecordingBackend(records);
  const { handlers } = buildDispatchToolHarness({ dispatchBackend: backend });

  const result = await callDispatch(handlers, {
    repo: "demo",
    role: "worker",
    subject: TARGET_SUBJECT,
    ...selectionArgs
  });

  assert.equal(
    result.accepted,
    false,
    "non-resolvable subject must fail closed at the admission-evidence gate"
  );
  assert.equal(
    records.startLaunch.length,
    0,
    "the launcher backend must never be reached when readiness fails closed"
  );
  assert.equal(result.blocker?.code, EXPECTED_FAIL_CLOSED.code);
  assert.equal(result.blocker?.reason, EXPECTED_FAIL_CLOSED.reason);
  assert.equal(result.blocker?.detail?.issue, EXPECTED_FAIL_CLOSED.issue);
}

test("WK-1381 workspace_agent_dispatch fails closed on omitted app/model without selecting a launch in MCP", async () => {
  await assertFailsClosedRegardlessOfSelection({});
});

test("WK-1381 workspace_agent_dispatch fails closed on a typed blank app without making MCP selection authority", async () => {
  await assertFailsClosedRegardlessOfSelection({ app: "   " });
});

test("WK-1381 workspace_agent_dispatch fails closed identically when only a model override is supplied", async () => {
  await assertFailsClosedRegardlessOfSelection({ model: "sonnet" });
});

test("WK-1381 workspace_agent_dispatch fails closed identically for an app-name model token", async () => {
  await assertFailsClosedRegardlessOfSelection({ model: "claude" });
});

test("WK-1248 workspace_agent_dispatch fails closed at readiness before any explicit app/model coherence check", async () => {
  await assertFailsClosedRegardlessOfSelection({ app: "codex", model: "gpt-5.5" });
});

test("WK-1381 workspace_agent_dispatch fails closed at readiness for an incoherent explicit app/model pair (no MCP coherence adjudication)", async () => {
  await assertFailsClosedRegardlessOfSelection({ app: "codex", model: "sonnet" });
});
