import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";

import {
  ensureLauncherConfigDir,
  getLauncherConfigDir,
  getLauncherRuntimeNonceDir,
  getWorkerFamilyTrustedLauncherConfigDir
} from "./config.mjs";
import {
  RoleGuardError,
  canonicalizeJson,
  signLauncherContext
} from "./role-guard.mjs";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_BASE64URL_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;
const WK_ID_PATTERN = /^WK-\d+$/;

const SLICE_ID_BODY = "(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)";
const SLICE_ID_PATTERN = new RegExp(`^${SLICE_ID_BODY}$`);
const UNIT_ADDRESS_PATTERN = new RegExp(`^WK-\\d{4}(#${SLICE_ID_BODY})?$`);
const AGENT_FAMILY_VALUES = new Set(["claude", "gemini"]);
const AGENT_ROLE_VALUES = new Set(["worker", "reviewer", "redteam"]);
const VALIDATION_TRANSPORT_VALUES = new Set(["argv", "named"]);
const BACKEND_KIND_VALUE = "filesystem_mcp";
const PROVENANCE_DESTINATION_KIND_VALUE = "launcher_owned";
const EMPTY_WRITE_SCOPE_DIGEST = computeActionPayloadHash([]);

export function getCanonicalEmptyScopeDigest() {
  return EMPTY_WRITE_SCOPE_DIGEST;
}

export function getLauncherRoleGuardSecretPath(workspaceDir) {
  return path.join(getLauncherConfigDir(workspaceDir), "role-guard-secret.key");
}

export function getLauncherContextNonceDir(workspaceDir, env = process.env) {
  return getLauncherRuntimeNonceDir({ workspaceDir, env });
}

export function getWorkerFamilyTrustedLauncherRoleGuardSecretPath(workspaceDir) {
  return path.join(getWorkerFamilyTrustedLauncherConfigDir(workspaceDir), "role-guard-secret.key");
}

export function getWorkerFamilyTrustedLauncherContextNonceDir(workspaceDir, env = process.env) {
  return getLauncherRuntimeNonceDir({ workspaceDir, env });
}

export async function ensureWorkerFamilyTrustedLauncherRoleGuardSecret(workspaceDir) {
  const dir = getWorkerFamilyTrustedLauncherConfigDir(workspaceDir);
  await mkdir(dir, { recursive: true });
  const keyPath = getWorkerFamilyTrustedLauncherRoleGuardSecretPath(workspaceDir);
  let handle = null;
  try {
    handle = await open(keyPath, "wx", 0o600);
    await handle.writeFile(randomBytes(32).toString("hex"));
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  } finally {
    if (handle) {
      await handle.close();
    }
  }
  await chmod(keyPath, 0o600);
  return readSecret(keyPath);
}

export async function loadWorkerFamilyTrustedLauncherRoleGuardSecret(workspaceDir) {
  const keyPath = getWorkerFamilyTrustedLauncherRoleGuardSecretPath(workspaceDir);
  try {
    return await readSecret(keyPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new RoleGuardError(
        `launcher role-guard secret missing at ${keyPath}; run agent-launch init-config`,
        "launcher_context_secret_missing"
      );
    }
    throw error;
  }
}

export async function createWorkerFamilyTrustedLauncherContextNonceStore(workspaceDir, env = process.env) {
  return createLauncherContextNonceStore({
    dir: getWorkerFamilyTrustedLauncherContextNonceDir(workspaceDir, env)
  });
}

export async function ensureLauncherRoleGuardSecret(workspaceDir) {
  await ensureLauncherConfigDir(workspaceDir);
  const keyPath = getLauncherRoleGuardSecretPath(workspaceDir);
  let handle = null;
  try {
    handle = await open(keyPath, "wx", 0o600);
    await handle.writeFile(randomBytes(32).toString("hex"));
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  } finally {
    if (handle) {
      await handle.close();
    }
  }
  await chmod(keyPath, 0o600);
  return readSecret(keyPath);
}

export async function loadLauncherRoleGuardSecret(workspaceDir) {
  const keyPath = getLauncherRoleGuardSecretPath(workspaceDir);
  try {
    return await readSecret(keyPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new RoleGuardError(
        `launcher role-guard secret missing at ${keyPath}; run agent-launch init-config`,
        "launcher_context_secret_missing"
      );
    }
    throw error;
  }
}

async function readSecret(keyPath) {
  const raw = await readFile(keyPath, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new RoleGuardError(
      `launcher role-guard secret at ${keyPath} is empty`,
      "launcher_context_secret_missing"
    );
  }
  return trimmed;
}

export async function createLauncherContextNonceStore({ dir = getLauncherContextNonceDir() } = {}) {
  await mkdir(dir, { recursive: true });
  await gcExpiredNonces(dir);
  return {
    async checkAndMark(nonce, expiresAt) {
      if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
        return false;
      }
      const nonceFile = path.join(dir, nonce);
      let handle;
      try {
        handle = await open(nonceFile, "wx", 0o600);
      } catch (error) {
        if (error?.code === "EEXIST") {
          return false;
        }
        throw error;
      }
      try {
        await handle.writeFile(JSON.stringify({ expires_at: expiresAt ?? null }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    }
  };
}

async function gcExpiredNonces(dir, now = new Date()) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const nowMs = now.getTime();
  await Promise.all(entries.map(async (entry) => {
    if (!NONCE_PATTERN.test(entry)) {
      return;
    }
    const nonceFile = path.join(dir, entry);
    try {
      const parsed = JSON.parse(await readFile(nonceFile, "utf8"));
      const expiresAt = Date.parse(parsed.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt > nowMs) {
        return;
      }
      await unlink(nonceFile);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }));
}

export function computeActionPayloadHash(payload) {
  const digest = createHash("sha256").update(canonicalizeJson(payload)).digest("base64url");
  return `sha256:${digest}`;
}

export function buildLauncherContextActionBinding({
  actionType,
  repoRoot,
  configPath,
  role,
  wk,
  rawArgv = null,
  targetSource = null,
  targetHash = null,
  acceptedHandshakeDigest = null,
  backendKind = null,
  agentFamily = null,
  agentProfile = null,
  agentRole = null,
  unitAddress = null,
  recordId = null,
  sliceId = null,
  runId = null,
  readScopeDigest = null,
  writeScopeDigest = null,
  validationTransport = null,
  provenanceDestinationKind = null,
  envPolicyDigest = null,
  agentBriefDigest = null
}) {
  if (typeof actionType !== "string" || actionType.length === 0) {
    throw new RoleGuardError("action binding requires actionType", "launcher_context_invalid");
  }
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new RoleGuardError("action binding requires repoRoot", "launcher_context_invalid");
  }
  if (typeof configPath !== "string" || configPath.length === 0) {
    throw new RoleGuardError("action binding requires configPath", "launcher_context_invalid");
  }
  if (typeof role !== "string" || role.length === 0) {
    throw new RoleGuardError("action binding requires role", "launcher_context_invalid");
  }
  const normalizedWk = wk ?? null;
  if (normalizedWk !== null && (typeof normalizedWk !== "string" || normalizedWk.length === 0)) {
    throw new RoleGuardError("action binding wk must be null or non-empty string", "launcher_context_invalid");
  }
  const binding = {
    action_type: actionType,
    config_path: configPath,
    repo_root: repoRoot,
    role,
    wk: normalizedWk
  };
  if (actionType === "check-command") {
    if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
      throw new RoleGuardError("check-command action binding requires raw_argv", "launcher_context_invalid");
    }
    binding.raw_argv = rawArgv;
  }
  if (actionType === "agent_role_launch") {
    if (targetSource !== null) {
      throw new RoleGuardError(
        "agent_role_launch action binding must not include target_source",
        "launcher_context_invalid"
      );
    }
    if (targetHash !== null) {
      throw new RoleGuardError(
        "agent_role_launch action binding must not include target_hash",
        "launcher_context_invalid"
      );
    }
    assertSha256Base64Url(acceptedHandshakeDigest, "accepted_handshake_digest");
    if (backendKind !== BACKEND_KIND_VALUE) {
      throw new RoleGuardError(
        `agent_role_launch action binding requires backend_kind="${BACKEND_KIND_VALUE}"`,
        "launcher_context_invalid"
      );
    }
    if (typeof agentFamily !== "string" || !AGENT_FAMILY_VALUES.has(agentFamily)) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires agent_family in {claude, gemini}",
        "launcher_context_invalid"
      );
    }
    if (typeof agentProfile !== "string" || agentProfile.length === 0) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires non-empty agent_profile",
        "launcher_context_invalid"
      );
    }
    if (typeof agentRole !== "string" || !AGENT_ROLE_VALUES.has(agentRole)) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires agent_role in {worker, reviewer, redteam}",
        "launcher_context_invalid"
      );
    }
    if (role !== agentRole) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires role === agent_role",
        "launcher_context_invalid"
      );
    }
    if (typeof unitAddress !== "string" || !UNIT_ADDRESS_PATTERN.test(unitAddress)) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires canonical unit_address",
        "launcher_context_invalid"
      );
    }
    if (typeof recordId !== "string" || !WK_ID_PATTERN.test(recordId)) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires canonical record_id",
        "launcher_context_invalid"
      );
    }
    if (normalizedWk !== recordId) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires wk === record_id",
        "launcher_context_invalid"
      );
    }
    const normalizedSliceId = sliceId ?? null;
    if (normalizedSliceId !== null && (typeof normalizedSliceId !== "string" || !SLICE_ID_PATTERN.test(normalizedSliceId))) {
      throw new RoleGuardError(
        "agent_role_launch slice_id must be null or match ^(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)$",
        "launcher_context_invalid"
      );
    }
    if (normalizedSliceId === null) {
      if (unitAddress !== recordId) {
        throw new RoleGuardError(
          "agent_role_launch unit_address must equal record_id when slice_id is null",
          "launcher_context_invalid"
        );
      }
    } else if (unitAddress !== `${recordId}#${normalizedSliceId}`) {
      throw new RoleGuardError(
        "agent_role_launch unit_address must equal <record_id>#<slice_id>",
        "launcher_context_invalid"
      );
    }
    if (typeof runId !== "string" || runId.length === 0) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires non-empty run_id",
        "launcher_context_invalid"
      );
    }
    assertSha256Base64Url(readScopeDigest, "read_scope_digest");
    assertSha256Base64Url(writeScopeDigest, "write_scope_digest");
    if (agentRole === "worker") {
      if (writeScopeDigest === EMPTY_WRITE_SCOPE_DIGEST) {
        throw new RoleGuardError(
          "agent_role_launch worker write_scope_digest must not equal the canonical empty-scope digest",
          "launcher_context_invalid"
        );
      }
    } else {
      if (writeScopeDigest !== EMPTY_WRITE_SCOPE_DIGEST) {
        throw new RoleGuardError(
          `agent_role_launch ${agentRole} write_scope_digest must equal the canonical empty-scope digest`,
          "launcher_context_invalid"
        );
      }
    }
    if (typeof validationTransport !== "string" || !VALIDATION_TRANSPORT_VALUES.has(validationTransport)) {
      throw new RoleGuardError(
        "agent_role_launch action binding requires validation_transport in {argv, named}",
        "launcher_context_invalid"
      );
    }
    if (provenanceDestinationKind !== PROVENANCE_DESTINATION_KIND_VALUE) {
      throw new RoleGuardError(
        `agent_role_launch action binding requires provenance_destination_kind="${PROVENANCE_DESTINATION_KIND_VALUE}"`,
        "launcher_context_invalid"
      );
    }
    assertSha256Base64Url(envPolicyDigest, "env_policy_digest");
    assertSha256Base64Url(agentBriefDigest, "agent_brief_digest");
    binding.accepted_handshake_digest = acceptedHandshakeDigest;
    binding.backend_kind = backendKind;
    binding.agent_family = agentFamily;
    binding.agent_profile = agentProfile;
    binding.agent_role = agentRole;
    binding.unit_address = unitAddress;
    binding.record_id = recordId;
    binding.slice_id = normalizedSliceId;
    binding.run_id = runId;
    binding.read_scope_digest = readScopeDigest;
    binding.write_scope_digest = writeScopeDigest;
    binding.validation_transport = validationTransport;
    binding.provenance_destination_kind = provenanceDestinationKind;
    binding.env_policy_digest = envPolicyDigest;
    binding.agent_brief_digest = agentBriefDigest;
  }
  if (targetSource !== null) {
    binding.target_source = targetSource;
  }
  if (targetHash !== null) {
    binding.target_hash = targetHash;
  }
  return binding;
}

function assertSha256Base64Url(value, fieldName) {
  if (typeof value !== "string" || !SHA256_BASE64URL_PATTERN.test(value)) {
    throw new RoleGuardError(
      `agent_role_launch action binding requires ${fieldName} as sha256:<base64url>`,
      "launcher_context_invalid"
    );
  }
}

export async function mintLauncherContext({
  secret,
  reviewedMetadata,
  actionBinding,
  ttlSeconds = 60,
  now = new Date(),
  nonce
}) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new RoleGuardError("mintLauncherContext requires secret", "launcher_context_invalid");
  }
  if (!reviewedMetadata || typeof reviewedMetadata !== "object") {
    throw new RoleGuardError("mintLauncherContext requires reviewedMetadata", "launcher_context_invalid");
  }
  if (!actionBinding || typeof actionBinding !== "object") {
    throw new RoleGuardError("mintLauncherContext requires actionBinding", "launcher_context_invalid");
  }
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const context = {
    schema_version: 1,
    kind: "launcher_role_guard_context",
    review_id: reviewedMetadata.review_id,
    handoff_id: reviewedMetadata.handoff_id,
    mode: reviewedMetadata.mode,
    repo_root: reviewedMetadata.repo_root,
    input_manifest_hash: reviewedMetadata.input_manifest_hash,
    registry_hash: reviewedMetadata.registry_hash,
    role_context: reviewedMetadata.role_context,
    created_at: createdAt,
    expires_at: expiresAt,
    nonce: nonce ?? randomBytes(16).toString("base64url"),
    action_binding: actionBinding
  };
  if (reviewedMetadata.run_id !== undefined && reviewedMetadata.run_id !== null) {
    context.run_id = reviewedMetadata.run_id;
  }
  context.integrity = signLauncherContext(context, secret);
  return context;
}

export function deriveExpectedReviewedMetadataFromContext(context) {
  const expected = {
    review_id: context.review_id,
    handoff_id: context.handoff_id,
    mode: context.mode,
    repo_root: context.repo_root,
    input_manifest_hash: context.input_manifest_hash,
    registry_hash: context.registry_hash,
    role_context: context.role_context
  };
  if (context.run_id !== undefined && context.run_id !== null) {
    expected.run_id = context.run_id;
  }
  return expected;
}
