

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

import { statSync, realpathSync } from "node:fs";
import path from "node:path";

import { parseWorkRecordUnitAddress } from "@agent-chassis/agent-launch-core";

import { isWithinRepo } from "./launch-isolation.mjs";
import {
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE
} from "./workspace-agent-launch-adapter-contract.mjs";
import {
  ensureLauncherRuntimeStateDir,
  resolveWorkerFamilyLauncherRegistryPath
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  createWorkerFamilyTrustedLauncherContextNonceStore
} from "@agent-chassis/agent-launch-core/src/lib/launcher-context-mint.mjs";
import { loadRegistry } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";
import {
  computeWorkRecordSourceDigest,
  loadWorkRecordById,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import {
  AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES,
  AGENT_CHILD_TOOL_SURFACE_REFUSAL_SCHEMA_VERSION,
  LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
  assertLauncherOwnedSourceToolSurface,
  buildCodexChildRuntimeForLauncherOwnedSourceToolSurface,
  buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest,
  buildSourceToolSurfaceNotConfigured,
  isScopedChildToolSurfaceRefusal,
  isSourceToolSurfaceNotConfigured
} from "./agent-child-tool-surface.mjs";
import {
  AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION,
  TOOL_SURFACE_KEYS
} from "./agent-backend-constants.mjs";
import { isObject, isNonEmptyString } from "./agent-backend-primitives.mjs";
import { buildFilesystemMcpAgentBackendHandshakeRequestV1 } from "./agent-backend-handshake.mjs";
import { loadVerifierModule } from "./agent-backend-verifier-integration.mjs";
import {
  resolveFilesystemMcpBackendAuthority,
  buildRegistryBackedFilesystemMcpAgentBackendRequestV1,
  buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1
} from "./agent-backend-registry-authority.mjs";

function buildSourceToolSurfacePreparationRefusal(refusalCode, refusalMessage, detail = null) {
  return Object.freeze({
    schema_version: AGENT_CHILD_TOOL_SURFACE_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: refusalCode,
    refusal_message: refusalMessage,
    ...(detail ? { detail } : {})
  });
}

function uniqueSortedStringList(...lists) {
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (isNonEmptyString(entry)) {
        out.push(entry.trim());
      }
    }
  }
  return Array.from(new Set(out)).sort();
}

function selectWorkRecordUnitForSourceSurface(record, sliceId) {
  if (!sliceId || !Array.isArray(record?.slices)) {
    return null;
  }
  return record.slices.find((slice) => slice && slice.id === sliceId) ?? null;
}

function sourceScopeForWorkRecordUnit(record, selectedUnit) {
  const unit = selectedUnit ?? record;
  const writeScope = uniqueSortedStringList(unit?.write_scope);
  const readScope = uniqueSortedStringList(unit?.read_scope, unit?.repo_paths, writeScope);
  return { readScope, writeScope };
}

function validationPolicyForWorkRecordUnit(record, selectedUnit) {
  const validation = uniqueSortedStringList(
    record?.acceptance?.validation,
    selectedUnit?.acceptance?.validation
  );
  if (validation.length > 0) {
    return {
      commands: validation.map((profile) => ({ form: "named", profile }))
    };
  }
  return {
    commands: [{ form: "named", profile: "work_record_acceptance_validation" }]
  };
}

function buildSourceToolSurfaceBackendEvidence({ authority, backendProof, descriptor, challenge }) {
  if (!isObject(backendProof)) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend did not return a proof envelope"
    );
  }
  if (backendProof.schema_version !== AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      `source tool surface backend proof schema_version must be ${AGENT_BACKEND_HANDSHAKE_RESULT_SCHEMA_VERSION}`,
      { backend_schema_version: backendProof.schema_version ?? null }
    );
  }
  if (backendProof.backend_kind !== "filesystem_mcp") {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend proof must target filesystem_mcp",
      { backend_kind: backendProof.backend_kind ?? null }
    );
  }
  if (backendProof.backend_id !== authority.backend_id || backendProof.backend_version !== authority.backend_version) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend proof identity does not match registry authority",
      {
        expected_backend_id: authority.backend_id,
        actual_backend_id: backendProof.backend_id ?? null,
        expected_backend_version: authority.backend_version,
        actual_backend_version: backendProof.backend_version ?? null
      }
    );
  }
  if (backendProof.challenge_nonce !== challenge.challenge_nonce) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend proof does not bind the launcher challenge nonce"
    );
  }
  if (
    backendProof.status !== "available"
    || backendProof.mode !== "enforced"
    || backendProof.raw_exec_enabled !== false
    || backendProof.scope_binding !== true
    || backendProof.scope_digest !== descriptor.descriptor_digest
  ) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend did not prove an available enforced scoped surface",
      {
        status: backendProof.status ?? null,
        mode: backendProof.mode ?? null,
        raw_exec_enabled: backendProof.raw_exec_enabled ?? null,
        scope_binding: backendProof.scope_binding ?? null,
        scope_digest: backendProof.scope_digest ?? null,
        descriptor_digest: descriptor.descriptor_digest
      }
    );
  }
  const matched = matchBackendProofToolSurface(descriptor, backendProof.tool_surface);
  if (matched !== null) {
    return matched;
  }
  return {
    backend_kind: "filesystem_mcp",
    backend_id: authority.backend_id,
    backend_version: authority.backend_version,
    status: "available",
    raw_exec_enabled: false,
    tool_surface: backendProof.tool_surface,
    scope_binding: true,
    bound_scope_digest: backendProof.scope_digest
  };
}

function matchBackendProofToolSurface(descriptor, toolSurface) {
  if (!isObject(toolSurface)) {
    return buildSourceToolSurfacePreparationRefusal(
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
      "source tool surface backend proof must report the actual scoped tool surface"
    );
  }
  for (const key of TOOL_SURFACE_KEYS) {
    if (toolSurface[key] !== descriptor.tool_surface[key]) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        `source tool surface backend proof tool_surface.${key} does not match the requested descriptor`,
        {
          descriptor_tool_surface: descriptor.tool_surface,
          backend_tool_surface: toolSurface
        }
      );
    }
  }
  for (const key of Object.keys(toolSurface)) {
    if (!TOOL_SURFACE_KEYS.includes(key)) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        `source tool surface backend proof includes unsupported tool_surface field: ${key}`
      );
    }
  }
  return null;
}

function readChildOutput(stream, chunks) {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
}

function spawnBackendSurfaceEndpoint({ authority, challenge, env, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!isObject(authority?.endpoint) || authority.endpoint.kind !== "spawn") {
      resolve(buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        "source tool surface backend proof requires a registry-pinned spawn endpoint",
        { endpoint_kind: authority?.endpoint?.kind ?? null }
      ));
      return;
    }
    const argv = Array.isArray(authority.endpoint.argv) ? authority.endpoint.argv : [];
    const command = argv.find((entry) => isNonEmptyString(entry));
    if (!command) {
      resolve(buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        "source tool surface backend spawn endpoint argv is empty"
      ));
      return;
    }

    const childEnv = {
      PATH: isNonEmptyString(env?.PATH) ? env.PATH : "/usr/bin:/bin",
      LANG: "C"
    };
    const child = spawn(command, argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      shell: false
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    readChildOutput(child.stdout, stdoutChunks);
    readChildOutput(child.stderr, stderrChunks);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        "source tool surface backend proof endpoint timed out"
      ));
    }, timeoutMs);
    child.on("error", (error) => {
      finish(buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        "source tool surface backend proof endpoint could not be spawned",
        { message: error?.message ?? String(error) }
      ));
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        finish(buildSourceToolSurfacePreparationRefusal(
          AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
          "source tool surface backend proof endpoint exited nonzero",
          { code, signal, stderr: stderr.slice(0, 1000) }
        ));
        return;
      }
      if (!stdout || stdout.includes("\n")) {
        finish(buildSourceToolSurfacePreparationRefusal(
          AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
          "source tool surface backend proof endpoint must emit exactly one JSON object on stdout"
        ));
        return;
      }
      try {
        finish(JSON.parse(stdout));
      } catch (error) {
        finish(buildSourceToolSurfacePreparationRefusal(
          AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
          "source tool surface backend proof endpoint emitted invalid JSON",
          { message: error?.message ?? String(error) }
        ));
      }
    });
    child.stdin.end(JSON.stringify({
      ...challenge,
      handshake_transport_kind: authority.handshake_source.kind
    }));
  });
}

async function loadTrustedWorkerFamilyRegistry(workspaceDir) {
  const registryResolution = resolveWorkerFamilyLauncherRegistryPath(null, { workspaceDir });
  if (!registryResolution.ok) {
    throw new Error(registryResolution.reason);
  }
  return loadRegistry({ registryPath: registryResolution.path });
}

export function createLauncherOwnedSourceToolSurfacePreparer(options = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    registry = null,
    verifierCapability = null,
    verifierNonceStore = null,
    backendKey = null,
    backendProfile = "filesystem-mcp-default",
    loadRegistryForSourceSurface = loadTrustedWorkerFamilyRegistry,
    proveSourceToolSurfaceWithBackend = spawnBackendSurfaceEndpoint,
    loadWorkRecord = loadWorkRecordById,
    validateDispatch = validateWorkRecordDispatch
  } = options;

  return async function prepareLauncherOwnedSourceToolSurface(input = {}) {
    const subject = isNonEmptyString(input.subject) ? input.subject.trim() : null;
    const workspaceDir = isNonEmptyString(input.workspace_dir) ? input.workspace_dir.trim() : cwd;
    const workspaceAlias = isNonEmptyString(input.workspace_alias) ? input.workspace_alias.trim() : "agent-chassis";
    if (!subject) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
        "source tool surface preparation requires a WK subject"
      );
    }

    const unit = parseWorkRecordUnitAddress(subject);
    if (!unit.ok) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
        "source tool surface preparation requires a WK unit address",
        { subject }
      );
    }

    const resolvedRegistry = registry ?? await loadRegistryForSourceSurface(workspaceDir);
    const authorityResult = resolveFilesystemMcpBackendAuthority({
      registry: resolvedRegistry,
      agentFamily: "codex",
      agentProfile: backendProfile,
      agentRole: "worker",
      backendKey
    });
    if (!authorityResult.ok) {

      if (authorityResult.refusal.decision_code === "agent_backend.filesystem_mcp.unavailable.v1") {
        return buildSourceToolSurfaceNotConfigured({
          reason: authorityResult.refusal.reason,
          decision_code: authorityResult.refusal.decision_code
        });
      }
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        authorityResult.refusal.reason,
        { decision_code: authorityResult.refusal.decision_code }
      );
    }
    const authority = authorityResult.authority;

    if (authority.mode !== "enforced") {
      return buildSourceToolSurfaceNotConfigured({
        reason: `resolved filesystem_mcp backend ${authority.backend_key} is mode ${authority.mode}; no enforced filesystem-MCP source backend is configured`,
        decision_code: "agent_backend.filesystem_mcp.unavailable.v1",
        backend_key: authority.backend_key ?? null,
        mode: authority.mode ?? null
      });
    }

    const loaded = await loadWorkRecord({
      dir: workspaceDir,
      id: unit.value.record_id
    });
    if (!loaded.record || !loaded.valid) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
        "source tool surface preparation requires a valid canonical work record",
        {
          record_id: unit.value.record_id,
          diagnostics: Array.isArray(loaded.diagnostics) ? loaded.diagnostics : []
        }
      );
    }

    const selectedUnit = selectWorkRecordUnitForSourceSurface(loaded.record, unit.value.slice_id);
    if (unit.value.slice_id && !selectedUnit) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
        "source tool surface preparation could not find the selected WK slice",
        { unit_address: unit.value.address }
      );
    }

    const readiness = input.readiness && typeof input.readiness === "object"
      ? input.readiness
      : await validateDispatch({
          dir: workspaceDir,
          unitAddress: unit.value.address,
          now: env.AGENT_LAUNCH_TIMESTAMP || new Date().toISOString()
        });
    if (readiness?.dispatchable === false) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.INVALID_INPUT,
        "source tool surface preparation requires a dispatchable WK unit",
        {
          unit_address: unit.value.address,
          decision_code: readiness.decision_code ?? null
        }
      );
    }

    const { readScope, writeScope } = sourceScopeForWorkRecordUnit(loaded.record, selectedUnit);
    const request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, {
      subject: {
        kind: "work_unit",
        repo: workspaceAlias,
        unit: {
          record_id: unit.value.record_id,
          slice_id: unit.value.slice_id,
          address: unit.value.address
        }
      },
      agent: {
        family: "codex",
        role: "worker",
        profile: backendProfile,
        model: null
      },
      scope: {
        read_scope: readScope,
        write_scope: writeScope
      },
      validation: validationPolicyForWorkRecordUnit(loaded.record, selectedUnit),
      environment_policy: { mode: "closed", allowed_keys: [] },
      provenance_destination: {
        kind: "launcher_owned",
        run_id: isNonEmptyString(input.run_id) ? input.run_id : `source-${randomBytes(8).toString("hex")}`
      },
      tools: {
        raw_exec_enabled: false,
        filesystem_mcp: {
          read: true,
          write: true,
          structured_validation: true,
          final_report: true
        }
      },
      evidence: {
        work_record_digest: computeWorkRecordSourceDigest(loaded.record)
      }
    });
    const descriptor = buildScopedChildToolSurfaceDescriptorFromAgentBackendRequest(request);
    if (isScopedChildToolSurfaceRefusal(descriptor)) {
      return descriptor;
    }

    const runtimeStateEnsured = await ensureLauncherRuntimeStateDir({ workspaceDir, env });
    if (!runtimeStateEnsured.ok) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.LAUNCHER_RUNTIME_STATE_UNAVAILABLE,
        "launcher runtime state unavailable: nonce store directory is not writable",
        { code: runtimeStateEnsured.code, reason: runtimeStateEnsured.reason }
      );
    }
    const verifierModule = await loadVerifierModule();
    let capability;
    let nonceStore;
    try {
      capability = verifierCapability ?? await verifierModule.loadLauncherVerifierCapability({ trusted: true, workspaceDir, env });
      nonceStore = verifierNonceStore ?? await createWorkerFamilyTrustedLauncherContextNonceStore(workspaceDir, env);
    } catch (error) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.LAUNCHER_RUNTIME_STATE_UNAVAILABLE,
        "launcher runtime state unavailable: nonce store could not be created",
        { message: error?.message ?? String(error), errno_code: error?.code ?? null }
      );
    }
    const challenge = buildFilesystemMcpAgentBackendHandshakeRequestV1({
      request,
      challenge_nonce: randomBytes(16).toString("base64url"),
      normalized_scope_digest: descriptor.descriptor_digest
    });
    const backendProof = await proveSourceToolSurfaceWithBackend({
      authority,
      request,
      descriptor,
      challenge,
      env
    });
    if (isScopedChildToolSurfaceRefusal(backendProof)) {
      return backendProof;
    }
    const backendEvidence = buildSourceToolSurfaceBackendEvidence({
      authority,
      backendProof,
      descriptor,
      challenge
    });
    if (isScopedChildToolSurfaceRefusal(backendEvidence)) {
      return backendEvidence;
    }
    const handshake = await verifierModule.issueBackendHandshakeResult({
      capability,
      challenge,
      backendEvidence
    });
    if (isScopedChildToolSurfaceRefusal(handshake) || handshake.accepted !== true) {
      return buildSourceToolSurfacePreparationRefusal(
        AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
        handshake?.refusal_message ?? "source tool surface backend handshake could not be issued",
        { handshake_refusal: handshake ?? null }
      );
    }
    const decision = await buildRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
      {
        authority,
        handshake_transport_source: authority.handshake_source.kind,
        allowed: true,
        request,
        provenance: {
          scope_digest: descriptor.descriptor_digest,
          profile: request.agent.profile,
          model: null,
          raw_exec_enabled: false
        },
        handshake
      },
      {
        verifierCapability: capability,
        nonceStore
      }
    );
    const surface = {
      schema_version: LAUNCHER_OWNED_SOURCE_TOOL_SURFACE_SCHEMA_VERSION,
      backend_kind: "filesystem_mcp",
      authority: {
        backend_key: authority.backend_key,
        backend_id: authority.backend_id,
        backend_version: authority.backend_version,
        mode: authority.mode,
        handshake_source: authority.handshake_source
      },
      descriptor,
      backend_proof: backendProof,
      request,
      decision,
      handshake
    };
    const accepted = assertLauncherOwnedSourceToolSurface(surface);
    if (isScopedChildToolSurfaceRefusal(accepted)) {
      return accepted;
    }

    const callable = buildCodexChildRuntimeForLauncherOwnedSourceToolSurface(accepted, {
      childMount: authority.child_mount ?? null
    });
    return callable;
  };
}

function isGlobLikeSourceEntry(p) {
  return /[*?[\]{}]/.test(p);
}

function pathClassForAssignedEntry(p, writeSet, repoSet) {
  if (writeSet.has(p)) return "write_scope";
  if (repoSet.has(p)) return "repo_paths";
  return "read_scope";
}

export function classifyAssignedSourceSet({
  workspaceDir,
  readScope = [],
  repoPaths = [],
  writeScope = [],
  statFn = statSync,
  realpathFn = realpathSync
} = {}) {
  const writeSet = new Set(writeScope);
  const repoSet = new Set(repoPaths);
  const allPaths = uniqueSortedStringList(readScope, repoPaths, writeScope);

  let repoReal = workspaceDir;
  try {
    repoReal = realpathFn(workspaceDir);
  } catch {
    repoReal = workspaceDir;
  }

  const existingFiles = [];
  const createTargets = [];
  const namespaces = [];
  const refusals = [];

  for (const p of allPaths) {
    const path_class = pathClassForAssignedEntry(p, writeSet, repoSet);

    if (isGlobLikeSourceEntry(p) || p.endsWith("/")) {
      namespaces.push({ path: p, path_class });
      continue;
    }
    const abs = path.resolve(workspaceDir, p);
    const rel = path.relative(workspaceDir, abs);
    const lexicalEscape = rel === "" || rel.startsWith("..") || path.isAbsolute(rel);

    let st = null;
    try {
      st = statFn(abs);
    } catch {
      st = null;
    }
    if (st && typeof st.isDirectory === "function" && st.isDirectory()) {

      namespaces.push({ path: p, path_class });
      continue;
    }
    if (st && typeof st.isFile === "function" && st.isFile()) {
      if (lexicalEscape) {
        refusals.push({ path: p, path_class, cause: "assigned_source_outside_proven_scope" });
        continue;
      }
      let real = abs;
      try {
        real = realpathFn(abs);
      } catch {
        real = abs;
      }
      if (!isWithinRepo(real, repoReal)) {
        refusals.push({ path: p, path_class, cause: "assigned_source_outside_proven_scope" });
        continue;
      }
      existingFiles.push({ path: p, path_class });
      continue;
    }

    if (writeSet.has(p)) {
      createTargets.push({ path: p, path_class: "write_scope" });
      continue;
    }

    refusals.push({ path: p, path_class, cause: "assigned_source_absent" });
  }

  return { existingFiles, createTargets, namespaces, refusals };
}

export async function loadAssignedSourceListsForUnit({
  workspaceDir,
  subject,
  loadWorkRecord = null
} = {}) {
  if (!isNonEmptyString(workspaceDir) || !isNonEmptyString(subject)) {
    return { ok: false, reason: "assigned_source_unresolvable" };
  }
  const parsed = parseWorkRecordUnitAddress(subject);
  if (!parsed.ok) {
    return { ok: false, reason: "assigned_source_unit_unparseable" };
  }
  const recordId = parsed.value.record_id;
  const sliceId = parsed.value.slice_id;
  let loaded;
  try {
    loaded =
      typeof loadWorkRecord === "function"
        ? await loadWorkRecord({ dir: workspaceDir, id: recordId })
        : await loadWorkRecordById({ dir: workspaceDir, id: recordId });
  } catch {
    return { ok: false, reason: "assigned_source_record_unresolvable" };
  }
  const record = loaded?.record ?? null;
  if (!record) {
    return { ok: false, reason: "assigned_source_record_unresolvable" };
  }
  const selectedUnit = selectWorkRecordUnitForSourceSurface(record, sliceId);
  const unit = selectedUnit ?? record;
  return {
    ok: true,
    unitAddress: parsed.value.address,
    readScope: uniqueSortedStringList(unit?.read_scope),
    repoPaths: uniqueSortedStringList(unit?.repo_paths),
    writeScope: uniqueSortedStringList(unit?.write_scope)
  };
}

export async function proveAssignedSourceReadable({
  app = null,
  subject = null,
  workspace_dir = null,
  sourceReadMode = null,
  nativeReadCapability = null,
  sourceToolSurface = null,
  loadWorkRecord = null
} = {}) {
  const baseDetail = { app, subject, source_read_mode: sourceReadMode };

  if (sourceReadMode === LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE) {
    const isNotConfiguredMarker =
      sourceToolSurface != null && isSourceToolSurfaceNotConfigured(sourceToolSurface);
    const surfaceConfigured = sourceToolSurface != null && !isNotConfiguredMarker;
    if (!surfaceConfigured && !isNotConfiguredMarker) {
      return {
        ok: false,
        cause: "source_surface_unconfigured_for_tool_surface_reader",
        path_class: null,
        detail: { ...baseDetail }
      };
    }
  } else if (sourceReadMode === LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM) {
    if (nativeReadCapability == null) {
      return {
        ok: false,
        cause: "undeclared_native_read_capability",
        path_class: null,
        detail: { ...baseDetail }
      };
    }
  } else {
    return {
      ok: false,
      cause: "undeclared_source_read_mode",
      path_class: null,
      detail: { ...baseDetail }
    };
  }

  const lists = await loadAssignedSourceListsForUnit({
    workspaceDir: workspace_dir,
    subject,
    loadWorkRecord
  });
  if (!lists.ok) {
    return { ok: false, cause: lists.reason, path_class: null, detail: { ...baseDetail } };
  }

  const classification = classifyAssignedSourceSet({
    workspaceDir: workspace_dir,
    readScope: lists.readScope,
    repoPaths: lists.repoPaths,
    writeScope: lists.writeScope
  });
  if (classification.refusals.length > 0) {
    const first = classification.refusals[0];
    return {
      ok: false,
      cause: first.cause,
      path_class: first.path_class,
      detail: {
        ...baseDetail,
        path: first.path,
        refusals: classification.refusals,
        proven_existing_source_count: classification.existingFiles.length
      }
    };
  }

  return {
    ok: true,
    detail: {
      ...baseDetail,
      proven_existing_source_count: classification.existingFiles.length,
      create_target_count: classification.createTargets.length,
      namespace_count: classification.namespaces.length
    }
  };
}
