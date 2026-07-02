

import {
  API_KEY_HEADER,
  classifyConfigReadiness,
  classifyValidation,
  executeWorkerAdmissionDomainPackValidation,
  resolveClientConfig,
  resolveRequestContractDigest,
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";
import {
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
  createWorkRecordAdmissionDerivedEvidence,
  createWorkerAdmissionDomainPackInput,
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import { parseArgs } from "./cli.mjs";
import {
  GENERIC_VALIDATION_BODY,
  isRatifiedPackRoute,
  parseTimeoutMs,
  printJson,
  timedFetch,
} from "../commands/node-engine.mjs";

const CONTROL_MATRIX_GENERATED_AT = "2026-06-06T00:00:00.000Z";

const CONTROL_MATRIX_RECORD_ID = "WK-0000";

const CONTROL_MATRIX_INVALID_API_KEY = "node-engine-control-matrix-invalid-api-key";

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

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

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

export const CONTROL_MATRIX_ENFORCEMENT_SPECS = Object.freeze([
  {
    name: "clean-bounded-unit",
    metrics: {
      write_scope_count: 1,
      write_scope_total_loc: 654,
      max_write_file_loc: 654,
      expected_changed_line_budget: 160,
    },
    expected: { outcome: "pack_backed_result", effect: "admit", reasons: [], exact_reasons: true },
  },
  {
    name: "missing-bounded-edit-budget",
    metrics: {
      write_scope_count: 1,
      write_scope_total_loc: 654,
      max_write_file_loc: 654,
      expected_changed_line_budget: null,
    },
    expected: {
      outcome: "pack_backed_result",
      effect: "needs_review",
      reasons: [{ code: "review_threshold_exceeded", field: "write_scope_total_loc", threshold: 200 }],
    },
  },
  {
    name: "bounded-edit-budget-over-threshold",
    metrics: {
      write_scope_count: 1,
      write_scope_total_loc: 654,
      max_write_file_loc: 654,
      expected_changed_line_budget: 240,
    },
    expected: {
      outcome: "pack_backed_result",
      effect: "needs_review",
      reasons: [{ code: "review_threshold_exceeded", field: "write_scope_total_loc", threshold: 200 }],
    },
  },
  {
    name: "deny-write-scope-total-loc-threshold",
    metrics: { write_scope_count: 4, write_scope_total_loc: 4200, max_write_file_loc: 1050 },
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "reject_threshold_exceeded", field: "write_scope_total_loc", threshold: 1200 }],
    },
  },
  {
    name: "deny-max-write-file-loc-threshold",
    metrics: { write_scope_count: 1, write_scope_total_loc: 500, max_write_file_loc: 1300 },
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "reject_threshold_exceeded", field: "max_write_file_loc", threshold: 1200 }],
    },
  },
  {
    name: "deny-write-scope-count-threshold",
    metrics: { write_scope_count: 9, write_scope_total_loc: 450, max_write_file_loc: 50 },
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "reject_threshold_exceeded", field: "write_scope_count", threshold: 4 }],
    },
  },
  {
    name: "missing-work-unit-metrics",

    metrics: null,
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "work_unit_metrics_missing", field: "work_unit_metrics" }],
    },
  },
  {
    name: "malformed-recognized-metric",

    metrics: { write_scope_total_loc: "not-a-number" },
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "work_unit_metric_malformed", field: "write_scope_total_loc" }],
    },
  },
  {
    name: "local-hard-refusal",

    metrics: { write_scope_count: 1, write_scope_total_loc: 80, max_write_file_loc: 80 },
    local_hard_refusal: {
      refused: true,
      reason_code: "pack_owned.hard_refusal.pre_dispatch_scope_violation.v1",
      reason: "Pack-owned pre-dispatch hard refusal: work unit scope violation flagged before dispatch.",
      raised_by: "worker-admission-local-check.v1",
      evidence: {},
    },
    expected: {
      outcome: "pack_backed_result",
      effect: "reject",
      reasons: [{ code: "local_hard_refusal", field: "local_hard_refusal" }],
    },
  },
]);

export function projectControlMatrixRowPackInput(basePackInput, spec) {
  const packInput = deepCloneJson(basePackInput);
  const facts = packInput.normalized_portfolio_facts;
  if (spec.metrics === null) {
    delete facts.work_unit_metrics;
  } else if (spec.metrics) {
    facts.work_unit_metrics = { ...(facts.work_unit_metrics ?? {}), ...spec.metrics };
    if (
      Object.prototype.hasOwnProperty.call(spec.metrics, "expected_changed_line_budget") &&
      spec.metrics.expected_changed_line_budget === null
    ) {
      delete facts.work_unit_metrics.expected_changed_line_budget;
    }
  }
  if (Array.isArray(spec.file_stats)) {
    facts.file_stats = deepCloneJson(spec.file_stats);
  }

  if (spec.local_hard_refusal) {
    facts.local_hard_refusal = deepCloneJson(spec.local_hard_refusal);
  } else {
    delete facts.local_hard_refusal;
  }
  return packInput;
}

function withInvalidApiKey(config) {
  return { ...config, apiKey: { ...config.apiKey, value: CONTROL_MATRIX_INVALID_API_KEY } };
}

function withoutRequestContractDigest(config) {
  return {
    ...config,
    requestContractDigest: null,
    sources: {
      ...config.sources,
      request_contract_digest_source: null,
      request_contract_digest_preferred: null,
    },
  };
}

function summarizeActualReasons(outcome) {
  if (!Array.isArray(outcome.pack_result_reasons)) return [];
  return outcome.pack_result_reasons.map((reason) => {
    const summary = {};
    if (typeof reason.code === "string") summary.code = reason.code;
    if (typeof reason.field === "string") summary.field = reason.field;
    if (reason.observed !== undefined) summary.observed = reason.observed;
    if (typeof reason.threshold === "number") summary.threshold = reason.threshold;
    if (Array.isArray(reason.evidence_keys)) summary.evidence_keys = reason.evidence_keys;
    return summary;
  });
}

export function evaluateControlMatrixRow(name, expected, outcome) {
  const actualReasons = summarizeActualReasons(outcome);
  const actual = {
    outcome: outcome.outcome ?? null,
    effect: outcome.effect ?? null,
    reason_codes: actualReasons.map((reason) => reason.code).filter((code) => typeof code === "string"),
    reasons: actualReasons,
  };
  const requestSent = outcome.authenticated_request_sent === true;
  const statusClass = "status_class" in outcome ? outcome.status_class : null;

  let pass = true;
  if (expected.outcome !== undefined && expected.outcome !== actual.outcome) pass = false;
  if (expected.effect !== undefined && expected.effect !== actual.effect) pass = false;
  if (expected.request_sent !== undefined && expected.request_sent !== requestSent) pass = false;
  if (Array.isArray(expected.reasons)) {
    for (const expectedReason of expected.reasons) {
      const match = actual.reasons.find(
        (reason) =>
          reason.code === expectedReason.code &&
          (expectedReason.field === undefined || reason.field === expectedReason.field) &&
          (expectedReason.threshold === undefined || reason.threshold === expectedReason.threshold),
      );
      if (!match) pass = false;
    }
    if (expected.exact_reasons === true && actual.reasons.length !== expected.reasons.length) {
      pass = false;
    }
  }

  return {
    name,
    expected: {
      outcome: expected.outcome ?? null,
      effect: expected.effect ?? null,
      reasons: Array.isArray(expected.reasons) ? expected.reasons : [],
      ...(expected.request_sent !== undefined ? { request_sent: expected.request_sent } : {}),
      ...(expected.non_authority === true ? { non_authority: true } : {}),
    },
    actual,
    request_sent: requestSent,
    status_class: statusClass,
    pass,
  };
}

export function buildControlMatrixDiagnostic({ config, rows, runnable, not_runnable_reason = null }) {
  const digest = resolveRequestContractDigest({ config });
  const passed = rows.filter((row) => row.pass).length;
  return {
    tool: "node-engine worker-admission-control-matrix",
    posture: "structural_only_non_authority",
    auth_mode: "x_api_key_only",
    request_header: API_KEY_HEADER,
    runnable: runnable === true,
    not_runnable_reason,
    sources: {
      service_url_source: config?.sources?.service_url_source ?? null,
      service_url_preferred: config?.sources?.service_url_preferred ?? null,
      key_source: config?.sources?.key_source ?? null,
      key_preferred: config?.sources?.key_preferred ?? null,
      request_contract_digest_source: config?.sources?.request_contract_digest_source ?? null,
      request_contract_digest_present: digest.present === true,
    },
    rows,
    summary: {
      total: rows.length,
      passed,
      failed: rows.length - passed,
      all_pass: rows.length > 0 && passed === rows.length,
    },
  };
}

function renderControlMatrixText(diagnostic) {
  console.log(`Node Engine worker-admission-control-matrix (${diagnostic.posture})`);
  console.log(`  runnable: ${diagnostic.runnable}${diagnostic.not_runnable_reason ? ` (${diagnostic.not_runnable_reason})` : ""}`);
  console.log(`  auth_mode: ${diagnostic.auth_mode} (header ${diagnostic.request_header})`);
  console.log(`  service_url_source: ${diagnostic.sources.service_url_source ?? "(none)"} (preferred: ${diagnostic.sources.service_url_preferred})`);
  console.log(`  key_source: ${diagnostic.sources.key_source ?? "(none)"} (preferred: ${diagnostic.sources.key_preferred})`);
  console.log(`  request_contract_digest_source: ${diagnostic.sources.request_contract_digest_source ?? "(none)"} (present: ${diagnostic.sources.request_contract_digest_present})`);
  for (const row of diagnostic.rows) {
    const expectedReasons = row.expected.reasons.map((reason) => reason.code).join(",") || "(none)";
    const actualReasons = row.actual.reason_codes.join(",") || "(none)";
    console.log(
      `  [${row.pass ? "PASS" : "FAIL"}] ${row.name}: expected ${row.expected.effect ?? row.expected.outcome ?? "(structural)"} {${expectedReasons}} ` +
        `actual ${row.actual.effect ?? row.actual.outcome ?? "(structural)"} {${actualReasons}} request_sent=${row.request_sent} status_class=${row.status_class ?? "(none)"}`,
    );
  }
  console.log(`  summary: ${diagnostic.summary.passed}/${diagnostic.summary.total} passed (all_pass: ${diagnostic.summary.all_pass})`);
}

export async function runNodeEngineWorkerAdmissionControlMatrix(argv, deps = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(CONTROL_MATRIX_HELP_TEXT);
    return { diagnostic: null, exitCode: 0 };
  }

  const env = deps.env ?? process.env;
  const baseFetch = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = parseTimeoutMs(options);
  const route =
    typeof options.route === "string" && options.route.trim() !== ""
      ? options.route.trim()
      : typeof deps.route === "string" && deps.route.trim() !== ""
        ? deps.route.trim()
        : null;

  const config = resolveClientConfig(env);
  const fetchImpl = timedFetch(timeoutMs, baseFetch);

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
