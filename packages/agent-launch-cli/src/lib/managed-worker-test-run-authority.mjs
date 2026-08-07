

import path from "node:path";

export const MANAGED_WORKER_TEST_RUN_AUTHORITY_SCHEMA_VERSION =
  "managed-worker-test-run-authority.v1";

export const MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES = Object.freeze({
  BINDING_INVALID: "managed_worker_test_run_authority.binding_invalid.v1",
  CALLER_SUPPLIED_BINDING:
    "managed_worker_test_run_authority.caller_supplied_binding.v1",
  UNTRUSTED_AUTHORITY: "managed_worker_test_run_authority.untrusted_authority.v1"
});

export const MANAGED_WORKER_TEST_RUN_FORBIDDEN_BINDING_KEYS = Object.freeze([
  "unit",
  "unit_address",
  "unitAddress",
  "selected_unit",
  "selectedUnit",
  "record",
  "record_id",
  "recordId",
  "slice",
  "slice_id",
  "sliceId",
  "repo",
  "workspace",
  "workspace_dir",
  "workspaceDir",
  "workspace_root",
  "workspaceRoot",
  "worktree",
  "worktree_path",
  "worktreePath",
  "main_repo",
  "mainRepo",
  "cwd",
  "checkout",
  "checkout_path",
  "checkoutPath",
  "base",
  "base_sha",
  "baseSha",
  "authorized_targets",
  "authorizedTargets",
  "allowed",
  "snapshot",
  "source_digest",
  "sourceDigest"
]);

const SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;

const TRUSTED_TEST_RUN_AUTHORITIES = new WeakSet();

export class ManagedWorkerTestRunAuthorityError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "ManagedWorkerTestRunAuthorityError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new ManagedWorkerTestRunAuthorityError(code, message, detail);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireAbsolutePath(value, field) {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value) ||
      path.normalize(value) !== value) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.BINDING_INVALID,
      `launcher binding ${field} must be an absolute normalized path`,
      { field }
    );
  }
  return value;
}

export function assertNoCallerSuppliedBinding(request, { allowedKeys = ["target"] } = {}) {
  if (request === undefined || request === null) return Object.freeze({});
  if (!isPlainObject(request)) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.CALLER_SUPPLIED_BINDING,
      "declared-test request must be an object"
    );
  }
  const allowed = new Set(allowedKeys);
  for (const key of MANAGED_WORKER_TEST_RUN_FORBIDDEN_BINDING_KEYS) {
    if (Object.hasOwn(request, key)) {
      fail(
        MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.CALLER_SUPPLIED_BINDING,
        `the declared-test capability binds its unit and worktree from the dispatched run; it refuses a caller-supplied ${key}`,
        { forbidden_key: key }
      );
    }
  }
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) {
      fail(
        MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.CALLER_SUPPLIED_BINDING,
        `declared-test request accepts exactly {${[...allowed].sort().join(",")}}; unexpected field: ${key}`,
        { unexpected_key: key }
      );
    }
  }
  return request;
}

export function mintManagedWorkerTestRunAuthority({ commitBinding, mainRepo } = {}) {
  if (!isPlainObject(commitBinding)) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.BINDING_INVALID,
      "declared-test authority requires the launcher-minted identity-store binding"
    );
  }
  const repo = requireAbsolutePath(mainRepo, "main_repo");

  const subject = commitBinding.subject;
  const match = typeof subject === "string" ? SUBJECT_RE.exec(subject) : null;
  if (!match) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.BINDING_INVALID,
      "launcher binding subject must identify one canonical exact slice",
      { subject: typeof subject === "string" ? subject : null }
    );
  }
  const [, recordId, sliceId] = match;
  const unitAddress = subject;

  if (commitBinding.write_scope_source !== `wiki/work-records/${recordId}.json#${sliceId}`) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.BINDING_INVALID,
      "launcher binding write_scope_source does not match its subject",
      { subject: unitAddress, write_scope_source: commitBinding.write_scope_source ?? null }
    );
  }

  const worktreePath = requireAbsolutePath(commitBinding.worktree_path, "worktree_path");
  if (path.relative(repo, worktreePath) === "" ) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.BINDING_INVALID,
      "the declared-test worktree must not be the landing checkout",
      { main_repo: repo, worktree_path: worktreePath }
    );
  }

  const authority = Object.freeze({
    schema_version: MANAGED_WORKER_TEST_RUN_AUTHORITY_SCHEMA_VERSION,
    unit_address: unitAddress,
    record_id: recordId,
    slice_id: sliceId,
    main_repo: repo,
    worktree_path: worktreePath,
    source_digest: typeof commitBinding.source_digest === "string"
      ? commitBinding.source_digest
      : null,
    launch_ref: typeof commitBinding.launch_ref === "string" ? commitBinding.launch_ref : null,
    run_id: typeof commitBinding.run_id === "string" ? commitBinding.run_id : null
  });
  TRUSTED_TEST_RUN_AUTHORITIES.add(authority);
  return authority;
}

export function assertTrustedManagedWorkerTestRunAuthority(authority) {
  if (!authority || typeof authority !== "object" || !Object.isFrozen(authority) ||
      !TRUSTED_TEST_RUN_AUTHORITIES.has(authority) ||
      authority.schema_version !== MANAGED_WORKER_TEST_RUN_AUTHORITY_SCHEMA_VERSION) {
    fail(
      MANAGED_WORKER_TEST_RUN_AUTHORITY_ERROR_CODES.UNTRUSTED_AUTHORITY,
      "the declared-test capability requires one launcher-minted trusted run authority"
    );
  }
  return authority;
}

export function isTrustedManagedWorkerTestRunAuthority(value) {
  return typeof value === "object" && value !== null &&
    TRUSTED_TEST_RUN_AUTHORITIES.has(value);
}
