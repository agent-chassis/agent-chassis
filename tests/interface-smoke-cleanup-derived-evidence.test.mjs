

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  bootstrapRepo,
  compareSidecarCliMcpParity,
  createWikiRecord,
  createSidecarStatusArtifact,
  digestWorkRecord,
  refreshWorkRecordAdmissionDerivedEvidenceById
} from "../packages/wiki-core/src/index.mjs";
import {
  createWorkRecordGraphImpactSummary
} from "../packages/wiki-core/src/lib/work-record-graph-impact-summary.mjs";
import {
  IDENTITY_REFUSAL_CODES
} from "../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_CODE_VALUES
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-interface-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function cleanupInterfaceSmokeArtifacts() {
  const testsDir = path.join(REPO_ROOT, "tests");
  const entries = await readdir(testsDir, { withFileTypes: true });
  const targets = entries
    .filter(
      (entry) =>
        entry.name === ".probe-interface-smoke.json" ||
        entry.name.startsWith("tmp-interface-smoke-")
    )
    .map((entry) => path.join(testsDir, entry.name));

  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
}

function createMcpSession({ env = {}, prelude = "" } = {}) {
  const sessionEnv = { ...process.env, ...env };
  if (
    typeof sessionEnv.WIKI_MCP_DEFAULT_REPO === "string" &&
    sessionEnv.WIKI_MCP_DEFAULT_REPO.length > 0 &&
    !Object.prototype.hasOwnProperty.call(sessionEnv, "WIKI_MCP_WORKSPACE_ALIAS")
  ) {
    sessionEnv.WIKI_MCP_WORKSPACE_ALIAS = sessionEnv.WIKI_MCP_DEFAULT_REPO;
  }
  const child = spawn("node", ["packages/wiki-mcp/src/server.mjs"], {
    cwd: REPO_ROOT,
    env: sessionEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  let errorBuffer = "";
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drainBuffer();
  });

  child.stderr.on("data", (chunk) => {
    errorBuffer += chunk.toString("utf8");
  });

  child.on("exit", () => {
    for (const { reject } of pending.values()) {
      reject(new Error(`MCP server exited unexpectedly: ${errorBuffer || "no stderr"}`));
    }
    pending.clear();
  });

  function drainBuffer() {
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }

      const body = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!body) {
        continue;
      }

      const message = JSON.parse(body);
      if (!("id" in message)) {
        continue;
      }

      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) {
        continue;
      }
      pending.delete(message.id);

      if (message.error) {
        pendingRequest.reject(new Error(message.error.message));
        continue;
      }

      pendingRequest.resolve(message.result);
    }
  }

  function request(id, method, params = {}) {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${payload}\n`);
    });
  }

  if (prelude) {
    child.stdin.write(prelude);
  }

  async function close() {
    child.stdin.end();
    await once(child, "exit");
  }

  function kill(signal = "SIGKILL") {
    child.kill(signal);
  }

  return { request, close, kill };
}

async function installCleanupDerivedEvidenceFixture(tempDir) {
  const issue = await createWikiRecord({ dir: tempDir, type: "issue", title: "Cleanup derived-evidence fixture" });
  const recordPath = path.join(tempDir, "wiki", "work-records", `${issue.id}.json`);

  await refreshWorkRecordAdmissionDerivedEvidenceById({ dir: tempDir, id: issue.id });

  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const admissionEntry = Array.isArray(record.derived_evidence)
    ? record.derived_evidence.find((e) => e && e.schema_version === "worker-admission-derived-evidence.v1")
    : null;
  if (!admissionEntry) {
    throw new Error("installCleanupDerivedEvidenceFixture: no admission entry found after refresh");
  }
  const olderEntry = { ...admissionEntry, generated_at: "2026-01-01T00:00:00.000Z" };
  record.derived_evidence = [olderEntry, admissionEntry];
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { fixture: record, recordPath, id: issue.id };
}

afterEach(cleanupInterfaceSmokeArtifacts);

test("MCP workspace_work_record_cleanup_derived_evidence covers strict schema refusal, compact default, verbose, stale digest refusal, and no-op (WK-0728)", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/cleanup-derived-evidence-demo" });
    const { id: fixtureId } = await installCleanupDerivedEvidenceFixture(tempDir);

    const session = createMcpSession({
      env: {
        WIKI_MCP_TOOL_PROFILE: "agent-safe",
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = await session.request(2, "tools/list");
      const cleanupTool = tools.tools.find(
        (entry) => entry.name === "workspace_work_record_cleanup_derived_evidence"
      );
      assert.ok(cleanupTool, "workspace_work_record_cleanup_derived_evidence must be registered in agent-safe profile");
      assert.equal(
        JSON.stringify(cleanupTool.inputSchema).includes('"dir"'),
        false,
        "workspace_work_record_cleanup_derived_evidence must not expose a caller-supplied dir argument"
      );

      const dryRun = await session.request(3, "tools/call", {
        name: "workspace_work_record_cleanup_derived_evidence",
        arguments: { repo: "demo", id: fixtureId }
      });
      const dryRunPayload = dryRun.structuredContent;
      assert.equal(dryRunPayload.workspaceRepo, "demo");
      assert.equal(dryRunPayload.status, "planned");
      assert.equal(dryRunPayload.mode, "plan");
      assert.equal(dryRunPayload.verbose, false);
      assert.equal(dryRunPayload.changed, true);
      assert.equal(dryRunPayload.written, false);
      assert.equal(dryRunPayload.valid, true);
      assert.equal(dryRunPayload.no_op, false);
      assert.equal(dryRunPayload.refusal, null);
      assert.ok(dryRunPayload.report, "compact default must include the plan report");
      assert.equal(dryRunPayload.report.before.total, 2);
      assert.equal(dryRunPayload.report.after.total, 1);
      assert.equal(dryRunPayload.report.removed.count, 1);

      assert.equal(dryRunPayload.report.removed_entries, undefined, "compact default must omit removed_entries blobs");
      assert.equal(dryRunPayload.report.verbose, undefined, "compact default must omit verbose marker");

      assert.ok(
        typeof dryRunPayload.use_as_expected_source_digest === "string" && dryRunPayload.use_as_expected_source_digest.length > 0,
        "plan mode must expose use_as_expected_source_digest"
      );
      assert.equal(
        dryRunPayload.use_as_expected_source_digest,
        dryRunPayload.current_source_digest,
        "use_as_expected_source_digest must equal current_source_digest in plan mode"
      );

      assert.equal(typeof dryRunPayload.source_digest, "string", "source_digest must be a string in plan mode");

      const verboseResult = await session.request(4, "tools/call", {
        name: "workspace_work_record_cleanup_derived_evidence",
        arguments: { repo: "demo", id: fixtureId, verbose: true }
      });
      const verbosePayload = verboseResult.structuredContent;
      assert.equal(verbosePayload.status, "planned");
      assert.equal(verbosePayload.verbose, true);
      assert.ok(Array.isArray(verbosePayload.report?.removed_entries), "verbose must include removed_entries array");
      assert.equal(verbosePayload.report.removed_entries.length, 1);

      const malformedResult = await session.request(5, "tools/call", {
        name: "workspace_work_record_cleanup_derived_evidence",
        arguments: { repo: "demo", id: fixtureId, expected_source_digest: "not-a-sha256" }
      });
      const malformedPayload = malformedResult.structuredContent;
      assert.equal(malformedPayload.status, "refused");
      assert.equal(malformedPayload.written, false);
      assert.equal(malformedPayload.refusal.code, "invalid_expected_source_digest");

      const staleResult = await session.request(6, "tools/call", {
        name: "workspace_work_record_cleanup_derived_evidence",
        arguments: {
          repo: "demo",
          id: fixtureId,
          write: true,
          expected_source_digest: `sha256:${"a".repeat(64)}`
        }
      });
      const stalePayload = staleResult.structuredContent;
      assert.equal(stalePayload.status, "refused");
      assert.equal(stalePayload.written, false);
      assert.equal(stalePayload.refusal.code, "stale_source_digest");

      const noOpIssue = await createWikiRecord({ dir: tempDir, type: "issue", title: "No-op cleanup check" });
      await refreshWorkRecordAdmissionDerivedEvidenceById({ dir: tempDir, id: noOpIssue.id });
      const noOpResult = await session.request(7, "tools/call", {
        name: "workspace_work_record_cleanup_derived_evidence",
        arguments: { repo: "demo", id: noOpIssue.id }
      });
      const noOpPayload = noOpResult.structuredContent;
      assert.equal(noOpPayload.status, "no_op");
      assert.equal(noOpPayload.changed, false);
      assert.equal(noOpPayload.no_op, true);
      assert.equal(noOpPayload.written, false);
    } finally {
      await session.close();
    }
  });
});

