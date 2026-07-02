

import {
  API_KEY_HEADER,
  CLIENT_DISPOSITIONS,
  PACK_CLIENT_DISPOSITIONS,
  VALIDATE_PATH,
  REQUEST_CONTRACT_DIGEST_ENV_KEYS,
  classifyConfigReadiness,
  classifyTransportError,
  classifyValidation,
  executeWorkerAdmissionDomainPackValidation,
  redactSecret,
  resolveClientConfig,
  resolveRequestContractDigest,
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";
import {
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
  createWorkRecordAdmissionDerivedEvidence,
  createWorkerAdmissionDomainPackInput,
  systemUtcClock,
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import { createWorkRecordAdmissionRecordLocalInputs } from "@agent-chassis/wiki-core/src/lib/work-record-admission-record-inputs.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";
import { parseArgs } from "../lib/cli.mjs";
import { runNodeEngineWorkerAdmissionControlMatrix } from "../lib/node-engine-control-matrix.mjs";

export {
  CONTROL_MATRIX_ENFORCEMENT_SPECS,
  assembleControlMatrixBasePackInput,
  buildControlMatrixDiagnostic,
  evaluateControlMatrixRow,
  projectControlMatrixRowPackInput,
  runNodeEngineWorkerAdmissionControlMatrix,
} from "../lib/node-engine-control-matrix.mjs";

const HELP_TEXT = `Usage: wiki node-engine validate-smoke [--json] [--strict] [--timeout-ms <n>]

Verify Chassis Control Engine API-key wiring for a consumer repo. Reads configuration from
the environment (load a .env file into the process environment first):

  NODE_ENGINE_SERVICE_URL   Bare service origin (the client appends /v1/validate).
  NODE_ENGINE_API_KEY       Plaintext consumer API key (sent as X-API-Key).

Compatibility-only legacy aliases are resolved by the client; the preferred
names above always win. A raw key is never accepted or printed on the command
line.

Behavior:
  - Missing service URL or API key: deterministic local-only fail-open. No
    authenticated request is sent; exits 0 (use --strict to exit non-zero).
  - Configured: sends X-API-Key to POST /v1/validate (never bearer auth, never
    /mcp) and reports a structural outcome. A 2xx JSON structural success exits
    0; auth/invalid/problem/non-JSON/timeout/transport outcomes exit non-zero.

This command is structural-only and non-authority: it never claims worker
admission parity, migration conformance, or dispatch authorization.

Options:
  --json              Emit the structural diagnostic as JSON.
  --strict            Make a missing-config local-only fail-open exit non-zero.
  --timeout-ms <n>    Abort the request after n milliseconds (default 5000).
  --help              Show this help text.

Exit code: 0 for local-only fail-open (without --strict) and structural success;
non-zero for strict fail-open and every structural remote non-success outcome.

Subcommands:
  validate-smoke                Generic /v1/validate transport/auth wiring check.
  worker-admission-pack-smoke   worker_admission_v1 pack-backed client path
                                (distinct route; --help for details).
  worker-admission-control-matrix
                                Live worker_admission_v1 enforcement matrix; fails
                                non-zero on any effect/reason mismatch (--help).`;

export const GENERIC_VALIDATION_BODY = Object.freeze({
  data: { name: "agent-chassis" },
  rules: [
    {
      id: "name-required",
      description: "Name is required",
      check: "required",
      path: "name",
    },
  ],
});

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function parseTimeoutMs(options) {
  if (!("timeout-ms" in options) || options["timeout-ms"] === true) {
    return 5000;
  }
  const parsed = Number.parseInt(String(options["timeout-ms"]), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--timeout-ms requires a positive integer");
  }
  return parsed;
}

export function timedFetch(timeoutMs, fetchImpl) {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildSmokeDiagnostic(outcome, { strict = false } = {}) {
  const diagnostic = {
    tool: "node-engine validate-smoke",
    posture: "structural_only_non_authority",
    disposition: outcome.disposition ?? null,
    outcome: outcome.outcome ?? null,
    reason_code: outcome.reason_code ?? null,
    authenticated_request_sent: outcome.authenticated_request_sent === true,
    node_engine_backed_success: outcome.node_engine_backed_success === true,
    request_header: API_KEY_HEADER,
    target_route: VALIDATE_PATH,
    auth_mode: "x_api_key_only",
    sources: {
      service_url_source: outcome.service_url_source ?? null,
      service_url_preferred: outcome.service_url_preferred ?? null,
      key_source: outcome.key_source ?? null,
      key_preferred: outcome.key_preferred ?? null,
    },
  };

  if ("status_class" in outcome) diagnostic.status_class = outcome.status_class;
  if ("content_type" in outcome) diagnostic.content_type = outcome.content_type;
  if ("json_parsed" in outcome) diagnostic.json_parsed = outcome.json_parsed;
  if ("body_summary" in outcome) diagnostic.body_summary = outcome.body_summary;
  if ("redacted_key" in outcome) diagnostic.redacted_key = outcome.redacted_key;
  if ("error_name" in outcome) diagnostic.error_name = outcome.error_name;

  let exitCode;
  if (outcome.disposition === CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN) {
    exitCode = strict ? 1 : 0;
  } else if (outcome.node_engine_backed_success === true) {
    exitCode = 0;
  } else {
    exitCode = 1;
  }

  return { diagnostic, exitCode };
}

function renderText(diagnostic) {
  console.log(`Chassis Control Engine validate-smoke (${diagnostic.posture})`);
  console.log(`  disposition: ${diagnostic.disposition}`);
  console.log(`  outcome: ${diagnostic.outcome}`);
  console.log(`  reason_code: ${diagnostic.reason_code}`);
  console.log(`  authenticated_request_sent: ${diagnostic.authenticated_request_sent}`);
  console.log(`  node_engine_backed_success: ${diagnostic.node_engine_backed_success}`);
  console.log(`  auth_mode: ${diagnostic.auth_mode} (header ${diagnostic.request_header}, route ${diagnostic.target_route})`);
  console.log(`  service_url_source: ${diagnostic.sources.service_url_source ?? "(none)"} (preferred: ${diagnostic.sources.service_url_preferred})`);
  console.log(`  key_source: ${diagnostic.sources.key_source ?? "(none)"} (preferred: ${diagnostic.sources.key_preferred})`);
  if ("status_class" in diagnostic) {
    console.log(`  status_class: ${diagnostic.status_class}`);
  }
  if ("error_name" in diagnostic) {
    console.log(`  error_name: ${diagnostic.error_name}`);
  }
}

const PACK_HELP_TEXT = `Usage: wiki node-engine worker-admission-pack-smoke [--json] [--strict] [--route <path>] [--id <WK-ID>] [--unit <slice-id>] [--timeout-ms <n>]

Exercise the Chassis Control Engine worker_admission_v1 pack-backed worker-admission client
path (distinct from the generic validate-smoke). Reads configuration from the
environment (load a .env file into the process environment first):

  NODE_ENGINE_SERVICE_URL                            Bare service origin (preferred).
  NODE_ENGINE_API_KEY                                Plaintext consumer API key, sent as X-API-Key (preferred).
  NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST
                                                     worker_admission_v1 request contract digest,
                                                     operator-bound from current Chassis Control Engine authority (preferred).

Compatibility-only legacy aliases (NODE_ENGINE_API_URL/NODE_ENGINE_API_BASE_URL,
NODE_ENGINE_LICENSE_KEY, NODE_ENGINE_REQUEST_CONTRACT_DIGEST) are still resolved
by the client but are reported as non-preferred; the preferred names above win. A
raw key or digest value is never accepted on, or printed to, the command line.

The concrete pack route is NEVER inferred from the generic /v1/validate path. It
must be supplied from current Chassis Control Engine authority via --route; without a
ratified route a configured backend fails closed (no request is sent) and a
generic structural success can never be read as a worker-admission admit.

Gate order (each step fails closed with NO request unless every prior step
passes): config readiness (service URL + API key) -> route ratification ->
request-contract-digest presence -> packInput assembly -> outbound request.

Behavior:
  - Missing service URL or API key: deterministic local-only fail-open. No
    authenticated request is sent; exits 0 (use --strict to exit non-zero).
  - Configured but no ratified --route: fail closed, no request sent, exits
    non-zero (remote enforcement unavailable).
  - Configured + ratified route but no request-contract digest: fail closed, no
    request sent, exits non-zero. The deployed service would reject a placeholder
    digest, so the client never POSTs one.
  - Configured + route + digest but no assembled packInput (no --id/--unit
    resolving to a repo-local WK/slice unit): fail closed, no request sent, exits
    non-zero.
  - Configured + route + digest + a packInput assembled from --id/--unit: sends
    X-API-Key to the bound route (never bearer auth, never /mcp) with the shared
    Chassis Control Engine /v1/validate body (top-level data, pack, pack_input carrying the
    bound request_contract_digest). A genuine pack-backed result envelope exits 0;
    auth, entitlement, availability (timeout, no response, connection refused,
    DNS/TLS, 5xx), problem, non-JSON, and malformed (generic-success-only)
    outcomes fail closed and exit non-zero.

This command is structural-only and non-authority: it never claims worker
admission parity, migration conformance, worker_admission_v1 readiness, or
dispatch authorization.

Options:
  --json              Emit the structural diagnostic as JSON.
  --strict            Make a missing-config local-only fail-open exit non-zero.
  --route <path>      Current Chassis Control Engine authority pack route (must start with /).
  --id <WK-ID>        Repo-local work record to assemble the pack input from.
  --unit <slice-id>   Optional slice id under --id to scope the assembled unit.
  --timeout-ms <n>    Abort the request after n milliseconds (default 5000).
  --help              Show this help text.`;

export const PACK_INPUT_MISSING_REASON_CODE =
  "node_engine_cli.worker_admission_pack.pack_input_missing.v1";

export function buildPackSmokeDiagnostic(outcome, { strict = false } = {}) {
  const diagnostic = {
    tool: "node-engine worker-admission-pack-smoke",
    posture: "structural_only_non_authority",
    disposition: outcome.disposition ?? null,
    outcome: outcome.outcome ?? null,
    reason_code: outcome.reason_code ?? null,
    authenticated_request_sent: outcome.authenticated_request_sent === true,
    pack_backed: outcome.pack_backed === true,
    effect: outcome.effect ?? null,
    node_engine_backed_success: outcome.node_engine_backed_success === true,
    node_engine_binding_status: outcome.node_engine_binding_status ?? null,
    request_header: API_KEY_HEADER,
    auth_mode: "x_api_key_only",
    sources: {
      service_url_source: outcome.service_url_source ?? null,
      service_url_preferred: outcome.service_url_preferred ?? null,
      key_source: outcome.key_source ?? null,
      key_preferred: outcome.key_preferred ?? null,

      request_contract_digest_source: outcome.request_contract_digest_source ?? null,
      request_contract_digest_preferred:
        outcome.request_contract_digest_source
          ? outcome.request_contract_digest_source === REQUEST_CONTRACT_DIGEST_ENV_KEYS[0]
          : null,
      request_contract_digest_present: outcome.request_contract_digest_present === true,
    },
  };

  if ("status_class" in outcome) diagnostic.status_class = outcome.status_class;
  if ("content_type" in outcome) diagnostic.content_type = outcome.content_type;
  if ("json_parsed" in outcome) diagnostic.json_parsed = outcome.json_parsed;
  if ("body_summary" in outcome) diagnostic.body_summary = outcome.body_summary;
  if ("redacted_key" in outcome) diagnostic.redacted_key = outcome.redacted_key;
  if ("error_name" in outcome) diagnostic.error_name = outcome.error_name;

  let exitCode;
  if (outcome.disposition === CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN) {
    exitCode = strict ? 1 : 0;
  } else if (outcome.node_engine_backed_success === true) {
    exitCode = 0;
  } else {

    exitCode = 1;
  }

  return { diagnostic, exitCode };
}

function renderPackText(diagnostic) {
  console.log(`Chassis Control Engine worker-admission-pack-smoke (${diagnostic.posture})`);
  console.log(`  disposition: ${diagnostic.disposition}`);
  console.log(`  outcome: ${diagnostic.outcome}`);
  console.log(`  reason_code: ${diagnostic.reason_code}`);
  console.log(`  authenticated_request_sent: ${diagnostic.authenticated_request_sent}`);
  console.log(`  pack_backed: ${diagnostic.pack_backed}`);
  console.log(`  effect: ${diagnostic.effect ?? "(none)"}`);
  console.log(`  node_engine_backed_success: ${diagnostic.node_engine_backed_success}`);
  console.log(`  node_engine_binding_status: ${diagnostic.node_engine_binding_status}`);
  console.log(`  auth_mode: ${diagnostic.auth_mode} (header ${diagnostic.request_header})`);
  console.log(`  service_url_source: ${diagnostic.sources.service_url_source ?? "(none)"} (preferred: ${diagnostic.sources.service_url_preferred})`);
  console.log(`  key_source: ${diagnostic.sources.key_source ?? "(none)"} (preferred: ${diagnostic.sources.key_preferred})`);
  console.log(`  request_contract_digest_source: ${diagnostic.sources.request_contract_digest_source ?? "(none)"} (present: ${diagnostic.sources.request_contract_digest_present})`);
  if ("status_class" in diagnostic) {
    console.log(`  status_class: ${diagnostic.status_class}`);
  }
  if ("error_name" in diagnostic) {
    console.log(`  error_name: ${diagnostic.error_name}`);
  }
}

export async function assembleWorkerAdmissionPackInputForUnit({ dir = ".", id, unit = null } = {}) {
  const recordId = typeof id === "string" ? id.trim() : "";
  if (recordId === "") {
    return { ok: false, reason: "unit_unspecified" };
  }
  const sliceId = typeof unit === "string" && unit.trim() !== "" ? unit.trim() : null;

  const loaded = await loadWorkRecordById({ dir, id: recordId });
  if (!loaded || !loaded.record) {
    return { ok: false, reason: "record_not_found", diagnostics: loaded?.diagnostics ?? [] };
  }
  const record = loaded.record;

  let subject = record;
  let dispatchReadiness = {
    record_id: record.id,
    unit: { kind: "work_item", address: record.id, record_id: record.id, slice_id: null },
  };
  if (sliceId) {
    const slice = Array.isArray(record.slices)
      ? record.slices.find((entry) => entry && entry.id === sliceId)
      : null;
    if (!slice) {
      return { ok: false, reason: "slice_not_found" };
    }

    subject = { ...slice, id: record.id, kind: "slice", slice_id: slice.id };
    dispatchReadiness = {
      record_id: record.id,
      unit: { kind: "slice", address: `${record.id}#${slice.id}`, record_id: record.id, slice_id: slice.id },
    };
  }

  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({ dir, record: subject });
  const derivedEvidence = createWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,

    clock: systemUtcClock,
    work_unit_metrics: recordLocalInputs.work_unit_metrics,
    file_stats: recordLocalInputs.file_stats,
    validation_command_metadata: recordLocalInputs.validation_command_metadata,
    runtime_mode_metadata: recordLocalInputs.runtime_mode_metadata,
    artifact_kind_metadata: recordLocalInputs.artifact_kind_metadata,
    structural_target_metrics: recordLocalInputs.structural_target_metrics,
    metric_source_provenance: recordLocalInputs.metric_source_provenance,
    dispatch_readiness: dispatchReadiness,
  });
  const packInput = createWorkerAdmissionDomainPackInput({ derived_evidence: derivedEvidence });
  return { ok: true, packInput };
}

function buildPackInputMissingOutcome(config, digest) {
  return {
    outcome: "pack_input_missing",
    reason_code: PACK_INPUT_MISSING_REASON_CODE,
    disposition: PACK_CLIENT_DISPOSITIONS.REMOTE_ENFORCEMENT_UNAVAILABLE,
    authenticated_request_sent: false,
    pack_backed: false,
    effect: null,
    node_engine_backed_success: false,
    node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    redacted_key: redactSecret(config.apiKey.value),
    request_contract_digest_source: digest?.source ?? null,
    request_contract_digest_present: digest?.present === true,
    service_url_source: config.sources?.service_url_source ?? null,
    service_url_preferred: config.sources?.service_url_preferred ?? null,
    key_source: config.sources?.key_source ?? null,
    key_preferred: config.sources?.key_preferred ?? null,
  };
}

export function isRatifiedPackRoute(route) {
  if (typeof route !== "string") return false;
  const trimmed = route.trim();
  return trimmed !== "" && trimmed !== NODE_ENGINE_UNRATIFIED_PLACEHOLDER && trimmed.startsWith("/");
}

export async function runNodeEngineWorkerAdmissionPackSmoke(argv, deps = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(PACK_HELP_TEXT);
    return { diagnostic: null, exitCode: 0 };
  }

  const env = deps.env ?? process.env;
  const baseFetch = deps.fetchImpl ?? globalThis.fetch;
  const strict = options.strict === true;
  const timeoutMs = parseTimeoutMs(options);

  const dir =
    deps.dir ?? (typeof options.dir === "string" && options.dir.trim() !== "" ? options.dir.trim() : process.cwd());
  const id = typeof options.id === "string" && options.id.trim() !== "" ? options.id.trim() : null;
  const unit =
    typeof options.unit === "string" && options.unit.trim() !== ""
      ? options.unit.trim()
      : typeof options.slice === "string" && options.slice.trim() !== ""
        ? options.slice.trim()
        : null;

  const route =
    typeof options.route === "string" && options.route.trim() !== ""
      ? options.route.trim()
      : typeof deps.route === "string" && deps.route.trim() !== ""
        ? deps.route.trim()
        : null;

  const config = resolveClientConfig(env);

  const readiness = classifyConfigReadiness(config);
  const routeRatified = isRatifiedPackRoute(route);
  const digest = resolveRequestContractDigest({ config });

  let packInput = deps.packInput ?? null;
  let outcome = null;

  if (readiness.ready && routeRatified && digest.present) {
    if (!packInput && id) {
      const assembled = await assembleWorkerAdmissionPackInputForUnit({ dir, id, unit });
      if (assembled.ok) {
        packInput = assembled.packInput;
      }
    }
    if (!packInput) {

      outcome = buildPackInputMissingOutcome(config, digest);
    }
  }

  if (!outcome) {

    outcome = await executeWorkerAdmissionDomainPackValidation(
      { config, packInput, route },
      timedFetch(timeoutMs, baseFetch),
    );
  }

  const { diagnostic, exitCode } = buildPackSmokeDiagnostic(outcome, { strict });

  if (options.json) {
    printJson(diagnostic);
  } else {
    renderPackText(diagnostic);
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return { diagnostic, exitCode };
}

export async function runValidateSmoke(argv, deps = {}) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return { diagnostic: null, exitCode: 0 };
  }

  const env = deps.env ?? process.env;
  const baseFetch = deps.fetchImpl ?? globalThis.fetch;
  const strict = options.strict === true;
  const timeoutMs = parseTimeoutMs(options);

  const config = resolveClientConfig(env);

  let outcome;
  if (typeof baseFetch !== "function") {

    outcome = classifyTransportError(
      new Error("node_engine_api_client.fetch_unavailable.v1"),
      config,
    );
  } else {
    outcome = await classifyValidation(
      { config, body: GENERIC_VALIDATION_BODY },
      timedFetch(timeoutMs, baseFetch),
    );
  }

  const { diagnostic, exitCode } = buildSmokeDiagnostic(outcome, { strict });

  if (options.json) {
    printJson(diagnostic);
  } else {
    renderText(diagnostic);
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return { diagnostic, exitCode };
}

export async function runNodeEngine(argv, deps = {}) {
  const [subcommand, ...rest] = argv;

  if (subcommand === undefined) {
    console.log(HELP_TEXT);
    return;
  }

  switch (subcommand) {
    case "validate-smoke":
      await runValidateSmoke(rest, deps);
      return;
    case "worker-admission-pack-smoke":
      await runNodeEngineWorkerAdmissionPackSmoke(rest, deps);
      return;
    case "worker-admission-control-matrix":
      await runNodeEngineWorkerAdmissionControlMatrix(rest, deps);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP_TEXT);
      return;
    default:
      if (subcommand.startsWith("--")) {

        await runValidateSmoke(argv, deps);
        return;
      }
      throw new Error(`Unknown node-engine subcommand: ${subcommand}\n\n${HELP_TEXT}`);
  }
}
