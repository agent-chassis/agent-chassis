

import {
  classifyConfigReadiness,
  classifyValidation,
  executeWorkerAdmissionDomainPackValidation,
  resolveClientConfig,
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";
import {
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
  createWorkRecordAdmissionDerivedEvidence,
  createWorkerAdmissionDomainPackInput,
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import { parseArgs } from "./cli.mjs";
import {
  GENERIC_VALIDATION_BODY,
  TimeoutMsUsageError,
  isRatifiedPackRoute,
  parseTimeoutMs,
  printJson,
  timedFetch,
} from "../commands/node-engine.mjs";
import {
  CONTROL_MATRIX_ENFORCEMENT_SPECS,
  buildControlMatrixDiagnostic,
  evaluateControlMatrixRow,
  projectControlMatrixRowPackInput,
  renderControlMatrixText,
  withInvalidApiKey,
  withoutRequestContractDigest,
} from "./node-engine-control-matrix-specs.mjs";

export {
  CONTROL_MATRIX_ENFORCEMENT_SPECS,
  buildControlMatrixDiagnostic,
  evaluateControlMatrixRow,
  projectControlMatrixRowPackInput,
};

const CONTROL_MATRIX_GENERATED_AT = "2026-06-06T00:00:00.000Z";

const CONTROL_MATRIX_RECORD_ID = "WK-0000";

const CONTROL_MATRIX_HELP_TEXT = `Usage: wiki node-engine worker-admission-control-matrix [--json] [--route <path>] [--timeout-ms <n>]

Run the full current worker_admission_v1 enforcement matrix against the deployed
Node Engine service and fail non-zero on any effect or reason mismatch. Reads
configuration from the environment (load a .env file into the process environment
first):

  NODE_ENGINE_SERVICE_URL                            Bare service origin (preferred).
  NODE_ENGINE_API_KEY                                Plaintext consumer API key, sent as X-API-Key (preferred).
  NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST
                                                     worker_admission_v1 request contract digest,
                                                     operator-bound from current Node Engine authority (preferred).

The concrete pack route is supplied from current Node Engine authority via --route
(e.g. --route /v1/validate); it is never inferred. X-API-Key only: no Authorization
bearer auth, never /mcp. A missing service URL/key or an unratified route makes the
matrix non-runnable and exits non-zero (it cannot verify enforcement).

Rows (each asserts deployed WK-0364 semantics):
  - clean bounded unit                  -> admit, no reasons
  - missing bounded edit budget         -> needs_review, review_threshold_exceeded (field/threshold)
  - bounded edit budget > 200           -> needs_review, review_threshold_exceeded (field/threshold)
  - deny total-LOC threshold            -> reject, reject_threshold_exceeded (field/threshold)
  - deny write-scope-count threshold    -> reject, reject_threshold_exceeded (field/threshold)
  - deny max-write-file threshold       -> reject, reject_threshold_exceeded (field/threshold)
  - missing work_unit_metrics object    -> reject, work_unit_metrics_missing
  - malformed recognized metric         -> reject, work_unit_metric_malformed
  - local_hard_refusal                  -> reject, local_hard_refusal
  - generic validation success          -> non-authority (transport-only, never a pack admit)
  - invalid API key                     -> auth rejection (request sent)
  - missing request-contract digest     -> fail closed, no request
  - unratified route                    -> fail closed, no request

This command is structural-only and non-authority. Exit code is 0 only when every
positive and negative row matches its expectation.

Options:
  --json              Emit the matrix diagnostic as JSON.
  --route <path>      Current Node Engine authority pack route (must start with /).
  --timeout-ms <n>    Abort each request after n milliseconds (default 5000).
  --help              Show this help text.`;

function controlMatrixBaseRecord() {
  return {
    schema_version: "work-record.v1",
    id: CONTROL_MATRIX_RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    title: "worker_admission_v1 live enforcement matrix verification fixture",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-06-06",
    updated: "2026-06-06",
    initiative: "IN-0013",
    area: "wiki-mcp",
    docs: ["docs/work-record-schema/worker-admission-envelope.md"],
    repo_paths: ["packages/wiki-core/src/lib/work-record-admission.mjs"],
    write_scope: ["packages/wiki-core/src/lib/work-record-admission.mjs"],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false,
    },
    acceptance: {
      criteria: ["verify deployed worker_admission_v1 controls"],
      validation: ["node --test tests/wiki-cli-node-engine-control-matrix.test.mjs"],
    },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null,
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    derived_evidence: [],
  };
}

function controlMatrixBaseBreadthInputs() {
  const profile = {
    profile_id: "worker-admission.work_unit_atomicity.default",
    profile_version: "v1",
    thresholds: {
      review_when_write_scope_count_above: 1,
      review_when_write_scope_total_loc_above: 200,
      review_when_max_write_file_loc_above: 600,
      review_when_acceptance_criteria_count_above: 10,
      review_when_validation_command_count_above: 2,
      review_when_declared_runtime_mode_count_above: 1,
      review_when_artifact_kind_count_above: 1,
      review_when_expected_changed_line_budget_above: 200,
      deny_when_write_scope_count_above: 4,
      deny_when_write_scope_total_loc_above: 1200,
      deny_when_max_write_file_loc_above: 1200,
    },
  };
  return {
    work_unit_metrics: {
      write_scope_count: 1,
      write_scope_existing_file_count: 1,
      write_scope_directory_count: 0,
      write_scope_total_loc: 654,
      max_write_file_loc: 654,
      acceptance_criteria_count: 1,
      validation_command_count: 1,
      declared_runtime_mode_count: 1,
      artifact_kind_count: 1,
      expected_changed_line_budget: 160,
      unknown_metric_count: 0,
    },
    file_stats: [
      {
        path: "packages/wiki-core/src/lib/work-record-admission-work-unit.mjs",
        loc: 654,
        existing_file: true,
        is_directory: false,
      },
    ],
    validation_command_metadata: [
      { kind: "validation_command", form: "shell", command: "npm test -- tests/wiki-cli-node-engine-control-matrix.test.mjs" },
    ],
    runtime_mode_metadata: [{ mode: "local" }],
    artifact_kind_metadata: [{ kind: "test" }],
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_record_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
    },
    policy_profile: profile,
  };
}

export function assembleControlMatrixBasePackInput() {
  const record = controlMatrixBaseRecord();
  const derivedEvidence = createWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,
    generated_at: CONTROL_MATRIX_GENERATED_AT,
    dispatch_readiness: {
      record_id: record.id,
      unit: { kind: "work_item", address: record.id, record_id: record.id, slice_id: null },
    },
    ...controlMatrixBaseBreadthInputs(),
  });
  return createWorkerAdmissionDomainPackInput({ derived_evidence: derivedEvidence });
}

export async function runNodeEngineWorkerAdmissionControlMatrix(argv, deps = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(CONTROL_MATRIX_HELP_TEXT);
    return { diagnostic: null, exitCode: 0 };
  }

  const env = deps.env ?? process.env;
  const baseFetch = deps.fetchImpl ?? globalThis.fetch;
  const route =
    typeof options.route === "string" && options.route.trim() !== ""
      ? options.route.trim()
      : typeof deps.route === "string" && deps.route.trim() !== ""
        ? deps.route.trim()
        : null;

  const config = resolveClientConfig(env);

  const emit = (diagnostic, exitCode) => {
    if (options.json) {
      printJson(diagnostic);
    } else {
      renderControlMatrixText(diagnostic);
    }
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return { diagnostic, exitCode };
  };

  let timeoutMs;
  try {
    timeoutMs = parseTimeoutMs(options);
  } catch (err) {
    if (err instanceof TimeoutMsUsageError) {
      return emit(
        buildControlMatrixDiagnostic({ config, rows: [], runnable: false, not_runnable_reason: "timeout_ms_invalid" }),
        1,
      );
    }
    throw err;
  }
  const fetchImpl = timedFetch(timeoutMs, baseFetch);

  const readiness = classifyConfigReadiness(config);
  if (!readiness.ready || !isRatifiedPackRoute(route)) {
    const reason = !readiness.ready ? readiness.outcome : "route_unratified";
    return emit(buildControlMatrixDiagnostic({ config, rows: [], runnable: false, not_runnable_reason: reason }), 1);
  }

  const basePackInput = deps.basePackInput ?? assembleControlMatrixBasePackInput();
  const rows = [];

  for (const spec of CONTROL_MATRIX_ENFORCEMENT_SPECS) {
    const packInput = projectControlMatrixRowPackInput(basePackInput, spec);
    const outcome = await executeWorkerAdmissionDomainPackValidation({ config, packInput, route }, fetchImpl);
    rows.push(evaluateControlMatrixRow(spec.name, spec.expected, outcome));
  }

  {
    const outcome = await classifyValidation({ config, body: GENERIC_VALIDATION_BODY }, fetchImpl);
    rows.push(
      evaluateControlMatrixRow(
        "generic-validation-success-non-authority",
        { outcome: "structural_success", effect: null, non_authority: true },
        outcome,
      ),
    );
  }

  {
    const outcome = await executeWorkerAdmissionDomainPackValidation(
      { config: withInvalidApiKey(config), packInput: basePackInput, route },
      fetchImpl,
    );
    rows.push(
      evaluateControlMatrixRow(
        "invalid-api-key-auth-rejection",
        { outcome: "auth_rejected", effect: null, request_sent: true },
        outcome,
      ),
    );
  }

  {
    const outcome = await executeWorkerAdmissionDomainPackValidation(
      { config: withoutRequestContractDigest(config), packInput: basePackInput, route, requestContractDigest: null },
      fetchImpl,
    );
    rows.push(
      evaluateControlMatrixRow(
        "missing-request-contract-digest-fail-closed",
        { outcome: "request_contract_digest_missing", effect: null, request_sent: false },
        outcome,
      ),
    );
  }

  {
    const outcome = await executeWorkerAdmissionDomainPackValidation(
      { config, packInput: basePackInput, route: NODE_ENGINE_UNRATIFIED_PLACEHOLDER },
      fetchImpl,
    );
    rows.push(
      evaluateControlMatrixRow(
        "unratified-route-fail-closed",
        { outcome: "route_unratified_placeholder", effect: null, request_sent: false },
        outcome,
      ),
    );
  }

  const diagnostic = buildControlMatrixDiagnostic({ config, rows, runnable: true });
  const exitCode = diagnostic.summary.all_pass ? 0 : 1;
  return emit(diagnostic, exitCode);
}
