

import { assembleRoleIsolationInputs } from "./workspace-agent-launch-core.mjs";

import {
  CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC as CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC_IMPL,
  CODEX_ROLE_FAST_REFUSAL_GATE_CODE as CODEX_ROLE_FAST_REFUSAL_GATE_CODE_IMPL,
  CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE as CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE_IMPL,
  CODEX_ROLE_ISOLATION_SCHEMA_VERSION as CODEX_ROLE_ISOLATION_SCHEMA_VERSION_IMPL,
  ROLE_CONFIG as ROLE_CONFIG_IMPL,
  buildCodexRoleBubblewrapPlan as buildCodexRoleBubblewrapPlanImpl,
  buildCodexRoleIsolationInputs as buildCodexRoleIsolationInputsImpl,
  buildFastDecommissionedRefusalPlan as buildFastDecommissionedRefusalPlanImpl,
  findRepoRoot as findRepoRootImpl,
  isolationSummaryForPublic as isolationSummaryForPublicImpl,
  stripNestedCodexSandboxArgs as stripNestedCodexSandboxArgsImpl
} from "./codex-role-adapter-isolation.mjs";
import {
  buildOrchestratorPlan as buildOrchestratorPlanImpl,
  ensureRefusalDependencyEvidence as ensureRefusalDependencyEvidenceImpl
} from "./codex-role-adapter-orchestrator-plan.mjs";
import {
  buildCodexReviewerWriteScopeRefusal as buildCodexReviewerWriteScopeRefusalImpl,
  buildReadOnlyPlan as buildReadOnlyPlanImpl,
  enforceReviewerWriteScope as enforceReviewerWriteScopeImpl
} from "./codex-role-adapter-readonly-plan.mjs";
import {
  buildHeadlessPlan as buildHeadlessPlanImpl
} from "./codex-role-adapter-headless-plan.mjs";
import {
  buildCodexReasoningEffortConfigOverrides as buildCodexReasoningEffortConfigOverridesImpl
} from "./codex-role-reasoning-effort.mjs";

export const CODEX_ROLE_ISOLATION_SCHEMA_VERSION = CODEX_ROLE_ISOLATION_SCHEMA_VERSION_IMPL;
export const CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE = CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE_IMPL;
export const CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC = CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC_IMPL;
export const CODEX_ROLE_FAST_REFUSAL_GATE_CODE = CODEX_ROLE_FAST_REFUSAL_GATE_CODE_IMPL;
export const ROLE_CONFIG = ROLE_CONFIG_IMPL;
export const buildCodexRoleIsolationInputs = buildCodexRoleIsolationInputsImpl;
export const stripNestedCodexSandboxArgs = stripNestedCodexSandboxArgsImpl;
export const buildCodexRoleBubblewrapPlan = buildCodexRoleBubblewrapPlanImpl;
export const isolationSummaryForPublic = isolationSummaryForPublicImpl;
export const buildFastDecommissionedRefusalPlan = buildFastDecommissionedRefusalPlanImpl;
export const buildOrchestratorPlan = buildOrchestratorPlanImpl;
export const ensureRefusalDependencyEvidence = ensureRefusalDependencyEvidenceImpl;
export const buildReadOnlyPlan = buildReadOnlyPlanImpl;
export const enforceReviewerWriteScope = enforceReviewerWriteScopeImpl;
export const buildCodexReviewerWriteScopeRefusal = buildCodexReviewerWriteScopeRefusalImpl;
export const buildHeadlessPlan = buildHeadlessPlanImpl;
export const findRepoRoot = findRepoRootImpl;
export const buildCodexReasoningEffortConfigOverrides = buildCodexReasoningEffortConfigOverridesImpl;
