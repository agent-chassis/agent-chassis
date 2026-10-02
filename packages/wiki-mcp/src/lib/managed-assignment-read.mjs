

import {
  MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX,
  MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES,
  MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR,
  MANAGED_ASSIGNMENT_READ_ARTIFACT_SCHEMA_VERSION,
  MANAGED_ASSIGNMENT_READ_REFUSAL_CODES,
  MANAGED_WORKER_ASSIGNMENT_FIRST_READ,
  readPrivateImmutableArtifact
} from "../../../agent-launch-cli/src/lib/managed-assignment-read-artifact.mjs";
import { WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS } from
  "../../../wiki-core/src/lib/work-record-entry-schema.mjs";
import {
  buildSelectedRecordMemberCall,
  projectSelectedRecordMember,
  projectSelectedRecordMembers,
  selectedRecordMemberSelectorIssues,
  selectedRecordMembersSelectorIssues
} from "../../../wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import {
  isWorkRecordFreshness,
  projectWorkRecordFreshness,
  workRecordFreshnessMatches
} from "../../../wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  resolveLauncherAgentSessionContract
} from "./launcher-run-credential.mjs";
import { buildNextCall } from "./mcp-response.mjs";

export const MANAGED_ASSIGNMENT_READ_TOOL = "workspace_read_page";
export const MANAGED_ASSIGNMENT_READ_REFUSAL_SCHEMA_VERSION = "managed-assignment-read-refusal.v1";

const ASSIGNMENT_REQUEST_KEYS = Object.freeze(new Set(["assignment", "member", "members", "expected_source_digest"]));
const PRESENTATION_KEYS = Object.freeze(["guidance", "identity", "schema_version"]);
const IDENTITY_KEYS = Object.freeze(["assigned_unit", "canonical_source_digest", "role", "run_id"]);

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const REFUSALS = Object.freeze({
  [MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.SELECTOR_INVALID]: Object.freeze({
    stage: "selector",
    effects: "no source reader invoked; no writes",
    recovery_actor: "calling_agent",
    recovery_action: "A worker reads its assignment with {\"assignment\":true} (and only the member " +
      "selector for continuations); a reviewer or redteam uses the exact read named in its startup text."
  }),
  [MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.BINDING_MISMATCH]: Object.freeze({
    stage: "authentication",
    effects: "no assignment content returned; no canonical write",
    recovery_actor: "coordinator",
    recovery_action: "Report this code to the coordinator; the coordinator ends this attempt through the " +
      "existing route and dispatches an independently authenticated replacement after launcher binding repair."
  }),
  [MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.UNAVAILABLE]: Object.freeze({
    stage: "artifact",
    effects: "no content returned; no canonical write",
    recovery_actor: "coordinator_or_operator",
    recovery_action: "Report this blocker; the coordinator or operator repairs launcher artifact " +
      "publication and starts a fresh authorized attempt. Never retry against live canonical data."
  }),
  [MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.STALE_DIGEST]: Object.freeze({
    stage: "digest",
    effects: "no content returned; no writes",
    recovery_actor: "calling_agent",
    recovery_action: "Restart at {\"assignment\":true} in this session; a foreign continuation never " +
      "imports its source."
  })
});

export class ManagedAssignmentReadRefusal extends Error {
  constructor(code, message, {
    assignedUnit = null, detail = null, nextCalls = [], recoveryCode = code
  } = {}) {
    super(message);
    this.name = "ManagedAssignmentReadRefusal";
    this.code = code;
    const row = REFUSALS[recoveryCode];
    this.envelope = Object.freeze({
      schema_version: MANAGED_ASSIGNMENT_READ_REFUSAL_SCHEMA_VERSION,
      ok: false,
      status: "refused",
      code,
      severity: "blocking",
      authority_limb: "mechanical_failure",
      message,
      assigned_unit: assignedUnit,
      stage: row.stage,
      effects: row.effects,
      recovery: Object.freeze({ actor: row.recovery_actor, action: row.recovery_action }),
      ...(detail === null ? {} : { detail }),
      next_calls: nextCalls
    });
  }
}

function refuse(code, message, options) {
  throw new ManagedAssignmentReadRefusal(code, message, options);
}

function sessionRole(env) {
  return trimmed(env?.[WIKI_MCP_TOOL_PROFILE_ENV_VAR]);
}

function firstReadCall() {
  return buildNextCall({
    tool: MANAGED_ASSIGNMENT_READ_TOOL,
    arguments: { ...MANAGED_WORKER_ASSIGNMENT_FIRST_READ },
    recommended: true
  });
}

export function guardManagedAssignmentRead(args, { env = process.env } = {}) {
  const role = sessionRole(env);
  const selected = isPlainObject(args) && Object.hasOwn(args, "assignment");
  if (role !== "worker") {
    if (!selected) return Object.freeze({ route: "ordinary" });
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.SELECTOR_INVALID,
      "assignment reads are available only to a managed worker session", {
        assignedUnit: trimmed(env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR])
      });
  }
  const assignedUnit = trimmed(env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR]);
  const invalid = (message) => refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.SELECTOR_INVALID, message, {
    assignedUnit,
    nextCalls: [firstReadCall()]
  });
  if (!isPlainObject(args)) invalid("a worker read_page request must be an object");
  const extra = Object.keys(args).filter((key) => !ASSIGNMENT_REQUEST_KEYS.has(key));
  if (!selected || extra.length > 0) {
    invalid(`a worker session reads only its assignment; unsupported selectors: ${
      (selected ? extra : Object.keys(args)).join(", ") || "(none)"}`);
  }
  if (args.assignment !== true) invalid("assignment must be exactly true");
  if (Object.hasOwn(args, "member") && selectedRecordMemberSelectorIssues(args.member).length > 0) {
    invalid("member must use the existing path/offset/limit/length/expected_source_digest grammar");
  }
  if (Object.hasOwn(args, "member") && Object.hasOwn(args, "members")) {
    invalid("member and members are mutually exclusive");
  }
  if (Object.hasOwn(args, "members") && selectedRecordMembersSelectorIssues(args.members).length > 0) {
    invalid("members must be 1 to 16 path/offset/limit/length selections");
  }
  if (Object.hasOwn(args, "expected_source_digest") &&
      (!Object.hasOwn(args, "members") || !isWorkRecordFreshness(args.expected_source_digest))) {
    invalid("expected_source_digest pins a members batch with the 16-hex source_digest a read returned");
  }
  return Object.freeze({ route: "assignment" });
}

function loadBoundAssignment({ env, resolveSessionContract }) {
  let session;
  try {
    session = resolveSessionContract(env);
  } catch (error) {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.BINDING_MISMATCH,
      "the launcher session does not authenticate this assignment read", {
        detail: { session_refusal_code: error?.code ?? null }
      });
  }
  const assignedUnit = session?.assigned_unit?.address ?? null;
  if (session?.role !== "worker" || typeof assignedUnit !== "string") {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.BINDING_MISMATCH,
      "the authenticated launcher session is not a worker session with an assigned unit", {
        assignedUnit
      });
  }
  let artifact = null;
  try {
    artifact = readPrivateImmutableArtifact({
      artifactPath: trimmed(env?.[MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR]),
      prefix: MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX,
      maxBytes: MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES
    });
  } catch {
    artifact = null;
  }
  if (artifact === null) {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.UNAVAILABLE,
      "the launcher-published assignment is missing, unreadable or failed its identity checks", {
        assignedUnit
      });
  }
  let presentation = null;
  try {
    presentation = JSON.parse(artifact.bytes.toString("utf8"));
  } catch {
    presentation = null;
  }
  if (!isPlainObject(presentation) ||
      Object.keys(presentation).sort().join("\0") !== PRESENTATION_KEYS.join("\0") ||
      presentation.schema_version !== MANAGED_ASSIGNMENT_READ_ARTIFACT_SCHEMA_VERSION ||
      !isPlainObject(presentation.identity) ||
      Object.keys(presentation.identity).sort().join("\0") !== IDENTITY_KEYS.join("\0") ||
      typeof presentation.guidance !== "string" || presentation.guidance.length === 0) {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.UNAVAILABLE,
      "the launcher-published assignment is not a valid assignment presentation", { assignedUnit });
  }
  if (presentation.identity.assigned_unit !== assignedUnit ||
      presentation.identity.role !== "worker") {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.BINDING_MISMATCH,
      "the published assignment is bound to a different unit or role than this session", {
        assignedUnit
      });
  }
  return { assignedUnit, digest: artifact.digest, presentation };
}

export function readManagedAssignment(args, {
  env = process.env,
  resolveSessionContract = resolveLauncherAgentSessionContract
} = {}) {

  const { assignedUnit, digest: artifactDigest, presentation } = loadBoundAssignment({ env, resolveSessionContract });
  const digest = projectWorkRecordFreshness(artifactDigest);
  const requested = args.member ?? null;
  const pinned = Object.hasOwn(args, "members") ? args.expected_source_digest : requested?.expected_source_digest;
  if (pinned !== undefined && !workRecordFreshnessMatches(pinned, artifactDigest)) {
    refuse(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.STALE_DIGEST,
      "expected_source_digest is not this session's assignment digest", {
        assignedUnit,
        nextCalls: [firstReadCall()]
      });
  }
  const buildCall = (selection) => buildSelectedRecordMemberCall({
    tool: MANAGED_ASSIGNMENT_READ_TOOL,
    identity: { assignment: true },
    selection
  });
  const envelope = {
    ok: true,
    assignment: true,
    source_digest: digest,
    ...(requested === null && !Object.hasOwn(args, "members") ? { identity: presentation.identity } : {})
  };

  const member = requested ?? { path: ["guidance"], length: WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS };
  const projected = Object.hasOwn(args, "members")
    ? projectSelectedRecordMembers({ value: presentation, members: args.members, sourceDigest: digest,
      envelope, buildCall })
    : projectSelectedRecordMember({ value: presentation, member, sourceDigest: digest, envelope, buildCall });
  if (!projected.ok) {

    const diagnostic = projected.diagnostic ?? projected.diagnostics[0];
    throw new ManagedAssignmentReadRefusal(diagnostic.code, diagnostic.message, {
      assignedUnit,
      detail: { member_diagnostic: diagnostic },
      nextCalls: [firstReadCall()],
      recoveryCode: MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.SELECTOR_INVALID
    });
  }
  return projected.result;
}
