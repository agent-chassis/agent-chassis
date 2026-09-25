

import path from "node:path";

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES as ISOLATION,
  BubblewrapIsolationError
} from "./launch-isolation-errors.mjs";
import { STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON } from "./stdio-mcp-conduit-contract.mjs";
import {
  WORKER_TEST_RUNTIME_PREPARATION_REFUSAL_CODE,
  WorkerTestRuntimePreparationError
} from "./test-execution/worker-runtime.mjs";

export const CONFINED_LAUNCH_PATH_UNPREPARED_CODE =
  "agent_launch.confined_launch.path_unprepared.v1";

const MODELED_PATH_CODES = Object.freeze(new Set([
  ISOLATION.PATH_NOT_FILE,
  ISOLATION.PATH_NOT_DIRECTORY,
  ISOLATION.PATH_MISSING_PARENT,
  ISOLATION.PATH_OUTSIDE_REPO,
  ISOLATION.PATH_NOT_ABSOLUTE,
  ISOLATION.PATH_HAS_GLOB,
  ISOLATION.PATH_HAS_TRAVERSAL
]));

export const BUBBLEWRAP_BACKEND_UNUSABLE_CODES = Object.freeze(new Set([
  ISOLATION.BWRAP_UNAVAILABLE,
  ISOLATION.BWRAP_NOT_EXECUTABLE,
  ISOLATION.BWRAP_PROBE_FAILED,
  ISOLATION.BWRAP_SPAWN_FAILED
]));

export const CONFINED_LAUNCH_FAILURE_UNCLASSIFIED_REASON = "confined_launch_failure_unclassified";

const SCOPE_MEMBER_ACCESS = Object.freeze(new Set(["readable", "writable"]));
const SCOPE_MEMBER_KINDS = Object.freeze(new Set(["files", "directories"]));
const ERRNO_RE = /^E[A-Z0-9]{1,31}$/u;
const TEXT_LIMIT = 512;
const PATH_LIMIT = 1024;
const CLEANUP_FAILURE_LIMIT = 8;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const HOST_PATH_RE = /(?<![\w.~-])(?:file:\/\/)?(?:\/[^\s'"`,:;()<>]+)+/gu;

function boundedText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(HOST_PATH_RE, "<host-path>");
  return text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT)}…`;
}

function boundedCode(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/u.test(value)
    ? value
    : null;
}

export function safeRepositoryRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > PATH_LIMIT) return null;
  if (value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value)) return null;
  if (path.posix.normalize(value) !== value || value === "." ||
      value.split("/").includes("..")) return null;
  return value;
}

function readScopeMember(value) {
  if (!isPlainObject(value)) return null;
  const pathValue = safeRepositoryRelativePath(value.path);
  const failedComponent = safeRepositoryRelativePath(value.failed_component);
  if (!SCOPE_MEMBER_ACCESS.has(value.access) || !SCOPE_MEMBER_KINDS.has(value.member_kind) ||
      !Number.isSafeInteger(value.index) || value.index < 0 || pathValue === null ||
      failedComponent === null) {
    return null;
  }
  return Object.freeze({
    access: value.access,
    member_kind: value.member_kind,
    index: value.index,
    path: pathValue,
    failed_component: failedComponent
  });
}

export function classifyLaunchPathFailure(err) {
  if (!(err instanceof BubblewrapIsolationError) || !MODELED_PATH_CODES.has(err.code)) {
    return null;
  }
  const detail = isPlainObject(err.detail) ? err.detail : {};
  const scopeMember = readScopeMember(detail.scope_member);
  return Object.freeze({
    isolation_code: err.code,
    errno: typeof detail.errno === "string" && ERRNO_RE.test(detail.errno) ? detail.errno : null,
    scope_member: scopeMember,
    path: scopeMember?.failed_component ?? null
  });
}

export function boundedCleanupFailure(error) {
  if (error === null || error === undefined) return null;
  const failures = Array.isArray(error?.detail?.failures) ? error.detail.failures : [];
  return Object.freeze({
    code: boundedCode(error?.code),
    message: boundedText(error?.message) ?? boundedText(String(error)),
    ...(failures.length === 0 ? {} : {
      failures: Object.freeze(failures.slice(0, CLEANUP_FAILURE_LIMIT).map((failure) =>
        Object.freeze({
          code: boundedCode(failure?.code),
          message: boundedText(failure?.message) ?? boundedText(String(failure))
        }))),
      failure_count: failures.length
    })
  });
}

export async function cleanupConduitForRefusal(conduit) {
  let thrown = null;
  try {
    await conduit.cleanup();
  } catch (error) {
    thrown = error;
  }
  return boundedCleanupFailure(thrown ?? conduit?.cleanupFailure ?? null);
}

export function withSecondaryCleanupFailure(refusalEnvelope, field, failure) {
  if (failure === null || failure === undefined || refusalEnvelope?.refusal === undefined) {
    return refusalEnvelope;
  }
  const detail = isPlainObject(refusalEnvelope.refusal.detail)
    ? refusalEnvelope.refusal.detail
    : { primary_detail: refusalEnvelope.refusal.detail ?? null };
  return {
    ...refusalEnvelope,
    refusal: {
      ...refusalEnvelope.refusal,
      detail: { ...detail, [field]: failure }
    }
  };
}

export function buildLaunchPathFailureRefusal(makeRefusal, pathFailure, secondary = {}) {
  return makeRefusal(CONFINED_LAUNCH_PATH_UNPREPARED_CODE, CONFINED_LAUNCH_PATH_UNPREPARED_CODE, {
    isolation_code: pathFailure.isolation_code,
    errno: pathFailure.errno,
    path: pathFailure.path,
    scope_member: pathFailure.scope_member,
    authority_limb: "mechanical_failure",
    recovery: { state: "no_supported_route", route: null },

    scope_widening_recovers: false,
    unchanged_retry_recovers: false,
    sandbox_required: true,
    unenforced_fallback_permitted: false,
    ...secondary
  });
}

export function classifyWorkerTestRuntimePreparationFailure(err) {
  return err instanceof WorkerTestRuntimePreparationError ? err.detail : null;
}

export function buildWorkerTestRuntimePreparationRefusal(makeRefusal, detail, secondary = {}) {
  return makeRefusal(WORKER_TEST_RUNTIME_PREPARATION_REFUSAL_CODE, WORKER_TEST_RUNTIME_PREPARATION_REFUSAL_CODE, {
    ...detail,
    authority_limb: "mechanical_failure",
    actor_recovery: "operator",
    scope_widening_recovers: false,
    unchanged_retry_recovers: false,
    sandbox_required: true,
    unenforced_fallback_permitted: false,
    ...secondary
  });
}

export function isBubblewrapBackendFailure(err) {
  return err instanceof BubblewrapIsolationError && BUBBLEWRAP_BACKEND_UNUSABLE_CODES.has(err.code);
}

export function buildConduitSpawnFailureRefusal(makeRefusal, err, conduitCleanupFailure) {
  const preparation = classifyWorkerTestRuntimePreparationFailure(err);
  if (preparation !== null) {
    return buildWorkerTestRuntimePreparationRefusal(makeRefusal, preparation, {
      conduit_cleanup_failures: conduitCleanupFailure
    });
  }
  const pathFailure = classifyLaunchPathFailure(err);
  if (pathFailure !== null) {
    return buildLaunchPathFailureRefusal(makeRefusal, pathFailure, {
      conduit_cleanup_failures: conduitCleanupFailure
    });
  }
  const evidence = {
    message: boundedText(err?.message) ?? boundedText(String(err)),
    code: boundedCode(err?.code)
  };
  const confinement = {
    sandbox_required: true,
    unenforced_fallback_permitted: false,
    conduit_cleanup_failures: conduitCleanupFailure
  };
  if (isBubblewrapBackendFailure(err)) {
    const errno = err.detail?.errno;
    return makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
      {
        ...evidence,
        errno: typeof errno === "string" && ERRNO_RE.test(errno) ? errno : null,
        authority_limb: "mechanical_failure",
        ...confinement
      }
    );
  }
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
    CONFINED_LAUNCH_FAILURE_UNCLASSIFIED_REASON,
    {
      ...evidence,
      cause_known: false,
      bubblewrap_failure_established: false,
      authority_limb: "mechanical_failure",
      actor_recovery: "operator",
      recovery: { state: "no_supported_route", route: null },
      ...confinement
    }
  );
}
