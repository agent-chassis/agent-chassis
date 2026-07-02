import { createHmac, timingSafeEqual } from "node:crypto";
import {
  fail,
  isPlainObject,
  assertPlainObject,
  assertString,
  rejectUnknownKeys
} from "./role-guard-path-policy.mjs";
import { ROLE_GUARD_LAUNCHER_AUTHORITY } from "./role-guard-provenance.mjs";

export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeLauncherContext(context) {
  const clone = structuredClone(context);
  delete clone.integrity;
  return canonicalizeJson(clone);
}

export function signLauncherContext(context, secret) {
  assertString(secret, "launcher context secret");
  const mac = createHmac("sha256", secret).update(canonicalizeLauncherContext(context)).digest("base64url");
  return `hmac-sha256:${mac}`;
}

function safeIntegrityEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function verifyLauncherContext({
  context,
  secret,
  expectedReviewedMetadata,
  expectedActionBinding,
  nonceStore,
  now = new Date()
} = {}) {
  assertPlainObject(context, "launcher context");
  rejectUnknownKeys(
    context,
    new Set([
      "schema_version",
      "kind",
      "review_id",
      "run_id",
      "handoff_id",
      "mode",
      "repo_root",
      "input_manifest_hash",
      "registry_hash",
      "created_at",
      "expires_at",
      "nonce",
      "role_context",
      "action_binding",
      "integrity"
    ]),
    "launcher context"
  );
  if (context.schema_version !== 1 || context.kind !== "launcher_role_guard_context") {
    fail("launcher context kind or schema is invalid", "launcher_context_invalid");
  }
  assertPlainObject(expectedReviewedMetadata, "expected reviewed metadata");
  assertPlainObject(expectedActionBinding, "expected action binding");
  if (!context.integrity || !safeIntegrityEqual(context.integrity, signLauncherContext(context, secret))) {
    fail("launcher context integrity is invalid", "launcher_context_bad_integrity");
  }
  const expectedFields = [
    "review_id",
    "handoff_id",
    "mode",
    "repo_root",
    "input_manifest_hash",
    "registry_hash"
  ];
  for (const field of expectedFields) {
    assertString(expectedReviewedMetadata[field], `expected reviewed metadata ${field}`);
    if (String(context[field] ?? "") !== String(expectedReviewedMetadata[field])) {
      fail(`launcher context ${field} mismatch`, "launcher_context_metadata_mismatch");
    }
  }
  if (expectedReviewedMetadata.run_id !== undefined && expectedReviewedMetadata.run_id !== null) {
    if (String(context.run_id ?? "") !== String(expectedReviewedMetadata.run_id)) {
      fail("launcher context run_id mismatch", "launcher_context_metadata_mismatch");
    }
  } else if (context.run_id !== undefined && context.run_id !== null) {
    fail("launcher context run_id is not expected", "launcher_context_metadata_mismatch");
  }
  if (canonicalizeJson(context.role_context) !== canonicalizeJson(expectedReviewedMetadata.role_context)) {
    fail("launcher context role context mismatch", "launcher_context_metadata_mismatch");
  }
  if (context.action_binding === undefined) {
    fail("launcher context action binding is missing", "launcher_context_action_mismatch");
  }
  const createdAt = Date.parse(context.created_at);
  const expiresAt = Date.parse(context.expires_at);
  const nowMs = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > nowMs || expiresAt <= nowMs) {
    fail("launcher context is expired or not yet valid", "launcher_context_expired");
  }
  assertString(context.nonce, "launcher context nonce");
  if (!nonceStore || typeof nonceStore.checkAndMark !== "function") {
    fail("launcher context nonce store is unavailable", "launcher_context_nonce_store_unavailable");
  }
  const nonceAccepted = await nonceStore.checkAndMark(context.nonce, context.expires_at);
  if (!nonceAccepted) {
    fail("launcher context nonce was already used", "launcher_context_replay");
  }
  if (canonicalizeJson(context.action_binding) !== canonicalizeJson(expectedActionBinding)) {
    fail("launcher context action binding mismatch", "launcher_context_action_mismatch");
  }
  return {
    caller: "agent_launch",
    [ROLE_GUARD_LAUNCHER_AUTHORITY]: true,
    context
  };
}
