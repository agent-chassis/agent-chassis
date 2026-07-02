

import {
  WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
} from "./work-record-admission-derived-evidence.mjs";
import { buildNodeEngineWorkerAdmissionValidateBody } from "./node-engine-worker-admission-wire.mjs";
import { summarizeWorkerAdmissionRecovery } from "./node-engine-worker-admission-recovery.mjs";

export {
  NODE_ENGINE_WORKER_ADMISSION_PACK_INPUT_SCHEMA_VERSION,
  buildNodeEngineWorkerAdmissionPackInput,
  buildNodeEngineWorkerAdmissionValidateBody,
} from "./node-engine-worker-admission-wire.mjs";

export const SERVICE_URL_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_SERVICE_URL",

  "NODE_ENGINE_API_URL",
  "NODE_ENGINE_API_BASE_URL",
]);

export const API_KEY_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_API_KEY",

  "NODE_ENGINE_LICENSE_KEY",
]);

export const REQUEST_CONTRACT_DIGEST_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST",

  "NODE_ENGINE_REQUEST_CONTRACT_DIGEST",
]);

export const WORKER_ADMISSION_ROUTE_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_WORKER_ADMISSION_ROUTE",
]);

export const WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_WORKER_ADMISSION_AUTHORITY_BINDING",
]);

export const NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS =
  "node_engine_worker_admission_authority_bound.v1";

export const VALIDATE_PATH = "/v1/validate";
export const API_KEY_HEADER = "x-api-key";
export const FORBIDDEN_PATH = "/mcp";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstConfigured(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim() !== "") {
      return { source: key, preferred: key === keys[0], value: value.trim() };
    }
  }
  return null;
}

export function redactSecret(value) {
  const text = String(value ?? "");
  return `<redacted:${text.length}>`;
}

export function resolveClientConfig(env = process.env) {
  const serviceUrl = firstConfigured(env, SERVICE_URL_ENV_KEYS);
  const apiKey = firstConfigured(env, API_KEY_ENV_KEYS);
  const requestContractDigest = firstConfigured(env, REQUEST_CONTRACT_DIGEST_ENV_KEYS);

  const workerAdmissionRoute = firstConfigured(env, WORKER_ADMISSION_ROUTE_ENV_KEYS);

  const workerAdmissionAuthorityBinding = firstConfigured(env, WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS);

  return {
    serviceUrl,
    apiKey,

    requestContractDigest,
    workerAdmissionRoute,

    workerAdmissionAuthorityBinding,
    sources: {
      service_url_source: serviceUrl?.source ?? null,
      service_url_preferred: serviceUrl ? serviceUrl.preferred : null,
      key_source: apiKey?.source ?? null,
      key_preferred: apiKey ? apiKey.preferred : null,
      request_contract_digest_source: requestContractDigest?.source ?? null,
      request_contract_digest_preferred: requestContractDigest ? requestContractDigest.preferred : null,
      worker_admission_route_source: workerAdmissionRoute?.source ?? null,
      worker_admission_route_present: Boolean(workerAdmissionRoute),
      worker_admission_authority_binding_source: workerAdmissionAuthorityBinding?.source ?? null,
      worker_admission_authority_binding_present: Boolean(workerAdmissionAuthorityBinding),
      request_header: API_KEY_HEADER,
      target_route: VALIDATE_PATH,
      default_portfolio_bearer_auth: "none",
    },
  };
}

export function resolveWorkerAdmissionRoute({ config = null, route = null } = {}) {
  const explicit =
    typeof route === "string" && route.trim() !== ""
      ? { source: "caller_binding", value: route.trim() }
      : null;
  const fromConfig =
    config?.workerAdmissionRoute && typeof config.workerAdmissionRoute.value === "string"
      ? { source: config.workerAdmissionRoute.source, value: config.workerAdmissionRoute.value.trim() }
      : null;
  const resolved = explicit ?? fromConfig;
  if (
    !resolved ||
    resolved.value === "" ||
    resolved.value === NODE_ENGINE_UNRATIFIED_PLACEHOLDER ||
    !resolved.value.startsWith("/")
  ) {
    return { present: false, source: resolved?.source ?? null, value: null };
  }
  return { present: true, source: resolved.source, value: resolved.value };
}

export function resolveWorkerAdmissionAuthorityBinding({ config = null, authorityBinding = null } = {}) {
  const explicit =
    typeof authorityBinding === "string" && authorityBinding.trim() !== ""
      ? { source: "caller_binding", value: authorityBinding.trim() }
      : null;
  const fromConfig =
    config?.workerAdmissionAuthorityBinding && typeof config.workerAdmissionAuthorityBinding.value === "string"
      ? { source: config.workerAdmissionAuthorityBinding.source, value: config.workerAdmissionAuthorityBinding.value.trim() }
      : null;
  const resolved = explicit ?? fromConfig;
  if (!resolved || resolved.value === "" || resolved.value === NODE_ENGINE_UNRATIFIED_PLACEHOLDER) {
    return { present: false, source: resolved?.source ?? null };
  }
  return { present: true, source: resolved.source };
}

function joinValidateUrl(serviceUrl) {
  const base = String(serviceUrl ?? "").trim();
  if (base === "") {
    throw new Error("node_engine_api_client.service_url_unconfigured.v1");
  }
  return `${base.replace(/\/+$/, "")}${VALIDATE_PATH}`;
}

export function buildValidateRequest({ serviceUrl, apiKey, body }) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("node_engine_api_client.api_key_unconfigured.v1");
  }

  return {
    url: joinValidateUrl(serviceUrl),
    method: "POST",
    headers: {
      "content-type": "application/json",
      [API_KEY_HEADER]: apiKey,
    },
    body: JSON.stringify(body ?? {}),
  };
}

function summarizeResponseBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "non-object", keys: [] };
  }
  return { kind: "object", keys: Object.keys(body).sort().slice(0, 12) };
}

export async function runGenericValidation(
  { serviceUrl, apiKey, body },
  fetchImpl = globalThis.fetch,
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("node_engine_api_client.fetch_unavailable.v1");
  }

  const request = buildValidateRequest({ serviceUrl, apiKey, body });
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  const rawBody = await response.text();
  const trimmed = rawBody.trim();
  let parsed = null;
  let jsonParsed = false;
  if (trimmed !== "") {
    try {
      parsed = JSON.parse(trimmed);
      jsonParsed = true;
    } catch {
      jsonParsed = false;
    }
  }

  return {
    status: response.status,
    ok: response.ok === true || (response.status >= 200 && response.status < 300),
    contentType: response.headers?.get?.("content-type") ?? null,
    jsonParsed,
    bodySummary: jsonParsed ? summarizeResponseBody(parsed) : { kind: "non-json", length: trimmed.length },
    redactedKey: redactSecret(apiKey),
  };
}

export const CLIENT_REASON_CODES = Object.freeze({
  SERVICE_URL_UNCONFIGURED: "node_engine_api_client.service_url_unconfigured.v1",
  API_KEY_UNCONFIGURED: "node_engine_api_client.api_key_unconfigured.v1",
  STRUCTURAL_SUCCESS: "node_engine_api_client.structural_success.v1",
  AUTH_REJECTED: "node_engine_api_client.auth_rejected.v1",
  INVALID_REQUEST: "node_engine_api_client.invalid_request.v1",
  PROBLEM_RESPONSE: "node_engine_api_client.problem_response.v1",
  NON_JSON_RESPONSE: "node_engine_api_client.non_json_response.v1",
  TIMEOUT_ABORT: "node_engine_api_client.timeout_abort.v1",
  TRANSPORT_FAILURE: "node_engine_api_client.transport_failure.v1",
});

export const CLIENT_DISPOSITIONS = Object.freeze({
  LOCAL_ONLY_FAIL_OPEN: "local_only_fail_open",
  STRUCTURAL_REMOTE: "structural_remote",
});

export function classifyHttpStatusClass(status) {
  if (typeof status !== "number" || !Number.isFinite(status)) return "unknown";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

function sourceContext(config) {
  return {
    service_url_source: config?.sources?.service_url_source ?? null,
    service_url_preferred: config?.sources?.service_url_preferred ?? null,
    key_source: config?.sources?.key_source ?? null,
    key_preferred: config?.sources?.key_preferred ?? null,
  };
}

export function classifyConfigReadiness(config = resolveClientConfig()) {
  if (!config?.serviceUrl) {
    return {
      ready: false,
      outcome: "service_url_unconfigured",
      reason_code: CLIENT_REASON_CODES.SERVICE_URL_UNCONFIGURED,
      disposition: CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
      node_engine_backed_success: false,
      authenticated_request_sent: false,
      ...sourceContext(config),
    };
  }
  if (!config?.apiKey) {
    return {
      ready: false,
      outcome: "api_key_unconfigured",
      reason_code: CLIENT_REASON_CODES.API_KEY_UNCONFIGURED,
      disposition: CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
      node_engine_backed_success: false,
      authenticated_request_sent: false,
      ...sourceContext(config),
    };
  }
  return { ready: true, ...sourceContext(config) };
}

export function classifyResponseOutcome(result, config = null) {
  const base = {
    disposition: CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,
    authenticated_request_sent: true,
    status_class: classifyHttpStatusClass(result?.status),
    content_type: result?.contentType ?? null,
    json_parsed: result?.jsonParsed === true,
    body_summary: result?.bodySummary ?? null,
    redacted_key: result?.redactedKey ?? null,
    ...sourceContext(config),
  };

  const status = result?.status;
  if (status === 401 || status === 403) {
    return { ...base, outcome: "auth_rejected", reason_code: CLIENT_REASON_CODES.AUTH_REJECTED, node_engine_backed_success: false };
  }
  if (status === 400) {
    return { ...base, outcome: "invalid_request", reason_code: CLIENT_REASON_CODES.INVALID_REQUEST, node_engine_backed_success: false };
  }
  if (result?.jsonParsed !== true) {
    return { ...base, outcome: "non_json", reason_code: CLIENT_REASON_CODES.NON_JSON_RESPONSE, node_engine_backed_success: false };
  }
  if (result?.ok !== true) {
    return { ...base, outcome: "problem", reason_code: CLIENT_REASON_CODES.PROBLEM_RESPONSE, node_engine_backed_success: false };
  }
  return { ...base, outcome: "structural_success", reason_code: CLIENT_REASON_CODES.STRUCTURAL_SUCCESS, node_engine_backed_success: true };
}

export function classifyTransportError(error, config = null) {
  const name =
    error && typeof error === "object" && typeof error.name === "string" ? error.name : typeof error;
  const isAbort = name === "AbortError";
  return {
    outcome: isAbort ? "timeout_abort" : "transport_failure",
    reason_code: isAbort ? CLIENT_REASON_CODES.TIMEOUT_ABORT : CLIENT_REASON_CODES.TRANSPORT_FAILURE,
    disposition: CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,
    authenticated_request_sent: true,
    node_engine_backed_success: false,
    error_name: name,
    ...sourceContext(config),
  };
}

export async function classifyValidation(
  { config = resolveClientConfig(), body } = {},
  fetchImpl = globalThis.fetch,
) {
  const readiness = classifyConfigReadiness(config);
  if (!readiness.ready) {
    return readiness;
  }

  try {
    const result = await runGenericValidation(
      { serviceUrl: config.serviceUrl.value, apiKey: config.apiKey.value, body },
      fetchImpl,
    );
    return classifyResponseOutcome(result, config);
  } catch (error) {
    return classifyTransportError(error, config);
  }
}

export const WORKER_ADMISSION_PACK_EFFECTS = Object.freeze(["admit", "needs_review", "reject"]);

export const PACK_CLIENT_REASON_CODES = Object.freeze({
  ROUTE_UNRATIFIED_PLACEHOLDER: "node_engine_api_client.worker_admission_pack.route_unratified_placeholder.v1",
  REQUEST_CONTRACT_DIGEST_MISSING: "node_engine_api_client.worker_admission_pack.request_contract_digest_missing.v1",
  PACK_BACKED_RESULT: "node_engine_api_client.worker_admission_pack.pack_backed_result.v1",
  AUTH_REJECTED: "node_engine_api_client.worker_admission_pack.auth_rejected.v1",
  ENTITLEMENT_REJECTED: "node_engine_api_client.worker_admission_pack.entitlement_rejected.v1",
  INVALID_REQUEST: "node_engine_api_client.worker_admission_pack.invalid_request.v1",
  PACK_INPUT_REQUIRED: "node_engine_api_client.worker_admission_pack.pack_input_required.v1",
  PACK_INPUT_INVALID: "node_engine_api_client.worker_admission_pack.pack_input_invalid.v1",
  NON_OBJECT_DATA: "node_engine_api_client.worker_admission_pack.non_object_data.v1",
  REQUEST_SCHEMA_DIGEST_MISMATCH: "node_engine_api_client.worker_admission_pack.request_schema_digest_mismatch.v1",
  PRECONDITION_GRAPH_TOO_LARGE: "node_engine_api_client.worker_admission_pack.precondition_graph_too_large.v1",
  PROBLEM_RESPONSE: "node_engine_api_client.worker_admission_pack.problem_response.v1",
  AVAILABILITY_FAILURE: "node_engine_api_client.worker_admission_pack.availability_failure.v1",
  NON_JSON_RESPONSE: "node_engine_api_client.worker_admission_pack.non_json_response.v1",
  MALFORMED_RESULT: "node_engine_api_client.worker_admission_pack.malformed_result.v1",
  TIMEOUT_ABORT: "node_engine_api_client.worker_admission_pack.timeout_abort.v1",
  TRANSPORT_FAILURE: "node_engine_api_client.worker_admission_pack.transport_failure.v1",
});

export const NODE_ENGINE_PACK_PROBLEM_TYPES = Object.freeze({
  PACK_NOT_AUTHORIZED: "/errors/pack-not-authorized",
  PACK_INPUT_REQUIRED: "/errors/pack-input-required",
  PACK_INPUT_INVALID: "/errors/pack-input-invalid",
  NON_OBJECT_DATA: "/errors/non-object-data",
  REQUEST_SCHEMA_DIGEST_MISMATCH: "/errors/request-schema-digest-mismatch",
  PRECONDITION_GRAPH_TOO_LARGE: "/errors/precondition_graph_too_large",
  INVALID_REQUEST: "/errors/invalid-request",
});

const RECOGNIZED_PACK_PROBLEM_TYPES = new Set(Object.values(NODE_ENGINE_PACK_PROBLEM_TYPES));

function recognizedProblemType(parsedBody) {
  const type = isPlainObject(parsedBody) && typeof parsedBody.type === "string" ? parsedBody.type : null;
  return type !== null && RECOGNIZED_PACK_PROBLEM_TYPES.has(type) ? type : null;
}

export const PACK_CLIENT_DISPOSITIONS = Object.freeze({
  LOCAL_ONLY_FAIL_OPEN: CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
  STRUCTURAL_REMOTE: CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,

  REMOTE_ENFORCEMENT_UNAVAILABLE: "remote_enforcement_unavailable_fail_closed",

  REMOTE_ENFORCEMENT_REQUEST_SCHEMA_DIGEST_MISMATCH:
    "remote_enforcement_request_schema_digest_mismatch_fail_closed",
});

function resolvePackRoute(route, packInput) {
  const candidate =
    typeof route === "string" && route.trim() !== ""
      ? route.trim()
      : typeof packInput?.http_route === "string"
        ? packInput.http_route.trim()
        : "";
  if (candidate === "" || candidate === NODE_ENGINE_UNRATIFIED_PLACEHOLDER || !candidate.startsWith("/")) {
    return { ratified: false, path: null };
  }
  return { ratified: true, path: candidate };
}

export function resolveRequestContractDigest({ config = null, requestContractDigest = null } = {}) {
  const explicit =
    typeof requestContractDigest === "string" && requestContractDigest.trim() !== ""
      ? { source: "caller_binding", value: requestContractDigest.trim() }
      : null;
  const fromConfig =
    config?.requestContractDigest && typeof config.requestContractDigest.value === "string"
      ? { source: config.requestContractDigest.source, value: config.requestContractDigest.value.trim() }
      : null;
  const resolved = explicit ?? fromConfig;
  if (!resolved || resolved.value === "" || resolved.value === NODE_ENGINE_UNRATIFIED_PLACEHOLDER) {
    return { present: false, source: resolved?.source ?? null, value: null };
  }
  return { present: true, source: resolved.source, value: resolved.value };
}

function packDigestContext(digest) {
  return {
    request_contract_digest_source: digest?.source ?? null,
    request_contract_digest_present: digest?.present === true,
  };
}

function packAuthorityBindingContext(authorityBinding) {
  return {
    worker_admission_authority_binding_source: authorityBinding?.source ?? null,
    worker_admission_authority_binding_present: authorityBinding?.present === true,
  };
}

function isSchemaValidProblemBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const hasText = typeof body.title === "string" || typeof body.detail === "string";
  const hasStatus = typeof body.status === "number" && Number.isFinite(body.status);
  return hasText && hasStatus;
}

function readPackResultEffect(body) {
  if (!isPlainObject(body)) return null;
  const bound = WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS;

  const packResult = isPlainObject(body.pack_result) ? body.pack_result : null;
  if (packResult && packResult.pack === bound.pack_id && packResult.operation === bound.operation_id) {
    const effect = typeof packResult.decision === "string" ? packResult.decision : packResult.effect ?? null;
    return WORKER_ADMISSION_PACK_EFFECTS.includes(effect) ? effect : null;
  }

  if (
    body.pack_id === bound.pack_id &&
    body.operation_id === bound.operation_id &&
    body.operation_version === bound.operation_version
  ) {
    const effect = body.pack_result?.effect ?? body.decision?.effect ?? body.effect ?? null;
    return WORKER_ADMISSION_PACK_EFFECTS.includes(effect) ? effect : null;
  }
  return null;
}

function recognizedPackResultObject(body) {
  if (!isPlainObject(body)) return null;
  const bound = WORKER_ADMISSION_DOMAIN_PACK_BOUND_IDENTIFIERS;
  const packResult = isPlainObject(body.pack_result) ? body.pack_result : null;
  if (!packResult) return null;

  if (packResult.pack === bound.pack_id && packResult.operation === bound.operation_id) {
    return packResult;
  }

  if (
    body.pack_id === bound.pack_id &&
    body.operation_id === bound.operation_id &&
    body.operation_version === bound.operation_version
  ) {
    return packResult;
  }
  return null;
}

const PACK_RESULT_REASON_SUMMARY_MAX = 16;
const PACK_RESULT_REASON_EVIDENCE_KEY_MAX = 24;
const PACK_RESULT_REASON_OBSERVED_STRING_MAX = 256;

function toReasonObservedScalar(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > PACK_RESULT_REASON_OBSERVED_STRING_MAX
      ? `${value.slice(0, PACK_RESULT_REASON_OBSERVED_STRING_MAX)}…`
      : value;
  }
  return undefined;
}

function summarizePackResultReason(reason) {
  if (!isPlainObject(reason)) return null;
  const summary = {};
  if (typeof reason.code === "string") summary.code = reason.code;
  if (typeof reason.field === "string") summary.field = reason.field;
  const observed = toReasonObservedScalar(reason.observed);
  if (observed !== undefined) summary.observed = observed;
  if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
    summary.threshold = reason.threshold;
  }
  if (isPlainObject(reason.evidence)) {
    summary.evidence_keys = Object.keys(reason.evidence).sort().slice(0, PACK_RESULT_REASON_EVIDENCE_KEY_MAX);
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function summarizePackResultReasons(body) {
  const packResult = recognizedPackResultObject(body);
  if (!packResult || !Array.isArray(packResult.reasons)) return [];
  return packResult.reasons
    .slice(0, PACK_RESULT_REASON_SUMMARY_MAX)
    .map(summarizePackResultReason)
    .filter(Boolean);
}

export function buildWorkerAdmissionDomainPackRequest({
  serviceUrl,
  apiKey,
  route,
  packInput,
  authorityMode = "pack_contract_bound",
  requestContractDigest = NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
  packInputOverride = null,
}) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(CLIENT_REASON_CODES.API_KEY_UNCONFIGURED);
  }
  const base = String(serviceUrl ?? "").trim();
  if (base === "") {
    throw new Error(CLIENT_REASON_CODES.SERVICE_URL_UNCONFIGURED);
  }
  if (typeof route !== "string" || !route.startsWith("/")) {
    throw new Error(PACK_CLIENT_REASON_CODES.ROUTE_UNRATIFIED_PLACEHOLDER);
  }
  const body = buildNodeEngineWorkerAdmissionValidateBody(packInput, {
    authorityMode,
    requestContractDigest,
    packInputOverride,
  });
  return {
    url: `${base.replace(/\/+$/, "")}${route}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      [API_KEY_HEADER]: apiKey,
    },
    body: JSON.stringify(body),
  };
}

async function readPackResponseStructural(response, apiKey) {
  const rawBody = typeof response.text === "function" ? await response.text() : "";
  const trimmed = String(rawBody ?? "").trim();
  let parsed = null;
  let jsonParsed = false;
  if (trimmed !== "") {
    try {
      parsed = JSON.parse(trimmed);
      jsonParsed = true;
    } catch {
      jsonParsed = false;
    }
  }
  return {
    status: response.status,
    ok: response.ok === true || (response.status >= 200 && response.status < 300),
    contentType: response.headers?.get?.("content-type") ?? null,
    jsonParsed,
    parsedBody: jsonParsed ? parsed : null,
    bodySummary: jsonParsed ? summarizeResponseBody(parsed) : { kind: "non-json", length: trimmed.length },
    redactedKey: redactSecret(apiKey),
  };
}

export function classifyWorkerAdmissionDomainPackResponse(
  result,
  config = null,
  { digest = null, authorityBinding = null, routeRatified = false } = {},
) {
  const problemType = recognizedProblemType(result?.parsedBody);
  const recovery = summarizeWorkerAdmissionRecovery(result?.parsedBody, recognizedPackResultObject);

  const bindingContractRatified =
    routeRatified === true && digest?.present === true && authorityBinding?.present === true;
  const base = {
    disposition: PACK_CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,
    authenticated_request_sent: true,
    pack_backed: false,
    effect: null,
    node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    node_engine_binding_ratified: false,
    status_class: classifyHttpStatusClass(result?.status),
    content_type: result?.contentType ?? null,
    json_parsed: result?.jsonParsed === true,
    body_summary: result?.bodySummary ?? null,

    problem_type: problemType,
    redacted_key: result?.redactedKey ?? null,
    node_engine_backed_success: false,
    ...packDigestContext(digest),
    ...packAuthorityBindingContext(authorityBinding),
    ...sourceContext(config),
  };
  if (recovery && recovery.projection_mode !== "route_problem_recovery") {
    base.recovery = recovery;
  }
  const routeProblemBase =
    recovery?.projection_mode === "route_problem_recovery" ? { ...base, recovery } : base;

  const status = result?.status;
  const R = PACK_CLIENT_REASON_CODES;
  const T = NODE_ENGINE_PACK_PROBLEM_TYPES;

  if (status === 402 || (status === 403 && problemType === T.PACK_NOT_AUTHORIZED)) {
    return { ...base, outcome: "entitlement_rejected", reason_code: R.ENTITLEMENT_REJECTED };
  }
  if (status === 401 || status === 403) {
    return { ...base, outcome: "auth_rejected", reason_code: R.AUTH_REJECTED };
  }
  if (status === 400) {

    if (problemType === T.NON_OBJECT_DATA) {
      return { ...routeProblemBase, outcome: "non_object_data", reason_code: R.NON_OBJECT_DATA };
    }
    if (problemType === T.PACK_INPUT_REQUIRED) {
      return { ...routeProblemBase, outcome: "pack_input_required", reason_code: R.PACK_INPUT_REQUIRED };
    }
    if (problemType === T.PACK_INPUT_INVALID) {
      return {
        ...routeProblemBase,
        outcome: "pack_input_invalid",
        reason_code: R.PACK_INPUT_INVALID,
        operator_legible_disposition:
          "Repair the org policy profile or re-run the digest-vector conformance test.",
      };
    }
    if (problemType === T.REQUEST_SCHEMA_DIGEST_MISMATCH) {
      return {
        ...routeProblemBase,
        outcome: "request_schema_digest_mismatch",
        reason_code: R.REQUEST_SCHEMA_DIGEST_MISMATCH,
        operator_legible_disposition:
          PACK_CLIENT_DISPOSITIONS.REMOTE_ENFORCEMENT_REQUEST_SCHEMA_DIGEST_MISMATCH,
      };
    }
    if (problemType === T.PRECONDITION_GRAPH_TOO_LARGE) {
      return {
        ...routeProblemBase,
        outcome: "precondition_graph_too_large",
        reason_code: R.PRECONDITION_GRAPH_TOO_LARGE,
      };
    }
    if (problemType === T.INVALID_REQUEST) {
      return { ...routeProblemBase, outcome: "invalid_request", reason_code: R.INVALID_REQUEST };
    }
    return { ...base, outcome: "invalid_request", reason_code: R.INVALID_REQUEST };
  }
  if (classifyHttpStatusClass(status) === "5xx") {

    if (result?.jsonParsed === true && isSchemaValidProblemBody(result?.parsedBody)) {
      return { ...base, outcome: "problem", reason_code: R.PROBLEM_RESPONSE };
    }
    return { ...base, outcome: "availability_failure", reason_code: R.AVAILABILITY_FAILURE };
  }
  if (result?.jsonParsed !== true) {
    return { ...base, outcome: "non_json", reason_code: R.NON_JSON_RESPONSE };
  }
  if (result?.ok !== true) {
    return { ...base, outcome: "problem", reason_code: R.PROBLEM_RESPONSE };
  }

  const effect = readPackResultEffect(result?.parsedBody);
  if (effect === null) {
    return { ...base, outcome: "malformed_result", reason_code: R.MALFORMED_RESULT };
  }
  return {
    ...base,
    outcome: "pack_backed_result",
    reason_code: R.PACK_BACKED_RESULT,
    pack_backed: true,
    effect,

    node_engine_binding_status: bindingContractRatified
      ? NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS
      : NODE_ENGINE_UNRATIFIED_PLACEHOLDER,

    node_engine_binding_ratified: bindingContractRatified,

    pack_result_reasons: summarizePackResultReasons(result?.parsedBody),
    node_engine_backed_success: true,
  };
}

export function classifyWorkerAdmissionDomainPackTransportError(error, config = null, { digest = null } = {}) {
  const name =
    error && typeof error === "object" && typeof error.name === "string" ? error.name : typeof error;
  const isAbort = name === "AbortError";
  return {
    outcome: isAbort ? "timeout_abort" : "transport_failure",
    reason_code: isAbort ? PACK_CLIENT_REASON_CODES.TIMEOUT_ABORT : PACK_CLIENT_REASON_CODES.TRANSPORT_FAILURE,
    disposition: PACK_CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,
    authenticated_request_sent: true,
    pack_backed: false,
    effect: null,
    node_engine_backed_success: false,

    node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    node_engine_binding_ratified: false,
    error_name: name,
    ...packDigestContext(digest),
    ...sourceContext(config),
  };
}

export async function executeWorkerAdmissionDomainPackValidation(
  {
    config = resolveClientConfig(),
    packInput,
    route,
    authorityMode = "pack_contract_bound",
    requestContractDigest = null,
    packInputOverride = null,

    authorityBinding = null,
  } = {},
  fetchImpl = globalThis.fetch,
) {
  const readiness = classifyConfigReadiness(config);
  if (!readiness.ready) {

    return {
      ...readiness,
      pack_backed: false,
      effect: null,
      node_engine_backed_success: false,
      node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
    };
  }

  const routeInfo = resolvePackRoute(route, packInput);
  if (!routeInfo.ratified) {

    return {
      outcome: "route_unratified_placeholder",
      reason_code: PACK_CLIENT_REASON_CODES.ROUTE_UNRATIFIED_PLACEHOLDER,
      disposition: PACK_CLIENT_DISPOSITIONS.REMOTE_ENFORCEMENT_UNAVAILABLE,
      authenticated_request_sent: false,
      pack_backed: false,
      effect: null,
      node_engine_backed_success: false,
      node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
      redacted_key: redactSecret(config.apiKey.value),
      ...sourceContext(config),
    };
  }

  const digest = resolveRequestContractDigest({ config, requestContractDigest });
  if (!digest.present) {
    return {
      outcome: "request_contract_digest_missing",
      reason_code: PACK_CLIENT_REASON_CODES.REQUEST_CONTRACT_DIGEST_MISSING,
      disposition: PACK_CLIENT_DISPOSITIONS.REMOTE_ENFORCEMENT_UNAVAILABLE,
      authenticated_request_sent: false,
      pack_backed: false,
      effect: null,
      node_engine_backed_success: false,
      node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
      redacted_key: redactSecret(config.apiKey.value),
      ...packDigestContext(digest),
      ...sourceContext(config),
    };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("node_engine_api_client.fetch_unavailable.v1");
  }

  try {
    const request = buildWorkerAdmissionDomainPackRequest({
      serviceUrl: config.serviceUrl.value,
      apiKey: config.apiKey.value,
      route: routeInfo.path,
      packInput,
      authorityMode,

      requestContractDigest: digest.value,
      packInputOverride,
    });
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (!response || typeof response.status !== "number") {

      return {
        outcome: "availability_failure",
        reason_code: PACK_CLIENT_REASON_CODES.AVAILABILITY_FAILURE,
        disposition: PACK_CLIENT_DISPOSITIONS.STRUCTURAL_REMOTE,
        authenticated_request_sent: true,
        pack_backed: false,
        effect: null,
        node_engine_backed_success: false,
        node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER,
        redacted_key: redactSecret(config.apiKey.value),
        ...packDigestContext(digest),
        ...sourceContext(config),
      };
    }
    const result = await readPackResponseStructural(response, config.apiKey.value);

    const resolvedAuthorityBinding = resolveWorkerAdmissionAuthorityBinding({ config, authorityBinding });
    return classifyWorkerAdmissionDomainPackResponse(result, config, {
      digest,
      authorityBinding: resolvedAuthorityBinding,
      routeRatified: true,
    });
  } catch (error) {
    return classifyWorkerAdmissionDomainPackTransportError(error, config, { digest });
  }
}
