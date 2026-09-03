import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentRunProvenanceEnvelope } from "../lib/agent-run-provenance-envelope.mjs";
import { observeReviewedLauncherProvenanceFacts } from "./launch.mjs";

const artifact = {
  path: "/run/response.md",
  exists: true,
  byte_count: 4,
  sha256: "digest",
  media_kind: "text/markdown",
  sensitivity_class: "routine"
};

test("reviewed launch facts construct the complete envelope without a partial fallback", () => {
  const result = buildAgentRunProvenanceEnvelope({
    runId: "RUN-1",
    reviewId: "review-1",
    handoffId: "handoff-1",
    selectedAgent: "codex",
    role: "worker",
    effectiveRole: "worker",
    subject: "repo:WK-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    terminalStatus: "completed",
    exitStatus: 0,
    signal: null,
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    argvRedacted: ["codex", "<prompt redacted>"],
    authority: { trusted_binding: { kind: "review", id: "review-1" } },
    artifacts: { response_md: artifact },
    sourceContext: {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.runtime.status, "completed");
  assert.deepEqual(result.envelope.artifacts.response_md, artifact);
});

test("reviewed launch malformed facts produce only the typed diagnostic", () => {
  const result = buildAgentRunProvenanceEnvelope({
    runId: "RUN-1",
    reviewId: "review-1",
    handoffId: "handoff-1",
    selectedAgent: "codex",
    role: "worker",
    effectiveRole: "worker",
    subject: "repo:WK-1",
    startedAt: "not-a-date",
    completedAt: "2026-08-24T00:00:01.000Z",
    terminalStatus: "completed",
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    argvRedacted: ["codex"],
    artifacts: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.envelope, undefined);
  assert.equal(result.diagnostic.type, "agent-run-provenance-construction-diagnostic.v1");
});

test("reviewed launch construction preserves supplied epochs and rejects malformed publication facts", () => {
  const complete = buildAgentRunProvenanceEnvelope({
    runId: "RUN-1",
    reviewId: "review-1",
    handoffId: "handoff-1",
    selectedAgent: "codex",
    role: "worker",
    effectiveRole: "worker",
    subject: "repo:WK-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    startedAtEpoch: Date.parse("2026-08-24T00:00:00.000Z"),
    completedAtEpoch: Date.parse("2026-08-24T00:00:01.000Z"),
    terminalStatus: "completed",
    exitStatus: 0,
    signal: null,
    childPid: 7,
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    argvRedacted: ["codex"],
    authority: { trusted_binding: { kind: "review", id: "review-1" } },
    artifacts: { response_md: artifact },
    sourceContext: { prompt_digest: "sha256:prompt", prompt_source: "cli_args" }
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.envelope.runtime.started_at_epoch, Date.parse("2026-08-24T00:00:00.000Z"));
  assert.equal(complete.envelope.runtime.completed_at_epoch, Date.parse("2026-08-24T00:00:01.000Z"));
  assert.equal(complete.envelope.runtime.child_pid, 7);

  const malformed = buildAgentRunProvenanceEnvelope({
    runId: "RUN-1",
    reviewId: "review-1",
    handoffId: "handoff-1",
    selectedAgent: "codex",
    role: "worker",
    effectiveRole: "worker",
    subject: "repo:WK-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    startedAtEpoch: 2,
    completedAtEpoch: 1,
    terminalStatus: "completed",
    exitStatus: 0,
    signal: null,
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    argvRedacted: ["codex"],
    authority: {},
    artifacts: {},
    sourceContext: {}
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.envelope, undefined);
  assert.equal(malformed.diagnostic.type, "agent-run-provenance-construction-diagnostic.v1");
});

test("reviewed observation publishes a complete envelope or one typed diagnostic", async () => {
  const facts = await observeReviewedLauncherProvenanceFacts({
    review: {
      handoff_id: "handoff-1",
      agent: "codex",
      repo_root: "/workspace",
      graph_impact_checkpoint: { state: "not_required" }
    },
    reviewId: "review-1",
    runId: "RUN-1",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    finalStatus: "completed",
    finalExitCode: 0,
    finalSignal: null,
    roleContext: { role: "worker", effective_role: "worker", child_pid: 7 },
    argv: ["codex", "/workspace"],
    placeholders: new Map([["/workspace", "<repo_root>"]]),
    reviewPath: "/run/review.json",
    manifestPath: "/run/input-manifest.json",
    launchPath: "/run/launch.json",
    statePath: "/run/state.json",
    metaPath: "/run/meta.json",
    responsePath: "/run/response.md",
    stdoutPath: "/run/stdout.log",
    stderrPath: "/run/stderr.log"
  });
  const complete = buildAgentRunProvenanceEnvelope(facts);
  assert.equal(complete.ok, true);
  assert.equal(complete.envelope.cleanup.run_dir, "/run/RUN-1");

  const diagnostic = buildAgentRunProvenanceEnvelope({
    ...facts,
    sourceContext: { graph_impact_checkpoint: { state: "not_required", unexpected: true } }
  });
  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.envelope, undefined);
  assert.equal(diagnostic.diagnostic.type, "agent-run-provenance-construction-diagnostic.v1");
});
