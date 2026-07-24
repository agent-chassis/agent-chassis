

import assert from "node:assert/strict";
import test from "node:test";

import { BACKEND_MISSING_RESULT_CODES } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  CODEX_CLEAN_REVIEW_LINE_PATTERN,
  CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  defaultCaptureCodexFinalResult,
  detectCodexCleanReviewLine
} from "../packages/agent-launch-cli/src/lib/workspace-agent-codex-final-result.mjs";

const FINAL_PATH = "/tmp/fake-repo/final.md";

test("findings schema version constant is the stable codex-final-message.v1 string", () => {
  assert.equal(CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION, "codex-final-message.v1");
});

test("defaultCaptureCodexFinalResult: missing finalPath returns missing_result", async () => {
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: null,
    role: "worker",
    codexRole: "worker"
  });
  assert.equal(envelope.kind, "missing_result");
  assert.equal(envelope.missing_result.code, BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED);
  assert.equal(envelope.missing_result.reason, "final_message_path_unavailable");
});

test("defaultCaptureCodexFinalResult: unreadable finalPath returns missing_result with error detail", async () => {
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "worker",
    codexRole: "worker",
    readFinalMessage: async () => {
      const err = new Error("nope");
      err.code = "ENOENT";
      throw err;
    }
  });
  assert.equal(envelope.kind, "missing_result");
  assert.equal(envelope.missing_result.reason, "final_message_file_unreadable");
  assert.equal(envelope.missing_result.detail.path, FINAL_PATH);
  assert.equal(envelope.missing_result.detail.code, "ENOENT");
});

test("defaultCaptureCodexFinalResult: non-string finalPath content returns missing_result", async () => {
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "worker",
    codexRole: "worker",
    readFinalMessage: async () => 42
  });
  assert.equal(envelope.kind, "missing_result");
  assert.equal(envelope.missing_result.reason, "final_message_not_text");
  assert.equal(envelope.missing_result.detail.received_type, "number");
});

test("defaultCaptureCodexFinalResult: empty finalPath content returns missing_result", async () => {
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "worker",
    codexRole: "worker",
    readFinalMessage: async () => "   \n\n"
  });
  assert.equal(envelope.kind, "missing_result");
  assert.equal(envelope.missing_result.reason, "final_message_empty");
});

test("defaultCaptureCodexFinalResult: populated finalPath becomes a findings envelope carrying the text", async () => {
  const finalText = "## Findings\n\n- thing one\n- thing two\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "reviewer",
    codexRole: "review",
    subject: "WK-0556",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "findings");
  assert.equal(envelope.findings.schema_version, CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION);
  assert.equal(envelope.findings.format, "markdown");
  assert.equal(envelope.findings.text, finalText);
  assert.equal(envelope.findings.source.path, FINAL_PATH);
  assert.equal(envelope.findings.source.bytes, finalText.length);
  assert.equal(envelope.findings.role, "reviewer");
  assert.equal(envelope.findings.codex_role, "review");
  assert.equal(envelope.findings.subject, "WK-0556");
});

test("defaultCaptureCodexFinalResult: explicit 'No findings.' first line maps to no_findings with full text preserved", async () => {
  const finalText = "No findings.\n\nReviewed the diff end-to-end.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "redteam",
    codexRole: "redteam",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "no_findings");
  assert.equal(envelope.no_findings.reason, "No findings.");
  assert.equal(envelope.no_findings.source.path, FINAL_PATH);

  assert.equal(envelope.no_findings.text, finalText);
});

test("defaultCaptureCodexFinalResult: 'no findings' buried mid-document still surfaces as findings", async () => {
  const finalText = "## Findings\n\n- Bug A\n- Bug B\n\nNo issues in the lint output.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "reviewer",
    codexRole: "review",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "findings");
  assert.equal(envelope.findings.text, finalText);
});

test("defaultCaptureCodexFinalResult: standardized clean-review declaration maps to no_findings for a reviewer", async () => {
  const finalText = "No blocking or medium findings for WK-0975.\n\nChecked the diff.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "reviewer",
    codexRole: "review",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "no_findings");
  assert.equal(envelope.no_findings.reason, "No blocking or medium findings for WK-0975.");
});

test("defaultCaptureCodexFinalResult: clean-review declaration followed by a Medium finding fails closed to findings", async () => {
  const finalText =
    "No blocking or medium findings.\n\nMedium: actually there is a problem here.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "reviewer",
    codexRole: "review",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "findings");
});

test("defaultCaptureCodexFinalResult: a worker's standardized clean-review line is NOT treated as clean", async () => {

  const finalText = "No blocking or medium findings.\n\nDid the work.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "worker",
    codexRole: "worker",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "findings");
});

test("defaultCaptureCodexFinalResult: review 'No findings.' followed by a B1 finding marker fails closed to findings", async () => {
  const finalText = "No findings.\n\nB1: a real blocking issue after all.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: FINAL_PATH,
    role: "reviewer",
    codexRole: "review",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "findings");
});

test("defaultCaptureCodexFinalResult: '## No issues' heading maps to no_findings", async () => {
  const finalText = "## No issues\n\nNothing to report.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: "/tmp/fake-repo/final.md",
    role: "reviewer",
    codexRole: "review",
    readFinalMessage: async () => finalText
  });
  assert.equal(envelope.kind, "no_findings");
  assert.equal(envelope.no_findings.reason, "## No issues");
});

test("WK-0566 Codex final_result preserves full no_findings final response", async () => {
  const finalText =
    "No findings.\n" +
    "\n" +
    "Residual risk: I did not independently rerun the live WK-0605 " +
    "structured-dispatch smoke from a controlled orchestrator session, " +
    "so the recorded end-to-end transcript in WK-0566 remains accepted " +
    "as implementation evidence rather than reverified in this review.\n" +
    "\n" +
    "Residual tooling risk: structured wiki MCP lookup for WK-0566 " +
    "resolved to a different configured workspace in this session, and " +
    "the repo code index was missing/stale.\n";
  const envelope = await defaultCaptureCodexFinalResult({
    status: "succeeded",
    exit: { code: 0, signal: null, error: null },
    finalPath: "/tmp/fake-repo/runDir/final.md",
    role: "reviewer",
    codexRole: "review",
    subject: "WK-0566",
    readFinalMessage: async () => finalText
  });

  assert.equal(envelope.kind, "no_findings");
  assert.equal(envelope.no_findings.reason, "No findings.");

  assert.equal(envelope.no_findings.source.path, "/tmp/fake-repo/runDir/final.md");
  assert.equal(envelope.no_findings.source.bytes, finalText.length);

  assert.equal(envelope.no_findings.format, "markdown");
  assert.equal(envelope.no_findings.text, finalText);
  assert.ok(
    envelope.no_findings.text.includes("Residual risk"),
    "residual-risk paragraphs after the heuristic line must be preserved"
  );
  assert.ok(
    envelope.no_findings.text.includes("Residual tooling risk"),
    "second residual paragraph must be preserved as well"
  );
});

test("detectCodexCleanReviewLine: returns the clean line for review-class roles", () => {
  const text = "No blocking or medium findings for WK-1.\n";
  assert.equal(detectCodexCleanReviewLine(text, "reviewer"), "No blocking or medium findings for WK-1.");
  assert.equal(detectCodexCleanReviewLine(text, "review"), "No blocking or medium findings for WK-1.");
  assert.equal(detectCodexCleanReviewLine(text, "redteam"), "No blocking or medium findings for WK-1.");
});

test("detectCodexCleanReviewLine: returns null for a worker role and for non-string text", () => {
  assert.equal(detectCodexCleanReviewLine("No blocking or medium findings.\n", "worker"), null);
  assert.equal(detectCodexCleanReviewLine(undefined, "reviewer"), null);
});

test("detectCodexCleanReviewLine: a non-clean first line is null even if a clean line appears later", () => {
  const text = "## Findings\n\nNo blocking or medium findings.\n";
  assert.equal(detectCodexCleanReviewLine(text, "reviewer"), null);
});

test("CODEX_CLEAN_REVIEW_LINE_PATTERN: matches the standardized declaration but not prose", () => {
  assert.ok(CODEX_CLEAN_REVIEW_LINE_PATTERN.test("No blocking or medium findings."));
  assert.ok(CODEX_CLEAN_REVIEW_LINE_PATTERN.test("no blocking or medium findings for WK-9"));
  assert.equal(CODEX_CLEAN_REVIEW_LINE_PATTERN.test("There are no blocking or medium findings, mostly."), false);
});

test("defaultCaptureCodexFinalResult: absent stderr leaves no stderr_tail in the missing_result detail", async () => {
  const envelope = await defaultCaptureCodexFinalResult({
    status: "failed",
    exit: { code: 1, signal: null, error: null },
    finalPath: null,
    role: "worker",
    codexRole: "worker"
  });
  assert.equal(envelope.kind, "missing_result");
  assert.equal(Object.prototype.hasOwnProperty.call(envelope.missing_result.detail, "stderr_tail"), false);
});
