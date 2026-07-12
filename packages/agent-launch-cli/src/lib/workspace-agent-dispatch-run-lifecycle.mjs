

import {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  BACKEND_SUPPORTED_APPS,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  TERMINAL_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES
} from "@agent-chassis/agent-launch-core";

import { HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS } from "./host-write-authority-substrate.mjs";
import {
  resolveDispatchedRoleModel,
  resolveExplicitOverrideSelection
} from "./agent-launch-profiles.mjs";
import { resolveModel } from "./agent-launch-model-registry.mjs";

import {
  dispatchRefusal,
  statusRefusal,
  normalizeStatus
} from "./workspace-agent-dispatch-refusal.mjs";
import {
  normalizeFinalResultWithStructuredRoleResult,
  buildMissingResultEnvelopeWithStructuredRoleResult,
  attachDispatchProvenance
} from "./workspace-agent-dispatch-final-result-evidence.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import { resolveWorkerSourceToolSurface } from "./workspace-agent-dispatch-source-access.mjs";
import { WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION } from "./workspace-agent-write-scope-verification.mjs";

function attachWriteScopeVerification(envelope, rawFinalResult) {
  if (!envelope || typeof envelope !== "object") return envelope;
  const candidate = rawFinalResult?.write_scope_verification;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return envelope;
  }
  if (candidate.schema_version !== WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION) {
    return envelope;
  }
  return Object.freeze({ ...envelope, write_scope_verification: candidate });
}

function resolveDispatchSelection({ role, app, model, workspaceDir }) {
  const appToken = typeof app === "string" && app.trim().length > 0 ? app.trim() : null;
  const modelToken = typeof model === "string" && model.trim().length > 0 ? model.trim() : null;

  if (appToken !== null && !BACKEND_SUPPORTED_APPS.includes(appToken)) {
    return {
      ok: false,
      reason: "unsupported_app",
      detail: { app: appToken, supported_apps: [...BACKEND_SUPPORTED_APPS] }
    };
  }

  let selection;
  if (appToken !== null || modelToken !== null) {

    selection = appToken !== null && modelToken === null
      ? { ok: true, app: appToken, model: null, model_spec: null }
      : resolveExplicitOverrideSelection({ role, app: appToken, model: modelToken });
  } else {
    try {
      selection = resolveDispatchedRoleModel({ role, dir: workspaceDir });
    } catch (error) {
      const refusalRole = role === "review" ? "reviewer" : role;
      return {
        ok: false,
        reason: `${refusalRole ?? "role"}_role_config_invalid`,
        detail: {
          role: typeof refusalRole === "string" ? refusalRole : null,
          config_file: "agent-launch.toml",
          source_code: error?.code ?? "agent_launch_role_config_error",
          source_detail: error?.detail ?? null,
          message: error?.message ?? String(error)
        }
      };
    }
  }

  if (!selection || selection.ok !== true) {
    return selection ?? {
      ok: false,
      reason: "launcher_selection_unresolved",
      detail: { role: typeof role === "string" ? role : null }
    };
  }

  const modelSpec = selection.model_spec
    ?? (typeof selection.model === "string" ? resolveModel(selection.model) : null);
  return {
    ok: true,
    app: selection.app,
    model: selection.model ?? null,
    backend: modelSpec?.backend ?? null
  };
}

export function createDispatchRunLifecycle(ctx = {}) {
  const {
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    sleep,
    monotonicNow,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission = null,
    prepareSourceToolSurface = null,

    proveAssignedSourceReadable = null
  } = ctx;

  async function startLaunch(input = {}) {
    const {
      caller_session_id = null,
      role = null,
      subject = null,
      workspace_alias = null,
      workspace_dir = null,
      readiness = null,
      app: requestedApp = null,

      model: requestedModel = null
    } = input;

    const dispatchModel = typeof requestedModel === "string" && requestedModel.length > 0
      ? requestedModel
      : null;

    if (dispatchModel !== null) {
      for (const token of HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS) {
        if (dispatchModel.includes(token)) {
          return dispatchRefusal(
            BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            "forbidden_token_in_model_hint",
            { token }
          );
        }
      }
    }

    const selection = resolveDispatchSelection({
      role,
      app: requestedApp,
      model: dispatchModel,
      workspaceDir: workspace_dir
    });
    if (!selection.ok) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        selection.reason,
        selection.detail ?? null
      );
    }
    const { app, model: resolvedModel, backend: resolvedBackend } = selection;

    const familyExecutor = executors[app] ?? null;
    if (typeof familyExecutor !== "function") {
      const reason = BACKEND_FAMILY_UNAVAILABLE_REASONS[app];
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason,
        {
          app,
          missing_backend: familyAwareWiring
            ? `workspace_agent_dispatch_backend.launch_executors.${app}`
            : "workspace_agent_dispatch_backend.launch_executor"
        }
      );
    }
    const familyExecutorRegistryEntry = executorRegistryEntries[app] ?? familyExecutor;
    if (!caller_session_id || typeof caller_session_id !== "string") {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "caller_session_id_required",
        null
      );
    }

    if (!validateLauncherFamilyRole(role).ok) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "unsupported_role",
        { role }
      );
    }
    if (!subject || typeof subject !== "string") {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "subject_required",
        null
      );
    }

    let workerAdmissionDiagnostic = null;
    if (role === "worker" && typeof evaluateWorkerAdmission === "function") {
      let admissionOutcome;
      try {
        admissionOutcome = await evaluateWorkerAdmission({
          workspaceDir: workspace_dir ?? null,
          subject
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_threw",
          { message: error?.message ?? String(error) }
        );
      }
      if (!admissionOutcome || typeof admissionOutcome !== "object") {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_no_result",
          null
        );
      }
      if (!admissionOutcome.allowed) {

        const refusalDetail = admissionOutcome.remote_admission
          ? { ...(admissionOutcome.detail ?? {}), remote_admission: admissionOutcome.remote_admission }
          : (admissionOutcome.detail ?? null);
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          admissionOutcome.reason ?? "worker_admission_refused",
          refusalDetail
        );
      }
      workerAdmissionDiagnostic = admissionOutcome.remote_admission ?? null;
    }

    const sourceAccessResult = await resolveWorkerSourceToolSurface({
      app,
      role,
      subject,
      workspace_alias,
      workspace_dir,
      readiness,
      dispatchModel: resolvedModel,
      familyExecutorRegistryEntry,
      prepareSourceToolSurface,
      proveAssignedSourceReadable
    });
    if (!sourceAccessResult.ok) {
      return dispatchRefusal(
        sourceAccessResult.refusal.code,
        sourceAccessResult.refusal.reason,
        sourceAccessResult.refusal.detail
      );
    }
    const sourceToolSurface = sourceAccessResult.sourceToolSurface;

    const run_id = runIdFactory();
    const monitor_handle = monitorHandleFactory();
    const startedAtMs = clock();
    const startedAt = new Date(startedAtMs).toISOString();

    let executorResult;
    try {
      executorResult = await familyExecutor({
        caller_session_id,
        role,
        subject,
        workspace_alias: workspace_alias ?? null,
        workspace_dir: workspace_dir ?? null,
        readiness: readiness ?? null,
        run_id,
        monitor_handle,
        app,

        model: resolvedModel,
        backend: resolvedBackend,
        source_tool_surface: sourceToolSurface
      });
    } catch (error) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "launch_executor_threw",
        { message: error?.message ?? String(error) }
      );
    }

    if (!executorResult || typeof executorResult !== "object") {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "launch_executor_no_result",
        null
      );
    }
    if (executorResult.accepted === false) {
      const refusal = executorResult.refusal ?? {};
      return dispatchRefusal(
        refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        refusal.reason ?? "launch_executor_refused",
        refusal.detail ?? null
      );
    }
    const initialStatus = normalizeStatus(executorResult.status ?? "launching");
    if (!initialStatus) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "launch_executor_invalid_status",
        { status: executorResult.status ?? null }
      );
    }

    const record = {
      run_id,
      monitor_handle,
      app,
      model: resolvedModel,
      backend: resolvedBackend,
      role,
      subject,
      workspace_alias: workspace_alias ?? null,
      caller_session_id,
      status: initialStatus,
      started_at: startedAt,
      updated_at: startedAt,
      terminal: TERMINAL_STATUSES.has(initialStatus),
      exit: executorResult.exit ?? null,
      probe: typeof executorResult.probe === "function" ? executorResult.probe : null,
      final_result: null
    };

    if (record.terminal) {
      const capturedFinalResult = normalizeFinalResultWithStructuredRoleResult(
        executorResult.final_result,
        record
      );
      record.final_result = capturedFinalResult
        ? attachWriteScopeVerification(
            attachDispatchProvenance(capturedFinalResult, executorResult.final_result, record),
            executorResult.final_result
          )
        : buildMissingResultEnvelopeWithStructuredRoleResult(
            BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
            "executor_terminal_without_final_result",
            { status: initialStatus }
          );
    }
    runs.set(run_id, record);

    const startReviewResult = deriveBackendReviewResult(record);
    return {
      schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
      accepted: true,
      run_id,
      monitor_handle,
      app,
      model: resolvedModel,
      backend: resolvedBackend,
      role,
      subject,
      workspace_alias: record.workspace_alias,
      caller_session_id,
      status: initialStatus,
      terminal: record.terminal,
      started_at: startedAt,
      updated_at: startedAt,
      exit: record.exit,
      final_result: record.final_result,
      ...(startReviewResult ? { review_result: startReviewResult } : {}),

      ...(workerAdmissionDiagnostic ? { worker_admission: workerAdmissionDiagnostic } : {})
    };
  }

  async function getRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      run_id = null,
      subject = null
    } = input;

    let record = null;
    if (run_id && typeof run_id === "string") {
      record = runs.get(run_id) ?? null;
    }
    if (!record && monitor_handle && typeof monitor_handle === "string") {
      for (const candidate of runs.values()) {
        if (candidate.monitor_handle === monitor_handle) {
          record = candidate;
          break;
        }
      }
    }
    if (!record) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN,
        "unknown_run_or_handle",
        null
      );
    }
    if (caller_session_id && record.caller_session_id !== caller_session_id) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH,
        "caller_session_id_mismatch",
        null
      );
    }
    if (subject !== null && subject !== undefined && record.subject !== subject) {
      return statusRefusal(
        BACKEND_REFUSAL_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH,
        "subject_mismatch",
        null
      );
    }

    if (!record.terminal && typeof record.probe === "function") {
      try {
        const probed = await record.probe();
        if (probed && typeof probed === "object") {
          const nextStatus = normalizeStatus(probed.status);
          if (nextStatus) {
            record.status = nextStatus;
            record.terminal = TERMINAL_STATUSES.has(nextStatus);
          }
          if (probed.exit !== undefined) {
            record.exit = probed.exit;
          }

          if (record.terminal && !record.final_result) {
            const captured = normalizeFinalResultWithStructuredRoleResult(
              probed.final_result,
              record
            );
            record.final_result = captured
              ? attachWriteScopeVerification(
                  attachDispatchProvenance(captured, probed.final_result, record),
                  probed.final_result
                )
              : buildMissingResultEnvelopeWithStructuredRoleResult(
                  BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
                  "probe_terminal_without_final_result",
                  { status: record.status }
                );
          }
          record.updated_at = new Date(clock()).toISOString();
        }
      } catch (error) {
        record.status = "failed";
        record.terminal = true;
        record.exit = {
          code: null,
          signal: null,
          error: error?.message ?? String(error)
        };
        record.final_result = buildMissingResultEnvelopeWithStructuredRoleResult(
          BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_PROBE_FAILED,
          "probe_threw_before_terminal_capture",
          { message: error?.message ?? String(error) }
        );
        record.updated_at = new Date(clock()).toISOString();
      }
    }

    const reviewResult = deriveBackendReviewResult(record);
    return {
      schema_version: WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
      accepted: true,
      run_id: record.run_id,
      monitor_handle: record.monitor_handle,
      app: record.app,
      role: record.role,
      subject: record.subject,
      workspace_alias: record.workspace_alias,
      caller_session_id: record.caller_session_id,
      status: record.status,
      terminal: record.terminal,
      started_at: record.started_at,
      updated_at: record.updated_at,
      exit: record.exit ?? null,
      final_result: record.final_result ?? null,
      ...(reviewResult ? { review_result: reviewResult } : {})
    };
  }

  async function waitForRunStatus(input = {}) {
    const {
      caller_session_id = null,
      monitor_handle = null,
      subject = null,
      timeout_ms = 60000,
      poll_interval_ms = 5000
    } = input;

    const deadline = monotonicNow() + timeout_ms;

    for (;;) {
      const status = await getRunStatus({
        caller_session_id,
        monitor_handle,
        run_id: null,
        subject
      });

      if (!status || status.accepted !== true) {
        return status;
      }

      if (status.terminal) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: false,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app,
          role: status.role,
          subject: status.subject,
          workspace_alias: status.workspace_alias,
          caller_session_id: status.caller_session_id,
          status: status.status,
          terminal: true,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: status.exit ?? null,
          final_result: status.final_result ?? null,

          ...(status.review_result ? { review_result: status.review_result } : {})
        };
      }

      const remaining = deadline - monotonicNow();
      if (remaining <= 0) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
          accepted: true,
          timed_out: true,
          run_id: status.run_id,
          monitor_handle: status.monitor_handle,
          app: status.app,
          role: status.role,
          subject: status.subject,
          workspace_alias: status.workspace_alias,
          caller_session_id: status.caller_session_id,
          status: status.status,
          terminal: false,
          started_at: status.started_at,
          updated_at: status.updated_at,
          exit: null
        };
      }

      await sleep(Math.min(poll_interval_ms, remaining));
    }
  }

  function planLaunch(input = {}) {
    const {
      role = null,
      subject = null,
      app: requestedApp = null,
      model: requestedModel = null,
      workspace_dir = null
    } = input;

    const planRefusal = (reason, detail) => Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: false,
      role: typeof role === "string" ? role : null,
      app: typeof requestedApp === "string" ? requestedApp : null,
      subject: typeof subject === "string" ? subject : null,
      model: null,
      workspace_dir: workspace_dir ?? null,
      executor_available: false,
      refusal: Object.freeze({ reason, detail: detail ?? null })
    });

    const dispatchModel = normalizeDispatchModelHint(requestedModel);

    if (dispatchModel !== null) {
      for (const token of HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS) {
        if (dispatchModel.includes(token)) {
          return planRefusal("forbidden_token_in_model_hint", { token });
        }
      }
    }

    const selection = resolveDispatchSelection({
      role,
      app: requestedApp,
      model: dispatchModel,
      workspaceDir: workspace_dir
    });
    if (!selection.ok) {
      return planRefusal(selection.reason, selection.detail ?? null);
    }
    const { app, model: resolvedModel, backend: resolvedBackend } = selection;

    if (!validateLauncherFamilyRole(role).ok) {
      return planRefusal("unsupported_role", { role });
    }

    if (!subject || typeof subject !== "string") {
      return planRefusal("subject_required", null);
    }

    const executor_available = typeof executors[app] === "function";

    return Object.freeze({
      schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
      dry_run: true,
      accepted: true,
      role,
      app,
      backend: resolvedBackend,
      subject,
      model: resolvedModel,
      workspace_dir: workspace_dir ?? null,
      executor_available,
      refusal: null
    });
  }

  function snapshotRuns() {
    return [...runs.values()].map((r) => ({
      run_id: r.run_id,
      monitor_handle: r.monitor_handle,
      app: r.app,
      role: r.role,
      subject: r.subject,
      status: r.status,
      terminal: r.terminal,
      caller_session_id: r.caller_session_id
    }));
  }

  return { startLaunch, getRunStatus, waitForRunStatus, planLaunch, snapshotRuns };
}
