

import { realpathSync } from "node:fs";
import path from "node:path";

import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";
import { resolveProspectiveScopeExistenceBase } from "./backend-provisioning-state.mjs";
import { readCanonicalWorkRecord } from "./backend-scope-authority.mjs";
import {
  WORKER_SCOPE_PATH_REFUSED,
  resolveFrozenWorkerScopeAuthority
} from "./backend-worker-scope-authority.mjs";

export const WORKER_SCOPE_PREFLIGHT_SCHEMA_VERSION = "worker-scope-preflight.v1";

export const WORKER_SCOPE_PREFLIGHT_STATUS = Object.freeze({
  PASSED: "passed",
  REFUSED: "refused",
  NOT_EVALUATED: "not_evaluated",
  NOT_APPLICABLE: "not_applicable"
});

export const WORKER_SCOPE_PREFLIGHT_EVALUATED = Object.freeze([
  "declared_scope_syntax",
  "declared_scope_existence_at_prospective_base",
  "resolved_scope_membership_at_prospective_base"
]);

export const WORKER_SCOPE_LAUNCH_PENDING = Object.freeze([
  "wk_allocation_and_record_snapshot",
  "scope_revalidation_at_provisioned_base",
  "assigned_source_readability",
  "writable_directory_preparation",
  "namespace_projection",
  "runtime_and_sandbox_availability"
]);

function report(status, fields = {}) {
  return Object.freeze({
    schema_version: WORKER_SCOPE_PREFLIGHT_SCHEMA_VERSION,
    status,
    base: null,
    refusal: null,
    reason: null,
    evaluated: status === WORKER_SCOPE_PREFLIGHT_STATUS.PASSED ||
      status === WORKER_SCOPE_PREFLIGHT_STATUS.REFUSED
      ? WORKER_SCOPE_PREFLIGHT_EVALUATED
      : Object.freeze([]),
    pending_at_launch: WORKER_SCOPE_LAUNCH_PENDING,
    ...fields
  });
}

function notEvaluated(reason, message = null) {
  return report(WORKER_SCOPE_PREFLIGHT_STATUS.NOT_EVALUATED, {
    reason: Object.freeze({ code: reason, message })
  });
}

export function preflightWorkerScope({ dir, unitAddress, deps = {} } = {}) {
  const match = typeof unitAddress === "string" ? unitAddress.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (match === null) return report(WORKER_SCOPE_PREFLIGHT_STATUS.NOT_APPLICABLE);
  let mainRepo;
  try {
    mainRepo = realpathSync(path.resolve(dir));
  } catch (error) {
    return notEvaluated("repository_unresolvable", error?.message ?? String(error));
  }
  const record = readCanonicalWorkRecord(mainRepo, unitAddress);
  const slice = Array.isArray(record?.slices)
    ? record.slices.find((candidate) => candidate?.id === match[2]) ?? null
    : null;
  if (record === null || record.id !== match[1] || slice === null) {
    return notEvaluated("canonical_unit_unresolvable");
  }
  if (slice.work_kind !== "implementation") return report(WORKER_SCOPE_PREFLIGHT_STATUS.NOT_APPLICABLE);
  if (typeof record.initiative !== "string" || !/^IN-\d{4}$/u.test(record.initiative)) {
    return notEvaluated("initiative_unresolvable");
  }
  let prospective;
  try {
    prospective = resolveProspectiveScopeExistenceBase({
      mainRepo,
      initiative: record.initiative,
      recordId: match[1],
      deps
    });
  } catch (error) {
    return notEvaluated("scope_existence_base_unresolved", error?.message ?? String(error));
  }
  if (prospective.ok !== true) return notEvaluated(prospective.reason);
  const base = Object.freeze({
    ref: prospective.scope_existence_base.base_ref,
    sha: prospective.scope_existence_base.base_sha,
    source: prospective.source
  });
  try {
    resolveFrozenWorkerScopeAuthority({
      mainRepo,
      subject: unitAddress,
      record,
      slice,
      scopeBase: prospective.scope_existence_base,
      deps
    });
  } catch (error) {
    if (error?.code !== WORKER_SCOPE_PATH_REFUSED) {
      return report(WORKER_SCOPE_PREFLIGHT_STATUS.NOT_EVALUATED, {
        base,
        reason: Object.freeze({ code: "scope_resolution_indeterminate", message: error?.message ?? String(error) })
      });
    }
    return report(WORKER_SCOPE_PREFLIGHT_STATUS.REFUSED, {
      base,
      refusal: Object.freeze({ code: error.code, message: error.message, ...error.detail })
    });
  }
  return report(WORKER_SCOPE_PREFLIGHT_STATUS.PASSED, { base });
}
