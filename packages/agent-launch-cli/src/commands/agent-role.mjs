import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import {
  AGENT_BACKEND_AGENT_FAMILIES,
  AGENT_BACKEND_AGENT_ROLES,
  AGENT_BACKEND_FILESYSTEM_MCP_HANDSHAKE_TRANSPORT_KINDS,
  buildFilesystemMcpAuthorityRefusalDecisionV1,
  buildRegistryBackedFilesystemMcpAgentBackendRequestV1,
  normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1,
  resolveFilesystemMcpBackendAuthority
} from "../lib/agent-backend.mjs";
import { hasLauncherVerifierCapability } from "../lib/agent-backend-verifier.mjs";

import { gateRoleWriteScope } from "../lib/workspace-agent-launch-adapter-contract.mjs";
import {
  parseWorkRecordUnitAddress
} from "@agent-chassis/agent-launch-core";
import {
  summarizeDispatchReadinessDependencies
} from "@agent-chassis/agent-launch-core/src/lib/work-record-gate.mjs";
import {
  WORKER_FAMILY_OPERATOR_CONFIG_REFUSAL_REASON,
  WORKER_FAMILY_OPERATOR_CONFIG_RELATIVE_REFUSAL_REASON,
  ensureLauncherRuntimeStateDir,
  resolveWorkerFamilyLauncherRegistryPath
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  buildLauncherContextActionBinding,
  computeActionPayloadHash,
  createLauncherContextNonceStore,
  getLauncherContextNonceDir,
  loadLauncherRoleGuardSecret,
  mintLauncherContext
} from "@agent-chassis/agent-launch-core/src/lib/launcher-context-mint.mjs";
import { loadRegistry } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";
import { canonicalizeJson, RoleGuardError } from "@agent-chassis/agent-launch-core/src/lib/role-guard.mjs";
import {
  computeWorkRecordSourceDigest,
  loadWorkRecordById,
  renderWorkRecordAgentBrief,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import {
  IDENTITY_REFUSAL_CODES,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import { parseArgs } from "../lib/cli.mjs";
import {
  AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
  appendGraphImpactBridgeDiagnostic,
  applyGraphImpactBridge
} from "../lib/graph-impact-bridge.mjs";

const HELP_TEXT = `agent-launch agent-role <role> <family> <unit-address> [options]

Internal: this is the Claude/Agy filesystem-MCP agent-backend
implementation invoked by the canonical operator commands

  agent-launch worker  <unit-address> [--app claude|agy]
  agent-launch review  <unit-address> [--app claude|agy]
  agent-launch redteam <unit-address> [--app claude|agy]

The canonical operator surface uses
\`agent-launch <role> <unit> [--profile <profile>] [--app <app>] [--model <model>]\`.
Operators should invoke the canonical commands above; the canonical
\`--profile\` selects a launcher profile (worker, worker_spark, review, ...).

\`agent-role\` is not an alternative operator launcher. It is the backend
implementation. It remains a directly-callable subcommand for in-package
backward compatibility and for backend introspection via --dry-run-json.

The agent-role internal \`--profile\` option below is the registry-pinned
backend profile id (a different concept from canonical \`agent-launch
--profile\`). It must match an entry under
\`filesystem_mcp_backends.<backend>.supported_profiles\` in the launcher
registry; it does not select a canonical launcher profile.

Codex is implemented by codex-role and dispatched through the same canonical
operator commands with \`--app codex\`; agent-role is the claude/agy-only
backend builder.

Internal arguments:
  role           worker | reviewer | redteam
  family         claude | agy
  unit-address   WK-0001 or WK-0001#slice-id

Internal options:
  --profile <profile>            Registry-pinned backend profile id (NOT the
                                 canonical agent-launch profile)
  --model <model>                Optional model hint forwarded into the request
  --operator-config <path>       Launcher registry path override
  --backend-key <key>            Override registry filesystem_mcp_backend_default
  --dry-run-json                 Print the canonical request + decision JSON without spawning
`;

const SUPPORTED_FAMILIES = Object.freeze(new Set(["claude", "agy"]));
const SUPPORTED_ROLES = Object.freeze(new Set(["worker", "reviewer", "redteam"]));
const READ_ONLY_ROLES = Object.freeze(new Set(["reviewer", "redteam"]));

const MISCONFIGURED_CODE = "agent_backend.filesystem_mcp.misconfigured.v1";
const UNAVAILABLE_CODE = "agent_backend.filesystem_mcp.unavailable.v1";
const UNSUPPORTED_FAMILY_CODE = "agent_backend.profile.unsupported_agent_family.v1";
const UNSUPPORTED_PROFILE_CODE = "agent_backend.profile.unsupported_agent_profile.v1";

const ROLE_POLICY_VIOLATION_CODE = RUNTIME_BLOCKER_CODES.ROLE_POLICY_VIOLATION;
const CALLER_SUPPLIED_IDENTITY_CODE = RUNTIME_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY;
export const REVIEWER_WRITE_SCOPE_NONEMPTY_REASON = "reviewer_write_scope_nonempty";
export const REDTEAM_WRITE_SCOPE_NONEMPTY_REASON = "redteam_write_scope_nonempty";

const IDENTITY_CARRIER_ENV_KEYS = Object.freeze([
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE"
]);

const SEAM_WITH_OPERATOR_CONFIG_REFUSAL_REASON =
  "agent-role: launcher-owned authority context and operator-config override are mutually exclusive; the seam pins the launcher registry and any operator-config override must be omitted";

export async function runAgentRole(argv, io = {}) {
  const { positionals, options } = parseArgs(argv);
  if (positionals.length === 0 || positionals[0] === "help" || options.help || options.h) {
    writeLine(io.stdout, HELP_TEXT);
    return;
  }

  const plan = await buildAgentRolePlan({
    role: positionals[0],
    family: positionals[1],
    unitAddress: positionals[2],
    options,
    env: process.env,
    cwd: process.cwd()
  });

  writeLine(io.stdout, JSON.stringify(redactPlanForOutput(plan), null, 2));
  if (plan.mode === "refusal") {
    process.exitCode = 1;
    return;
  }

  if (Array.isArray(plan.blockers) && plan.blockers.length > 0) {
    process.exitCode = 1;
  }
}

function isLauncherOwnedAuthorityContext(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (!value.registry || typeof value.registry !== "object") {
    return false;
  }

  if (typeof value.registry.path !== "string" || value.registry.path.length === 0) {
    return false;
  }
  if (typeof value.registry.hash !== "string" || value.registry.hash.length === 0) {
    return false;
  }
  if (!hasLauncherVerifierCapability(value.verifierCapability)) {
    return false;
  }
  if (!value.resultNonceStore || typeof value.resultNonceStore.checkAndMark !== "function") {
    return false;
  }
  if (!value.handshakeResult || typeof value.handshakeResult !== "object") {
    return false;
  }
  if (typeof value.handshakeTransportSource !== "string" || value.handshakeTransportSource.length === 0) {
    return false;
  }
  return true;
}

export async function buildAgentRolePlan({
  role: rawRole,
  family: rawFamily,
  unitAddress: rawUnitAddress,
  options = {},
  env = process.env,
  cwd = process.cwd(),
  launcherOwnedAuthorityContext = null
} = {}) {

  const identityRefusal = refuseCallerSuppliedIdentityFields(
    snapshotCallerSuppliedIdentityProbe({ env, options })
  );
  if (identityRefusal) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: caller-supplied identity is not authority (${identityRefusal.detail?.carrier ?? IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE})`,
      role: rawRole ?? null,
      family: rawFamily ?? null,
      unitAddress: rawUnitAddress ?? null,
      runtimeBlockerCode: CALLER_SUPPLIED_IDENTITY_CODE,
      identityRefusal
    });
  }

  const inputRefusal = checkInputShape({ rawRole, rawFamily, rawUnitAddress });
  if (inputRefusal) {
    return inputRefusal;
  }
  const role = rawRole.trim();
  const family = rawFamily.trim();
  const unitParsed = parseWorkRecordUnitAddress(rawUnitAddress);
  if (!unitParsed.ok) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: invalid unit address ${rawUnitAddress}`,
      role,
      family,
      unitAddress: rawUnitAddress
    });
  }
  const unit = unitParsed.value;
  const recordId = unit.record_id;
  const sliceId = unit.slice_id ?? null;
  const unitAddress = unit.address;

  const repoRoot = await findRepoRoot(cwd);
  const seamUsable = isLauncherOwnedAuthorityContext(launcherOwnedAuthorityContext);
  const operatorConfigOverride = readStringOption(options, "operator-config");

  if (seamUsable && operatorConfigOverride !== null) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: SEAM_WITH_OPERATOR_CONFIG_REFUSAL_REASON,
      role,
      family,
      unitAddress
    });
  }

  let registry;
  if (seamUsable) {
    registry = launcherOwnedAuthorityContext.registry;
  } else {
    const registryPathOverride = operatorConfigOverride;
    const registryResolution = resolveWorkerFamilyLauncherRegistryPath(
      registryPathOverride,
      { workspaceDir: repoRoot }
    );
    if (!registryResolution.ok) {
      return refusalPlan({
        decision_code: UNAVAILABLE_CODE,
        reason: `agent-role: ${registryResolution.reason}`,
        role,
        family,
        unitAddress
      });
    }
    try {
      registry = await loadRegistry({ registryPath: registryResolution.path });
    } catch (error) {
      return refusalPlan({
        decision_code: UNAVAILABLE_CODE,
        reason: `agent-role: launcher registry could not be loaded: ${error?.message ?? error}`,
        role,
        family,
        unitAddress
      });
    }
  }

  if (
    !registry?.data
    || typeof registry.data !== "object"
    || !registry.data.filesystem_mcp_backends
    || Object.keys(registry.data.filesystem_mcp_backends).length === 0
  ) {
    return refusalPlan({
      decision_code: UNAVAILABLE_CODE,
      reason: "agent-role: launcher registry has no filesystem_mcp_backends; run agent-launch init-config or update the operator config",
      role,
      family,
      unitAddress
    });
  }

  const explicitProfile = readStringOption(options, "profile");
  const profile = explicitProfile
    ?? deriveDefaultProfileFromRegistry(registry, family, role, readStringOption(options, "backend-key"));
  if (!profile) {
    return refusalPlan({
      decision_code: UNSUPPORTED_PROFILE_CODE,
      reason: `agent-role: no registry profile is declared for family=${family}, role=${role}`,
      role,
      family,
      unitAddress
    });
  }

  const authorityResult = resolveFilesystemMcpBackendAuthority({
    registry,
    agentFamily: family,
    agentProfile: profile,
    agentRole: role,
    backendKey: readStringOption(options, "backend-key")
  });
  if (!authorityResult.ok) {
    return refusalPlan({
      decision_code: authorityResult.refusal.decision_code,
      reason: authorityResult.refusal.reason,
      role,
      family,
      profile,
      unitAddress
    });
  }
  const authority = authorityResult.authority;

  const preparationAuditNow = typeof env.AGENT_LAUNCH_TIMESTAMP === "string" && env.AGENT_LAUNCH_TIMESTAMP.length > 0
    ? env.AGENT_LAUNCH_TIMESTAMP
    : new Date().toISOString();
  const preparationAudit = buildAgentRolePreparationAudit({
    family,
    role,
    profile,
    unitAddress,
    repoRoot,
    registry,
    now: preparationAuditNow
  });
  const readOnlyDispatch = READ_ONLY_ROLES.has(role);
  const dispatchRole = readOnlyDispatch ? "read_only" : "implementation";
  const initialReadiness = await validateWorkRecordDispatch({
    dir: repoRoot,
    unitAddress,
    dispatch_role: dispatchRole,
    preparation_audit: preparationAudit,
    now: preparationAuditNow
  });
  const bridgeResult = await applyGraphImpactBridge({
    readiness: initialReadiness,
    env,
    repo: repoRoot,
    envVar: AGENT_ROLE_GRAPH_IMPACT_BRIDGE_ENV_VAR,
    validate: (evidence) =>
      validateWorkRecordDispatch({
        dir: repoRoot,
        unitAddress,
        dispatch_role: dispatchRole,
        graph_impact: evidence,
        preparation_audit: preparationAudit,
        now: preparationAuditNow
      })
  });
  const readiness = bridgeResult.readiness;
  const graphImpactBridge = bridgeResult.bridge;
  const dependencyEvidence = summarizeDispatchReadinessDependencies(readiness);
  if (!readiness.dispatchable) {
    const diagnostics = [];
    appendGraphImpactBridgeDiagnostic(diagnostics, graphImpactBridge);
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: work record ${unitAddress} is not dispatchable (${readiness.decision_code})`,
      role,
      family,
      profile,
      unitAddress,
      readiness,
      graphImpactBridge,
      diagnostics,
      dependencyEvidence
    });
  }

  const loaded = await loadWorkRecordById({ dir: repoRoot, id: recordId });
  if (!loaded.record) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: canonical work record ${recordId} could not be loaded`,
      role,
      family,
      profile,
      unitAddress,
      readiness
    });
  }
  const record = loaded.record;
  const selectedSlice = sliceId
    ? Array.isArray(record.slices)
      ? record.slices.find((slice) => slice && slice.id === sliceId) || null
      : null
    : null;
  if (sliceId && !selectedSlice) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: slice ${sliceId} not present on ${recordId}`,
      role,
      family,
      profile,
      unitAddress,
      readiness
    });
  }

  const scope = deriveScope({ record, selectedSlice, role });
  if (!scope) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: canonical work record ${unitAddress} does not declare a usable scope`,
      role,
      family,
      profile,
      unitAddress,
      readiness
    });
  }

  const declaredReviewerWriteScope = role === "reviewer"
    ? deriveDeclaredWriteScope({ record, selectedSlice })
    : [];
  const normalizedReviewerWriteScope = Array.isArray(scope.write_scope) ? scope.write_scope : [];

  const observedReviewerWriteScope = declaredReviewerWriteScope.length > 0
    ? declaredReviewerWriteScope
    : normalizedReviewerWriteScope;
  const reviewerWriteScopeGate = role === "reviewer"
    ? gateRoleWriteScope({ role: "reviewer", write_scope: observedReviewerWriteScope })
    : { ok: true };
  if (role === "reviewer" && !reviewerWriteScopeGate.ok) {
    const observedWriteScopeSize = Math.max(
      declaredReviewerWriteScope.length,
      normalizedReviewerWriteScope.length
    );
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: reviewer dispatch requires write_scope: [] (got ${observedWriteScopeSize} entries)`,
      role,
      family,
      profile,
      unitAddress,
      readiness,
      runtimeBlockerCode: ROLE_POLICY_VIOLATION_CODE,
      rolePolicyReason: REVIEWER_WRITE_SCOPE_NONEMPTY_REASON,
      rolePolicyDetail: buildReviewerWriteScopeRefusalDetail({
        subject: unitAddress,
        role: "reviewer",
        subjectKind: "work_record",
        subjectTitle: typeof record?.title === "string" ? record.title : null,
        recordId,
        sliceId,
        observedWriteScopeSize,
        repoPaths: selectedSlice && Array.isArray(selectedSlice.repo_paths)
          ? selectedSlice.repo_paths
          : Array.isArray(record?.repo_paths)
            ? record.repo_paths
            : []
      }),
      reviewerEmptyScopeAssertion: buildReviewerEmptyScopeAssertion(
        declaredReviewerWriteScope.length > 0 ? declaredReviewerWriteScope : normalizedReviewerWriteScope,
          false
      )
    });
  }
  const declaredRedteamWriteScope = role === "redteam"
    ? deriveDeclaredWriteScope({ record, selectedSlice })
    : [];
  const normalizedRedteamWriteScope = Array.isArray(scope.write_scope) ? scope.write_scope : [];
  const observedRedteamWriteScope = declaredRedteamWriteScope.length > 0
    ? declaredRedteamWriteScope
    : normalizedRedteamWriteScope;
  const redteamWriteScopeGate = role === "redteam"
    ? gateRoleWriteScope({ role: "redteam", write_scope: observedRedteamWriteScope })
    : { ok: true };
  if (role === "redteam" && !redteamWriteScopeGate.ok) {
    const observedWriteScopeSize = Math.max(
      declaredRedteamWriteScope.length,
      normalizedRedteamWriteScope.length
    );
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: redteam dispatch requires write_scope: [] (got ${observedWriteScopeSize} entries)`,
      role,
      family,
      profile,
      unitAddress,
      readiness,
      runtimeBlockerCode: ROLE_POLICY_VIOLATION_CODE,
      rolePolicyReason: REDTEAM_WRITE_SCOPE_NONEMPTY_REASON,
      rolePolicyDetail: buildReviewerWriteScopeRefusalDetail({
        subject: unitAddress,
        role: "redteam",
        subjectKind: "work_record",
        subjectTitle: typeof record?.title === "string" ? record.title : null,
        recordId,
        sliceId,
        observedWriteScopeSize,
        repoPaths: selectedSlice && Array.isArray(selectedSlice.repo_paths)
          ? selectedSlice.repo_paths
          : Array.isArray(record?.repo_paths)
            ? record.repo_paths
            : []
      })
    });
  }
  const reviewerEmptyScopeAssertion = role === "reviewer"
    ? buildReviewerEmptyScopeAssertion(scope.write_scope,   true)
    : null;

  const validationResult = normalizeValidationFromRecord({
    record,
    selectedSlice,
    required: !readOnlyDispatch
  });
  if (!validationResult.ok) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: ${validationResult.reason}`,
      role,
      family,
      profile,
      unitAddress,
      readiness
    });
  }
  const validation = validationResult.value;

  const runId = randomUUID();
  const provenanceDestination = {
    kind: "launcher_owned",
    run_id: runId
  };

  const subject = {
    kind: "work_unit",
    repo: typeof record.repo === "string" && record.repo.length > 0
      ? record.repo
      : path.basename(repoRoot),
    unit: {
      record_id: recordId,
      slice_id: sliceId,
      address: unitAddress
    }
  };

  const tools = {
    raw_exec_enabled: false,
    filesystem_mcp: {
      read: true,
      write: !READ_ONLY_ROLES.has(role),
      structured_validation: true,
      final_report: true
    }
  };

  const environmentPolicy = { mode: "closed", allowed_keys: [] };

  const workRecordDigest = computeWorkRecordSourceDigest(record);
  const scopeDigest = sha256OfCanonical(scope);
  const normalizedInputDigest = sha256OfCanonical({
    subject,
    scope,
    validation,
    environment_policy: environmentPolicy
  });
  const evidence = {
    work_record_digest: workRecordDigest,
    scope_digest: scopeDigest,
    normalized_input_digest: normalizedInputDigest
  };

  const requestInput = {
    subject,
    agent: {
      family,
      role,
      profile,
      model: readStringOption(options, "model")
    },
    scope,
    tools,
    validation,
    environment_policy: environmentPolicy,
    provenance_destination: provenanceDestination,
    evidence
  };

  let request;
  try {
    request = buildRegistryBackedFilesystemMcpAgentBackendRequestV1(authority, requestInput);
  } catch (error) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: failed to build agent-backend-request.v1: ${error?.message ?? error}`,
      role,
      family,
      profile,
      unitAddress,
      readiness
    });
  }

  let decisionResult;
  if (seamUsable) {
    decisionResult = await normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1(
      {
        authority,
        allowed: true,
        handshake_transport_source: launcherOwnedAuthorityContext.handshakeTransportSource,
        request,
        handshake: launcherOwnedAuthorityContext.handshakeResult,
        provenance: {
          profile,
          raw_exec_enabled: false,
          scope_digest: scopeDigest
        }
      },
      {
        verifierCapability: launcherOwnedAuthorityContext.verifierCapability,
        nonceStore: launcherOwnedAuthorityContext.resultNonceStore
      }
    );
  } else {
    decisionResult = await normalizeRegistryBackedVerifiedFilesystemMcpAgentBackendDecisionV1({
      authority,
      allowed: false,
      decision_code: UNAVAILABLE_CODE,
      severity: "error",
      effect: "blocks_launch",
      reason: "agent-launch agent-role v1 has no launcher-owned filesystem-MCP authority context; an enforced launch requires a launcher-owned verifier capability, nonce store, registry-pinned handshake transport, and a signed handshake result supplied through the in-process launcher seam",
      request,
      provenance: { profile, raw_exec_enabled: false }
    });
  }
  if (!decisionResult.ok) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: backend decision construction failed: ${decisionResult.diagnostics?.map((d) => d.message).join("; ") ?? "unknown"}`,
      role,
      family,
      profile,
      unitAddress,
      request
    });
  }
  const decision = decisionResult.value;

  let launcherContext = null;
  if (decision.allowed === true) {
    const mintResult = await mintAgentRoleLauncherContext({
      role,
      family,
      profile,
      unitAddress,
      recordId,
      sliceId,
      runId,
      repoRoot,
      env,
      request,
      decision,
      record,
      selectedSlice,
      registry,
      scope,
      environmentPolicy,
      validation
    });
    if (!mintResult.ok) {
      return refusalPlan({
        decision_code: MISCONFIGURED_CODE,
        reason: `agent-role: launcher-context envelope could not be minted: ${mintResult.reason}`,
        role,
        family,
        profile,
        unitAddress,
        request
      });
    }
    launcherContext = mintResult.value;
  }

  return {
    mode: decision.allowed === true ? "accepted" : "refusal",
    role,
    family,
    profile,
    unit_address: unitAddress,
    record_id: recordId,
    slice_id: sliceId,
    run_id: runId,
    request,
    decision,
    launcher_role_guard_context: launcherContext,
    backend_authority: {
      backend_key: authority.backend_key,
      backend_id: authority.backend_id,
      backend_version: authority.backend_version,
      mode: authority.mode,
      handshake_source_kind: authority.handshake_source.kind
    },
    graph_impact_bridge: graphImpactBridge ?? null,
    readiness,
    dependency_evidence: dependencyEvidence,
    reviewer_empty_scope_assertion: reviewerEmptyScopeAssertion,
    runtime_blocker_code: null
  };
}

function snapshotCallerSuppliedIdentityProbe({ env, options }) {
  const probe = {};
  if (env && typeof env === "object") {
    const envCarriers = {};
    for (const key of IDENTITY_CARRIER_ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) {
        envCarriers[key] = env[key];
      }
    }
    if (Object.keys(envCarriers).length > 0) {
      probe.env = envCarriers;
    }
  }
  if (options && typeof options === "object" && !Array.isArray(options)) {
    if (
      options.claimed_identity
      && typeof options.claimed_identity === "object"
      && !Array.isArray(options.claimed_identity)
      && Object.prototype.hasOwnProperty.call(options.claimed_identity, "role")
    ) {
      probe.claimed_identity = { role: options.claimed_identity.role };
    }
    if (
      options.argv
      && typeof options.argv === "object"
      && !Array.isArray(options.argv)
      && Object.prototype.hasOwnProperty.call(options.argv, "role")
    ) {
      probe.argv = { role: options.argv.role };
    }
  }
  return probe;
}

export function buildReviewerEmptyScopeAssertion(writeScope, passed) {
  const scopeForDigest = Array.isArray(writeScope) ? writeScope : [];
  const digest = sha256OfCanonical(scopeForDigest);
  return {
    schema_version: "agent-role-reviewer-empty-scope-assertion.v1",
    enforced: passed === true,
    write_scope_length: scopeForDigest.length,
    write_scope_digest: digest,
    refusal_reason: passed === true ? null : REVIEWER_WRITE_SCOPE_NONEMPTY_REASON
  };
}

export const REVIEWER_WRITE_SCOPE_REMEDIATION_ACTION =
  "create_or_select_separate_findings_only_review_unit";

export function buildReviewerWriteScopeRemediation({ subject = null, repoPaths = [] } = {}) {
  return {
    action: REVIEWER_WRITE_SCOPE_REMEDIATION_ACTION,
    suggested_unit_id_examples: ["WK-#####review", "WK-#####implementation-review"],
    work_kind: "review",
    write_scope: [],
    repo_paths: Array.isArray(repoPaths) ? repoPaths : [],
    depends_on: typeof subject === "string" && subject.length > 0 ? [subject] : [],
    acceptance: [
      "Findings-only review.",
      "Do not modify files.",
      "Report findings against the inspected files."
    ]
  };
}

export function buildReviewerWriteScopeRefusalDetail({
  subject = null,
  role = "reviewer",
  subjectKind = "work_record",
  subjectTitle = null,
  recordId = null,
  sliceId = null,
  observedWriteScopeSize = 0,
  repoPaths = []
} = {}) {
  return {
    subject,
    role,
    subject_kind: subjectKind,
    subject_title: subjectTitle,
    record_id: recordId,
    slice_id: sliceId,
    observed_write_scope_size: observedWriteScopeSize,
    required_write_scope: [],
    cause_classification: "coordination_wk_shape_issue",
    remediation: buildReviewerWriteScopeRemediation({ subject, repoPaths })
  };
}

function buildAgentRolePreparationAudit({ family, role, profile, unitAddress, repoRoot, registry, now }) {
  const sourceDigests = [];
  const unitDigest = computeSha256Hex(unitAddress ?? "");
  if (unitDigest) {
    sourceDigests.push({ kind: "unit_address", ref: unitAddress, digest: `sha256:${unitDigest}` });
  }
  if (registry && typeof registry.hash === "string" && registry.hash.length > 0) {
    sourceDigests.push({
      kind: "launcher_registry",
      ref: typeof registry.path === "string" && registry.path.length > 0 ? registry.path : "launcher_registry",
      digest: registry.hash
    });
  }
  if (typeof repoRoot === "string" && repoRoot.length > 0) {
    sourceDigests.push({
      kind: "repo_root",
      ref: repoRoot,
      digest: `sha256:${computeSha256Hex(repoRoot)}`
    });
  }
  return {
    required: false,
    actor: {
      kind: "tool",
      id: `agent-chassis:agent-role:${family}:${role}:${profile ?? "default"}`
    },
    source_digests: sourceDigests,
    evaluated_at: now
  };
}

function computeSha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function mintAgentRoleLauncherContext({
  role,
  family,
  profile,
  unitAddress,
  recordId,
  sliceId,
  runId,
  repoRoot,
  env = process.env,
  request,
  decision,
  record,
  selectedSlice,
  registry,
  scope,
  environmentPolicy,
  validation
}) {

  let secret;
  try {
    secret = await loadLauncherRoleGuardSecret(repoRoot);
  } catch (error) {
    return {
      ok: false,
      reason: `launcher role-guard secret unavailable (${error?.code ?? error?.message ?? error})`
    };
  }

  const acceptedHandshakeDigest = typeof decision.accepted_handshake_digest === "string"
    ? decision.accepted_handshake_digest
    : null;
  const handshake = decision.handshake;
  if (!acceptedHandshakeDigest || !handshake || typeof handshake.expires_at !== "string") {
    return {
      ok: false,
      reason: "accepted allowed.v1 decision is missing handshake digest or expires_at"
    };
  }
  const handshakeExpiresAtMs = Date.parse(handshake.expires_at);
  if (!Number.isFinite(handshakeExpiresAtMs)) {
    return { ok: false, reason: "handshake.expires_at is not a valid timestamp" };
  }
  const now = new Date();
  const ttlSeconds = Math.min(
    120,
    Math.floor((handshakeExpiresAtMs - now.getTime()) / 1000)
  );
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return { ok: false, reason: "handshake already expired or yields non-positive TTL" };
  }

  const evidenceScopeDigest = request?.evidence?.scope_digest;
  if (typeof evidenceScopeDigest !== "string") {
    return { ok: false, reason: "request.evidence.scope_digest missing" };
  }
  if (typeof handshake.scope_digest === "string" && handshake.scope_digest !== evidenceScopeDigest) {
    return { ok: false, reason: "handshake.scope_digest does not match request evidence" };
  }
  const readScopeDigest = computeActionPayloadHash(scope.read_scope);
  const writeScopeDigest = computeActionPayloadHash(scope.write_scope);
  const envPolicyDigest = computeActionPayloadHash(environmentPolicy);

  const briefRendered = renderWorkRecordAgentBrief(record, { sliceId });
  if (!briefRendered || !briefRendered.valid || !briefRendered.projection) {
    return { ok: false, reason: "canonical agent brief could not be rendered" };
  }
  const agentBriefDigest = computeActionPayloadHash(briefRendered.projection);

  const validationTransport = deriveValidationTransport(validation);
  if (!validationTransport) {
    return { ok: false, reason: "validation transport is not argv or named" };
  }

  let actionBinding;
  try {
    actionBinding = buildLauncherContextActionBinding({
      actionType: "agent_role_launch",
      repoRoot,
      configPath: registry.path,
      role,
      wk: recordId,
      acceptedHandshakeDigest,
      backendKind: "filesystem_mcp",
      agentFamily: family,
      agentProfile: profile,
      agentRole: role,
      unitAddress,
      recordId,
      sliceId,
      runId,
      readScopeDigest,
      writeScopeDigest,
      validationTransport,
      provenanceDestinationKind: "launcher_owned",
      envPolicyDigest,
      agentBriefDigest
    });
  } catch (error) {
    if (error instanceof RoleGuardError) {
      return { ok: false, reason: `${error.code}: ${error.message}` };
    }
    throw error;
  }

  const reviewedMetadata = {
    review_id: null,
    handoff_id: null,
    mode: `agent-role.${family}.${role}.${profile}`,
    repo_root: repoRoot,
    input_manifest_hash: computeWorkRecordSourceDigest(record),
    registry_hash: registry.hash,
    role_context: {
      role,
      family,
      profile,
      unit_address: unitAddress,
      record_id: recordId,
      slice_id: sliceId
    },
    run_id: runId
  };

  let context;
  try {
    context = await mintLauncherContext({
      secret,
      reviewedMetadata,
      actionBinding,
      ttlSeconds,
      now
    });
  } catch (error) {
    if (error instanceof RoleGuardError) {
      return { ok: false, reason: `${error.code}: ${error.message}` };
    }
    throw error;
  }

  const runtimeStateEnsured = await ensureLauncherRuntimeStateDir({
    workspaceDir: repoRoot,
    env
  });
  if (!runtimeStateEnsured.ok) {
    return {
      ok: false,
      reason: `launcher runtime state unavailable (${runtimeStateEnsured.code}): ${runtimeStateEnsured.reason}`
    };
  }
  let nonceStore;
  try {
    nonceStore = await createLauncherContextNonceStore({
      dir: getLauncherContextNonceDir(repoRoot, env)
    });
  } catch (error) {
    return {
      ok: false,
      reason: `launcher runtime state unavailable (nonce store): ${error?.code ?? error?.message ?? error}`
    };
  }
  let marked = false;
  try {
    marked = await nonceStore.checkAndMark(context.nonce, context.expires_at);
  } catch (error) {
    return {
      ok: false,
      reason: `nonce store check failed (${error?.code ?? error?.message ?? error})`
    };
  }
  if (marked !== true) {
    return { ok: false, reason: "nonce store rejected the freshly minted nonce" };
  }

  return { ok: true, value: context };
}

function deriveValidationTransport(validation) {
  if (!validation || !Array.isArray(validation.commands) || validation.commands.length === 0) {
    return null;
  }
  let sawArgv = false;
  let sawNamed = false;
  for (const command of validation.commands) {
    if (command?.form === "argv") {
      sawArgv = true;
    } else if (command?.form === "named") {
      sawNamed = true;
    } else {
      return null;
    }
  }
  if (sawNamed && !sawArgv) {
    return "named";
  }
  if (sawArgv && !sawNamed) {
    return "argv";
  }
  return null;
}

function checkInputShape({ rawRole, rawFamily, rawUnitAddress }) {
  if (typeof rawRole !== "string" || rawRole.length === 0) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: "agent-role: role is required",
      role: rawRole ?? null,
      family: rawFamily ?? null,
      unitAddress: rawUnitAddress ?? null
    });
  }
  if (!SUPPORTED_ROLES.has(rawRole.trim())) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: role must be one of worker, reviewer, redteam (got ${rawRole})`,
      role: rawRole,
      family: rawFamily ?? null,
      unitAddress: rawUnitAddress ?? null
    });
  }
  if (typeof rawFamily !== "string" || rawFamily.length === 0) {
    return refusalPlan({
      decision_code: UNSUPPORTED_FAMILY_CODE,
      reason: "agent-role: agent family is required",
      role: rawRole,
      family: rawFamily ?? null,
      unitAddress: rawUnitAddress ?? null
    });
  }
  const family = rawFamily.trim();
  if (!AGENT_BACKEND_AGENT_FAMILIES.includes(family)) {
    return refusalPlan({
      decision_code: UNSUPPORTED_FAMILY_CODE,
      reason: `agent-role: agent family ${family} is not in agent-backend-request.v1 (${AGENT_BACKEND_AGENT_FAMILIES.join(", ")})`,
      role: rawRole,
      family,
      unitAddress: rawUnitAddress ?? null
    });
  }
  if (!SUPPORTED_FAMILIES.has(family)) {
    return refusalPlan({
      decision_code: UNSUPPORTED_FAMILY_CODE,
      reason: `agent-role: agent family ${family} is out of scope for the v1 agent-role command; codex remains on codex-role`,
      role: rawRole,
      family,
      unitAddress: rawUnitAddress ?? null
    });
  }
  if (typeof rawUnitAddress !== "string" || rawUnitAddress.length === 0) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: "agent-role: unit address is required (e.g. WK-0300 or WK-0300#slice-id)",
      role: rawRole,
      family,
      unitAddress: rawUnitAddress ?? null
    });
  }
  if (!AGENT_BACKEND_AGENT_ROLES.includes(rawRole.trim())) {
    return refusalPlan({
      decision_code: MISCONFIGURED_CODE,
      reason: `agent-role: role ${rawRole} is not declared in AGENT_BACKEND_AGENT_ROLES`,
      role: rawRole,
      family,
      unitAddress: rawUnitAddress
    });
  }
  return null;
}

function deriveDeclaredWriteScope({ record, selectedSlice }) {
  if (selectedSlice && Array.isArray(selectedSlice.write_scope)) {
    return selectedSlice.write_scope;
  }
  if (record && Array.isArray(record.write_scope)) {
    return record.write_scope;
  }
  return [];
}

function deriveScope({ record, selectedSlice, role }) {
  const baseWriteScope = deriveDeclaredWriteScope({ record, selectedSlice });
  const baseRepoPaths = selectedSlice && Array.isArray(selectedSlice.repo_paths)
    ? selectedSlice.repo_paths
    : Array.isArray(record.repo_paths)
      ? record.repo_paths
      : [];

  const writeScope = READ_ONLY_ROLES.has(role) ? [] : sortedUnique(baseWriteScope);
  const readScopeUnion = sortedUnique([...baseRepoPaths, ...baseWriteScope]);
  const readScope = readScopeUnion.length > 0 ? readScopeUnion : ["."];

  if (!READ_ONLY_ROLES.has(role) && writeScope.length === 0) {
    return null;
  }
  return {
    read_scope: readScope,
    write_scope: writeScope
  };
}

function normalizeValidationFromRecord({ record, selectedSlice, required = true }) {
  const raw = selectedSlice && Array.isArray(selectedSlice.acceptance?.validation)
    ? selectedSlice.acceptance.validation
    : Array.isArray(record.acceptance?.validation)
      ? record.acceptance.validation
      : [];
  if (raw.length === 0) {
    if (!required) {
      return { ok: true, value: { commands: [] } };
    }
    return { ok: false, reason: "canonical record does not declare acceptance.validation" };
  }
  const commands = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return { ok: false, reason: "validation entries must be non-empty strings" };
    }
    const tokens = entry.trim().split(/\s+/);
    if (tokens.length === 0) {
      return { ok: false, reason: "validation entry tokenized to an empty argv" };
    }
    if (isShellWrapperInvocation(tokens)) {
      return {
        ok: false,
        reason: `validation entry uses a bash/sh shell-string wrapper which is not the authority surface: ${entry}`
      };
    }
    commands.push({ form: "argv", argv: tokens });
  }
  return { ok: true, value: { commands } };
}

function isShellWrapperInvocation(tokens) {
  if (tokens.length < 2) {
    return false;
  }
  const head = tokens[0];
  const flag = tokens[1];
  if (head === "bash" || head === "/bin/bash" || head === "/usr/bin/bash") {
    if (flag === "-lc" || flag === "-c" || flag === "-l") {
      return true;
    }
  }
  if (head === "sh" || head === "/bin/sh" || head === "/usr/bin/sh") {
    if (flag === "-c") {
      return true;
    }
  }
  return false;
}

function deriveDefaultProfileFromRegistry(registry, family, role, backendKey) {
  const data = registry?.data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const backends = data.filesystem_mcp_backends;
  if (!backends || typeof backends !== "object") {
    return null;
  }
  const resolvedKey = (typeof backendKey === "string" && backendKey.length > 0)
    ? backendKey
    : data.filesystem_mcp_backend_default;
  if (typeof resolvedKey !== "string" || !Object.prototype.hasOwnProperty.call(backends, resolvedKey)) {
    return null;
  }
  const entry = backends[resolvedKey];
  if (!entry || !Array.isArray(entry.supported_profiles)) {
    return null;
  }
  const registryRole = role === "reviewer" ? "code_review" : role;
  for (const row of entry.supported_profiles) {
    if (!row || row.agent_family !== family) {
      continue;
    }
    if (Array.isArray(row.roles) && row.roles.includes(registryRole)) {
      return row.profile;
    }
  }
  return null;
}

function refusalPlan({
  decision_code,
  reason,
  role,
  family,
  profile,
  unitAddress,
  request,
  readiness,
  graphImpactBridge,
  diagnostics,
  dependencyEvidence,
  runtimeBlockerCode = null,
  rolePolicyReason = null,
  rolePolicyDetail = null,
  reviewerEmptyScopeAssertion = null,
  identityRefusal = null
}) {
  const decision = buildFilesystemMcpAuthorityRefusalDecisionV1(
    { decision_code, severity: "error", reason },
    { request: request ?? null }
  );
  const resolvedDependencyEvidence = dependencyEvidence
    ?? (readiness ? summarizeDispatchReadinessDependencies(readiness) : null);
  const refusalDiagnostics = Array.isArray(diagnostics) ? [...diagnostics] : [];
  if (rolePolicyReason !== null) {
    refusalDiagnostics.push({
      code: runtimeBlockerCode ?? ROLE_POLICY_VIOLATION_CODE,
      message: reason,
      path: "scope.write_scope",
      reason: rolePolicyReason,

      ...(rolePolicyDetail && typeof rolePolicyDetail === "object"
        ? { detail: rolePolicyDetail }
        : {})
    });
  }
  if (identityRefusal && typeof identityRefusal === "object") {
    refusalDiagnostics.push({
      code: runtimeBlockerCode ?? CALLER_SUPPLIED_IDENTITY_CODE,
      message: identityRefusal.refusal_message ?? "caller-supplied identity is not authority",
      path: identityRefusal.detail?.carrier ?? "request",
      identity_refusal_code: identityRefusal.refusal_code ?? IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE
    });
  }
  return {
    mode: "refusal",
    role: role ?? null,
    family: family ?? null,
    profile: profile ?? null,
    unit_address: unitAddress ?? null,
    request: request ?? null,
    decision,
    launcher_role_guard_context: null,
    readiness: readiness ?? null,
    graph_impact_bridge: graphImpactBridge ?? null,
    diagnostics: refusalDiagnostics.length > 0 ? refusalDiagnostics : null,
    dependency_evidence: resolvedDependencyEvidence,
    runtime_blocker_code: runtimeBlockerCode,
    reviewer_empty_scope_assertion: reviewerEmptyScopeAssertion ?? null,
    reviewer_write_scope_refusal: rolePolicyDetail ?? null
  };
}

function redactPlanForOutput(plan) {

  if (!plan || typeof plan !== "object") {
    return plan;
  }
  const envelope = plan.launcher_role_guard_context;
  if (!envelope || typeof envelope !== "object") {
    return plan;
  }
  return {
    ...plan,
    launcher_role_guard_context: redactLauncherContextEnvelope(envelope)
  };
}

function redactLauncherContextEnvelope(envelope) {
  const redacted = { ...envelope };
  if (Object.prototype.hasOwnProperty.call(redacted, "integrity")) {
    redacted.integrity = "<redacted>";
  }
  if (Object.prototype.hasOwnProperty.call(redacted, "nonce")) {
    redacted.nonce = "<redacted>";
  }
  return redacted;
}

function sortedUnique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  result.sort();
  return result;
}

function sha256OfCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("base64url")}`;
}

function readStringOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

async function findRepoRoot(start) {
  let current = path.resolve(start);
  try {
    const info = await stat(current);
    if (!info.isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    current = path.dirname(current);
  }
  while (true) {
    try {
      const wiki = await stat(path.join(current, "wiki"));
      const docs = await stat(path.join(current, "docs"));
      if (wiki.isDirectory() && docs.isDirectory()) {
        return current;
      }
    } catch {

    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`agent-role: expected repo with wiki/ and docs/ at or above ${start}`);
    }
    current = parent;
  }
}

function writeLine(stream, value) {
  if (stream?.write) {
    stream.write(`${value}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}
