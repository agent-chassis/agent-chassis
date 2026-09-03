

import { createHash } from "node:crypto";

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import {
  PUBLIC_SEMANTIC_CODE_RE,
  buildPublicMechanicalRefusal,
  isPlatformErrorCode,
  isPreservableSemanticIdentity,
  projectPublicBlockerCodeForIdentity
} from "../../lib/refusal-payload.mjs";
import { projectDiagnostic } from "../../lib/diagnostic-projection.mjs";

function copyErrorDetail(value) {
  if (Array.isArray(value)) return value.map((entry) => copyErrorDetail(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      copyErrorDetail(entry)
    ]));
  }
  return value;
}

export const CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION =
  "controlled-contract-internal-exception-diagnostic.v1";

function safeRead(value, key) {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function safeStringify(value) {
  const type = typeof value;
  if (type === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (type === "number" || type === "boolean" || type === "bigint") return String(value);
  if (type === "symbol") {
    try {
      return `Symbol(${safeRead(value, "description") ?? ""})`;
    } catch {
      return "Symbol()";
    }
  }
  if (type === "function") return "[function]";
  return `[${safeClassName(value)}]`;
}

function safeClassName(value) {
  const name = safeRead(value, "name");
  if (typeof name === "string" && name.length > 0) return name;
  const ctor = safeRead(value, "constructor");
  const ctorName = ctor === undefined || ctor === null ? undefined : safeRead(ctor, "name");
  if (typeof ctorName === "string" && ctorName.length > 0) return ctorName;
  return "Object";
}

function exceptionClassName(value) {
  if (value === null) return "null";
  const type = typeof value;
  if (type !== "object" && type !== "function") return type;
  if (value instanceof Error) return safeClassName(value);
  return type;
}

function exceptionSummary(value) {
  const projected = projectDiagnostic(value, {
    fieldPrefix: "controlled_contract.diagnostic"
  });
  return {
    summary: projected.value,
    redactions: projected.redactions,
    truncated: false
  };
}

export const CONTROLLED_CONTRACT_SEMANTIC_REASON_CODE_RE = PUBLIC_SEMANTIC_CODE_RE;

export const CONTROLLED_CONTRACT_GENERIC_REASON_CODE = "controlled_contract_operation_failed";
export const CONTROLLED_CONTRACT_GENERIC_REASON_CLOSED_CAUSES = Object.freeze([
  "unexpected_internal_exception"
]);

export const CONTROLLED_CONTRACT_PLATFORM_REASON_CODE = "controlled_contract_platform_failure";
export const CONTROLLED_CONTRACT_PARSE_REASON_CODE = "controlled_contract_document_parse_failed";
export const CONTROLLED_CONTRACT_INTERNAL_INVARIANT_CODE = "controlled_contract_internal_invariant";

const PLATFORM_CONDITION_BY_ERRNO = Object.freeze({
  ENOENT: "not_found",
  EACCES: "permission_denied",
  EPERM: "permission_denied",
  ENOSPC: "no_space",
  EDQUOT: "no_space",
  EISDIR: "is_a_directory",
  ENOTDIR: "not_a_directory",
  EMFILE: "too_many_open_files",
  ENFILE: "too_many_open_files",
  EROFS: "read_only_filesystem",
  EEXIST: "already_exists",
  EBUSY: "resource_busy",
  ELOOP: "symlink_loop",
  ENAMETOOLONG: "name_too_long",
  EAGAIN: "resource_unavailable",
  EIO: "io_failure",
  EPIPE: "broken_pipe",
  ETIMEDOUT: "timed_out",
  ECONNREFUSED: "connection_refused",
  ECONNRESET: "connection_reset",
  EXDEV: "cross_device_link"
});

export const CONTROLLED_CONTRACT_PLATFORM_CONDITIONS = Object.freeze([
  ...new Set(Object.values(PLATFORM_CONDITION_BY_ERRNO)),
  "module_unavailable",
  "other"
]);

const NODE_MODULE_UNAVAILABLE_CODES = new Set([
  "ERR_MODULE_NOT_FOUND",
  "MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_REQUIRE_ESM",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_UNSUPPORTED_ESM_URL_SCHEME"
]);

function platformConditionFor(code) {
  if (Object.hasOwn(PLATFORM_CONDITION_BY_ERRNO, code)) {
    return PLATFORM_CONDITION_BY_ERRNO[code];
  }
  if (NODE_MODULE_UNAVAILABLE_CODES.has(code)) return "module_unavailable";
  return "other";
}

function isPlatformFailureCode(code) {
  return isPlatformErrorCode(code) || NODE_MODULE_UNAVAILABLE_CODES.has(code);
}

export function classifyControlledContractFailure(error) {
  const boxed = Object(error ?? {});
  const rawCode = safeRead(boxed, "code");

  if (typeof rawCode === "string") {

    if (isPlatformFailureCode(rawCode)) {
      return {
        disposition: "platform",
        reason_code: CONTROLLED_CONTRACT_PLATFORM_REASON_CODE,
        platform_condition: platformConditionFor(rawCode)
      };
    }

    if (isPreservableSemanticIdentity(rawCode)) {
      return {
        disposition: "package_defined",
        reason_code: rawCode,
        platform_condition: null
      };
    }
    if (CONTROLLED_CONTRACT_SEMANTIC_REASON_CODE_RE.test(rawCode)) {

      return {
        disposition: "package_defined",
        reason_code: rawCode,
        platform_condition: null
      };
    }

    return {
      disposition: "internal_invariant",
      reason_code: CONTROLLED_CONTRACT_GENERIC_REASON_CODE,
      platform_condition: null
    };
  }

  if (error instanceof SyntaxError) {
    return {
      disposition: "parser",
      reason_code: CONTROLLED_CONTRACT_PARSE_REASON_CODE,
      platform_condition: null
    };
  }
  return {
    disposition: "internal_invariant",
    reason_code: CONTROLLED_CONTRACT_GENERIC_REASON_CODE,
    platform_condition: null
  };
}

function isUnexpectedInternalException(error) {
  return classifyControlledContractFailure(error).disposition === "internal_invariant";
}

function internalExceptionDiagnostic(error) {
  const { summary, redactions, truncated } = exceptionSummary(error);
  const cause = error instanceof Error ? safeRead(error, "cause") : undefined;
  const hasCause = cause !== undefined && cause !== null;
  const causeSummary = hasCause ? exceptionSummary(cause) : null;
  return {
    schema_version: CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION,
    unexpected_internal_exception: true,
    caller_correctable: false,
    exception_class: exceptionClassName(error),
    summary,
    summary_redactions: redactions,
    summary_truncated: truncated,
    cause_class: hasCause ? exceptionClassName(cause) : null,
    cause_summary: causeSummary === null ? null : causeSummary.summary,
    cause_summary_redactions: causeSummary === null ? [] : causeSummary.redactions,
    cause_summary_truncated: causeSummary === null ? false : causeSummary.truncated
  };
}

export const CONTROLLED_CONTRACT_INTERNAL_INVARIANT_SCHEMA_VERSION =
  "controlled-contract-internal-invariant.v1";

const CONTROLLED_CONTRACT_OWNING_BOUNDARY =
  "packages/wiki-core/src/operations/controlled-contract/refusal.mjs";

function correlationIdentity(parts) {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 16);
}

function internalInvariantLimb(error, operation, stage) {
  const diagnostic = internalExceptionDiagnostic(error);
  return {
    schema_version: CONTROLLED_CONTRACT_INTERNAL_INVARIANT_SCHEMA_VERSION,
    code: CONTROLLED_CONTRACT_INTERNAL_INVARIANT_CODE,
    operation,
    stage,
    owning_boundary: CONTROLLED_CONTRACT_OWNING_BOUNDARY,
    correlation_id: correlationIdentity([
      operation,
      stage,
      diagnostic.exception_class,
      diagnostic.summary
    ]),

    closed_cause: CONTROLLED_CONTRACT_GENERIC_REASON_CLOSED_CAUSES[0],
    caller_correctable: false,
    retryable: false,
    recovery: { state: "no_supported_route" }
  };
}

function platformFailureLimb(condition, operation, stage) {
  return {
    schema_version: "controlled-contract-platform-failure.v1",
    code: CONTROLLED_CONTRACT_PLATFORM_REASON_CODE,
    platform_condition: condition,
    operation,
    stage,
    owning_boundary: CONTROLLED_CONTRACT_OWNING_BOUNDARY,
    caller_correctable: false,
    recovery: { state: "no_supported_route" }
  };
}

function parseFailureLimb(error, operation, stage) {
  const diagnostic = internalExceptionDiagnostic(error);
  return {
    schema_version: "controlled-contract-parse-failure.v1",
    code: CONTROLLED_CONTRACT_PARSE_REASON_CODE,
    operation,
    stage,
    owning_boundary: CONTROLLED_CONTRACT_OWNING_BOUNDARY,

    exception_class: diagnostic.exception_class,
    summary: diagnostic.summary,
    summary_redactions: diagnostic.summary_redactions,
    summary_truncated: diagnostic.summary_truncated,
    caller_correctable: false,
    recovery: { state: "no_supported_route" }
  };
}

function refusalDetails(error, classification, operation, stage) {
  const rawDetails = safeRead(Object(error ?? {}), "details");
  const details = copyErrorDetail(rawDetails ?? {});

  if (classification.disposition === "package_defined") return details;
  if (classification.disposition === "platform") {
    return {
      ...details,
      platform_failure: platformFailureLimb(classification.platform_condition, operation, stage)
    };
  }
  if (classification.disposition === "parser") {
    return { ...details, parse_failure: parseFailureLimb(error, operation, stage) };
  }

  return {
    ...details,
    internal_exception: internalExceptionDiagnostic(error),
    internal_invariant: internalInvariantLimb(error, operation, stage)
  };
}

const PUBLIC_MECHANICAL_CODE_BY_DISPOSITION = Object.freeze({
  platform: "controlled_contract_platform_failure",
  parser: "controlled_contract_document_parse_failed",
  internal_invariant: "controlled_contract_internal_invariant"
});

function publicMechanicalCodeFor(classification) {
  const mapped = PUBLIC_MECHANICAL_CODE_BY_DISPOSITION[classification.disposition];
  if (mapped !== undefined) return mapped;

  return projectPublicBlockerCodeForIdentity(classification.reason_code);
}

function controlledContractDecidingFacts(classification, operation, stage) {
  const facts = [
    { field: "controlled_contract.operation_completed", value: false },
    { field: "controlled_contract.operation", value: operation },
    { field: "controlled_contract.stage", value: stage },
    { field: "controlled_contract.disposition", value: classification.disposition }
  ];
  if (classification.platform_condition !== null && classification.platform_condition !== undefined) {

    facts.push({
      field: "controlled_contract.platform_condition",
      value: classification.platform_condition
    });
  }
  if (classification.disposition === "package_defined") {
    facts.push({ field: "controlled_contract.package_reason_code", value: classification.reason_code });
  }
  return facts;
}

function controlledContractMechanicalRefusal(classification, operation, stage) {
  const code = publicMechanicalCodeFor(classification);
  if (code === null || code === undefined) return null;
  const decidingFacts = controlledContractDecidingFacts(classification, operation, stage);
  const observedFacts = Object.fromEntries(
    decidingFacts
      .filter((fact) => Object.hasOwn(fact, "value"))
      .map((fact) => [fact.field, fact.value])
  );

  return buildPublicMechanicalRefusal({
    code,
    deciding_facts: decidingFacts,
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    route: operation,
    observed_facts: observedFacts
  });
}

export function createControlledContractRefusal(
  error,
  { operation = "controlled_contract_operation", stage = "operation" } = {}
) {

  const classification = classifyControlledContractFailure(error);
  const reasonCode = classification.reason_code;
  const rawMessage = error instanceof Error ? safeRead(error, "message") : error;
  const refusal = new ControlledContractToolError(
    reasonCode,
    typeof rawMessage === "string" ? rawMessage : safeStringify(rawMessage),
    refusalDetails(error, classification, operation, stage)
  );
  const mechanicalRefusal = controlledContractMechanicalRefusal(classification, operation, stage);
  refusal.envelope = Object.freeze({
    schema_version: "controlled-contract-mcp-refusal.v1",
    ok: false,
    warning: Object.freeze({
      code: "controlled_contract_request_refused",
      severity: "blocking",
      message: `controlled-contract MCP request refused: ${reasonCode}`,
      payload: Object.freeze({
        schema_version: "controlled-contract-refusal-payload.v1",
        reason_code: reasonCode,
        details: refusalDetails(error, classification, operation, stage),

        ...(mechanicalRefusal === null ? {} : { refusal: mechanicalRefusal })
      })
    })
  });
  return refusal;
}

async function controlledContractOperation(callback) {
  try {
    return await callback();
  } catch (error) {
    throw createControlledContractRefusal(error);
  }
}

export { controlledContractOperation };
