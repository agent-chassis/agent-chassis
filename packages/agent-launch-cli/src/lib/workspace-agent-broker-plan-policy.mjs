

import { adaptFamilyBrokerRefusal } from "./workspace-agent-family-launch-policy.mjs";
import { createWorkspaceAgentRunEnforcement } from "./workspace-agent-run-enforcement.mjs";

export const BROKER_PLAN_LAUNCH_STAGES = Object.freeze([
  "model",
  "write_scope",
  "probe",
  "preflight",
  "command",
  "bwrap"
]);

const REQUIRED_STAGES = Object.freeze(["probe", "command", "bwrap"]);

export const RESERVED_BROKER_ENFORCEMENT = createWorkspaceAgentRunEnforcement();

const MAX_DIAGNOSTIC_ITEMS = 6;

function truncateList(values, limit = MAX_DIAGNOSTIC_ITEMS) {
  if (!Array.isArray(values)) {
    return [];
  }
  if (values.length <= limit) {
    return values.slice();
  }
  const items = values.slice(0, limit);
  items.push(`...${values.length - limit} more`);
  return items;
}

export function buildBrokerPlanDiagnostics({ app, stage, details } = {}) {
  return {
    app: typeof app === "string" && app.length > 0 ? app : null,
    stage: typeof stage === "string" && stage.length > 0 ? stage : null,
    details: truncateList(Array.isArray(details) ? details : details ? [details] : [])
  };
}

export function resolveBrokerLaunchContext(launchInput) {
  const read = (value) =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    role: read(launchInput?.role),
    subject: read(launchInput?.subject),
    workspaceDir: read(launchInput?.workspace_dir)
  };
}

export function buildBrokerRefusalEnvelope({ app, stage, reason, detail = null } = {}) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return adaptFamilyBrokerRefusal({
      reason: "broker_plan_refusal_reason_missing",
      detail: {
        app: typeof app === "string" && app.length > 0 ? app : null,
        diagnostics: buildBrokerPlanDiagnostics({
          app,
          stage,
          details: ["reason_missing_or_blank"]
        })
      }
    });
  }
  return adaptFamilyBrokerRefusal({ reason, detail: detail ?? null });
}

export function buildBrokerSuccessPayload({
  env,
  role = null,
  subject = null,
  workspaceDir = null,
  app,
  bwrapPlan,
  parseFinalResult
} = {}) {
  if (typeof app !== "string" || app.length === 0) {
    return buildBrokerRefusalEnvelope({
      app,
      stage: "success",
      reason: "broker_plan_success_app_missing",
      detail: { diagnostics: buildBrokerPlanDiagnostics({ stage: "success", details: ["app_missing"] }) }
    });
  }
  if (bwrapPlan === null || bwrapPlan === undefined) {
    return buildBrokerRefusalEnvelope({
      app,
      stage: "bwrap",
      reason: "broker_plan_success_bwrap_plan_missing",
      detail: { app, diagnostics: buildBrokerPlanDiagnostics({ app, stage: "bwrap", details: ["bwrap_plan_missing"] }) }
    });
  }
  if (typeof parseFinalResult !== "function") {
    return buildBrokerRefusalEnvelope({
      app,
      stage: "success",
      reason: "broker_plan_success_parse_final_result_missing",
      detail: { app, diagnostics: buildBrokerPlanDiagnostics({ app, stage: "success", details: ["parse_final_result_not_a_function"] }) }
    });
  }
  const enforcement = createWorkspaceAgentRunEnforcement();
  return {
    ok: true,
    plan: { env, role, subject, workspaceDir, app, enforcement },
    bwrapPlan,
    parseFinalResult,
    enforcement
  };
}

function isRefusalResult(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    Object.prototype.hasOwnProperty.call(result, "refusal")
  );
}

function normalizeRefusal(refusal) {
  if (refusal === null || typeof refusal !== "object") {
    return { reason: null, detail: null };
  }
  return {
    reason: typeof refusal.reason === "string" ? refusal.reason : null,
    detail: refusal.detail ?? null
  };
}

export async function planFamilyBrokerLaunch({
  app,
  env,
  launchInput,
  steps = {},
  parseFinalResult,
  mapStepError
} = {}) {
  for (const stage of REQUIRED_STAGES) {
    if (typeof steps?.[stage] !== "function") {
      return buildBrokerRefusalEnvelope({
        app,
        stage,
        reason: "broker_plan_stage_not_implemented",
        detail: {
          app: typeof app === "string" ? app : null,
          diagnostics: buildBrokerPlanDiagnostics({
            app,
            stage,
            details: [`required_stage_missing:${stage}`]
          })
        }
      });
    }
  }

  const { role, subject, workspaceDir } = resolveBrokerLaunchContext(launchInput);
  const context = { app, env, launchInput, role, subject, workspaceDir };

  for (const stage of BROKER_PLAN_LAUNCH_STAGES) {
    const hook = steps?.[stage];
    if (typeof hook !== "function") {

      continue;
    }

    let result;
    try {
      result = await hook(context);
    } catch (err) {
      const mapped =
        typeof mapStepError === "function"
          ? mapStepError(stage, err)
          : null;
      const reason =
        mapped && typeof mapped.reason === "string" && mapped.reason.length > 0
          ? mapped.reason
          : "broker_plan_stage_threw";
      const detail =
        mapped && Object.prototype.hasOwnProperty.call(mapped, "detail")
          ? mapped.detail
          : {
              app: typeof app === "string" ? app : null,
              stage,
              message: err?.message ?? String(err),
              code: err?.code ?? null
            };
      return buildBrokerRefusalEnvelope({ app, stage, reason, detail });
    }

    if (isRefusalResult(result)) {
      const { reason, detail } = normalizeRefusal(result.refusal);
      return buildBrokerRefusalEnvelope({ app, stage, reason, detail });
    }

    if (result !== null && typeof result === "object") {
      Object.assign(context, result);
    }
  }

  return buildBrokerSuccessPayload({
    env,
    role: context.role,
    subject: context.subject,
    workspaceDir: context.workspaceDir,
    app,
    bwrapPlan: context.bwrapPlan,
    parseFinalResult
  });
}

export default {
  BROKER_PLAN_LAUNCH_STAGES,
  RESERVED_BROKER_ENFORCEMENT,
  buildBrokerPlanDiagnostics,
  resolveBrokerLaunchContext,
  buildBrokerRefusalEnvelope,
  buildBrokerSuccessPayload,
  planFamilyBrokerLaunch
};
