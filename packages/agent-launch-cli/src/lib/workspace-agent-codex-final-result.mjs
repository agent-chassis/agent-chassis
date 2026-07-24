

import { readFile } from "node:fs/promises";

import {
  BACKEND_MISSING_RESULT_CODES
} from "./workspace-agent-dispatch-backend.mjs";

import {
  DEFAULT_MAX_STDERR_DETAIL_BYTES,
  buildMissingResultPayload,
  detectNoFindingsLine
} from "./workspace-agent-launch-core.mjs";

import {
  buildFinalResultEnvelope,
  buildFindingsPayload,
  buildNoFindingsPayload
} from "./workspace-agent-family-adapter-core.mjs";
import {
  redactFamilyTransportSecrets
} from "./workspace-agent-family-launch-policy.mjs";

export const CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION = "codex-final-message.v1";

function buildCodexFindingsEnvelope({ text, finalPath, role, codexRole, subject }) {
  return buildFinalResultEnvelope({
    kind: "findings",
    payload: buildFindingsPayload({
      schemaVersion: CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
      format: "markdown",
      role,
      subject,
      source: { path: finalPath, bytes: text.length },
      compat: { codex_role: codexRole ?? null },
      text
    })
  });
}

function buildCodexNoFindingsEnvelope({ reasonLine, finalPath, text }) {
  return buildFinalResultEnvelope({
    kind: "no_findings",
    payload: buildNoFindingsPayload({
      reason: reasonLine,
      format: "markdown",
      source: { path: finalPath, bytes: text.length },
      text
    })
  });
}

export function codexTransportSecretEnvVars() {
  return [
  ];
}

export function redactCodexTransportSecrets(text, env = {}) {
  return redactFamilyTransportSecrets({
    text,
    env,
    secretEnvVars: codexTransportSecretEnvVars()
  });
}

function buildRedactedStderrDetail({ stderr, env, maxStderrDetailBytes = DEFAULT_MAX_STDERR_DETAIL_BYTES }) {
  const raw = typeof stderr === "string" ? stderr : "";
  if (raw.length === 0) return null;
  const redacted = redactCodexTransportSecrets(raw, env);
  const cap = typeof maxStderrDetailBytes === "number" && maxStderrDetailBytes > 0
    ? maxStderrDetailBytes
    : DEFAULT_MAX_STDERR_DETAIL_BYTES;
  const tail = redacted.length > cap ? redacted.slice(redacted.length - cap) : redacted;
  return { stderr_tail: tail };
}

export const CODEX_CLEAN_REVIEW_LINE_PATTERN =
  /^\s*no\s+blocking\s+or\s+medium\s+findings(?:\s+for\s+\S+)?[.!]?\s*$/i;

const CODEX_CLEAN_REVIEW_ROLES = new Set(["reviewer", "review", "redteam"]);

const CODEX_BLOCKING_OR_MEDIUM_FINDING_MARKER_PATTERN =
  /^(?:[\s>#*+\-]|\d+[.)]|\[)*\**\s*(?:(?:blocking|medium|high)\b\**\s*(?::|\]|\)|\b(?:findings?|issues?|severity)\b|$)|[bmh]\d+\b\**\s*(?::|\]|\)))/i;

function containsCodexBlockingOrMediumFindingMarker(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i += 1) {
    if (CODEX_BLOCKING_OR_MEDIUM_FINDING_MARKER_PATTERN.test(lines[i].trim())) {
      return true;
    }
  }
  return false;
}

export function detectCodexCleanReviewLine(text, role) {
  if (!CODEX_CLEAN_REVIEW_ROLES.has(role)) return null;
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  let firstNonEmptyIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length > 0) {
      firstNonEmptyIndex = i;
      break;
    }
  }
  if (firstNonEmptyIndex === -1) return null;
  const firstLine = lines[firstNonEmptyIndex].trim();

  if (!CODEX_CLEAN_REVIEW_LINE_PATTERN.test(firstLine)) return null;

  if (containsCodexBlockingOrMediumFindingMarker(lines, firstNonEmptyIndex + 1)) {
    return null;
  }
  return firstLine;
}

function reviewCleanPathOverriddenByLaterFindingMarker(text, role) {
  if (!CODEX_CLEAN_REVIEW_ROLES.has(role)) return false;
  if (typeof text !== "string") return false;
  const lines = text.split(/\r?\n/);
  let firstNonEmptyIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length > 0) {
      firstNonEmptyIndex = i;
      break;
    }
  }
  if (firstNonEmptyIndex === -1) return false;
  return containsCodexBlockingOrMediumFindingMarker(lines, firstNonEmptyIndex + 1);
}

export async function defaultCaptureCodexFinalResult({
  status,
  exit,
  finalPath,
  role,
  codexRole,
  subject,
  stderr,
  env,
  readFinalMessage = readFile
}) {
  const stderrDetail = buildRedactedStderrDetail({ stderr, env });
  if (typeof finalPath !== "string" || finalPath.length === 0) {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "final_message_path_unavailable",
      {
        status: status ?? null,
        exit_code: exit?.code ?? null,
        exit_signal: exit?.signal ?? null,
        ...(stderrDetail ?? {})
      }
    );
  }
  let text;
  try {
    text = await readFinalMessage(finalPath, "utf8");
  } catch (err) {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "final_message_file_unreadable",
      {
        path: finalPath,
        code: err?.code ?? null,
        message: err?.message ?? String(err),
        ...(stderrDetail ?? {})
      }
    );
  }
  if (typeof text !== "string") {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "final_message_not_text",
      { path: finalPath, received_type: typeof text, ...(stderrDetail ?? {}) }
    );
  }
  if (text.trim().length === 0) {
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "final_message_empty",
      { path: finalPath, bytes: text.length, ...(stderrDetail ?? {}) }
    );
  }
  const noFindingsLine = detectNoFindingsLine(text);

  if (noFindingsLine !== null && !reviewCleanPathOverriddenByLaterFindingMarker(text, role)) {
    return buildCodexNoFindingsEnvelope({
      reasonLine: noFindingsLine,
      finalPath,
      text
    });
  }

  const cleanReviewLine = detectCodexCleanReviewLine(text, role);
  if (cleanReviewLine !== null) {
    return buildCodexNoFindingsEnvelope({
      reasonLine: cleanReviewLine,
      finalPath,
      text
    });
  }
  return buildCodexFindingsEnvelope({ text, finalPath, role, codexRole, subject });
}
