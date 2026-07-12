

import {
  API_KEY_HEADER,
  resolveRequestContractDigest,
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

const CONTROL_MATRIX_INVALID_API_KEY = "node-engine-control-matrix-invalid-api-key";

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

export function withInvalidApiKey(config) {
  return { ...config, apiKey: { ...config.apiKey, value: CONTROL_MATRIX_INVALID_API_KEY } };
}

export function withoutRequestContractDigest(config) {
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

export function renderControlMatrixText(diagnostic) {
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
