

import { spawnSync } from "node:child_process";
import { getForbiddenSidecarPathMatch } from "@agent-chassis/wiki-core";

export const COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION = "commit-scope-envelope.v1";

export const COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.commit_scope_envelope.invalid_arg.v1",
  INVALID_SHA: "agent_launch.commit_scope_envelope.invalid_sha.v1",
  MISSING_RESOLVER: "agent_launch.commit_scope_envelope.missing_resolver.v1",

  GATE_DIFF_FAILED: "agent_launch.commit_scope_envelope.gate_diff_failed.v1",

  OUT_OF_SCOPE: "agent_launch.commit_scope_envelope.out_of_scope.v1",
  FORBIDDEN_REPOSITORY_PATH: "agent_launch.commit_scope_envelope.forbidden_repository_path.v1",

  SYMLINK_OR_TYPE_SWAP: "agent_launch.commit_scope_envelope.symlink_or_type_swap.v1"
});

export const COMMIT_SCOPE_ENVELOPE_REFUSAL_REASONS = Object.freeze({
  OUT_OF_SCOPE: "out_of_scope",
  FORBIDDEN_REPOSITORY_PATH: "forbidden_repository_path",
  SYMLINK_OR_TYPE_SWAP: "symlink_or_type_swap"
});

export class CommitScopeEnvelopeError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "CommitScopeEnvelopeError";
    this.code = code ?? "agent_launch.commit_scope_envelope.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new CommitScopeEnvelopeError(`agent-launch commit-scope-envelope: ${message}`, {
    code,
    detail,
    cause
  });
}

const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

function isZeroOid(sha) {
  return /^0+$/.test(sha);
}

function assertOid(value, label) {
  if (typeof value !== "string" || !OID_RE.test(value) || isZeroOid(value)) {
    fail(
      COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.INVALID_SHA,
      `${label} must be a non-zero 40- or 64-hex object name, got: ${JSON.stringify(value)}`
    );
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  return value;
}

const SYMLINK_MODE = "120000";

export const COMMIT_SCOPE_DIFF_TEXTCONV_OFF = Object.freeze(["-c", "diff.*.textconv="]);

export function defaultRunGit({ gitDir, args }) {
  const fullArgs = [];
  if (typeof gitDir === "string" && gitDir.length > 0) fullArgs.push(`--git-dir=${gitDir}`);
  fullArgs.push("-c", "core.quotePath=false", ...args);
  let res;
  try {
    res = spawnSync("git", fullArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error) };
  }
  if (typeof res.status !== "number" || res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      signal: res.signal ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

function parseRawDiffTree(stdout) {
  const entries = [];
  for (const rawLine of stdout.split("\n")) {
    if (rawLine.length === 0) continue;
    const tab = rawLine.indexOf("\t");
    if (tab < 0) continue;
    const meta = rawLine.slice(0, tab);
    const path = rawLine.slice(tab + 1);

    const fields = meta.replace(/^:/, "").split(/\s+/).filter((f) => f.length > 0);

    const oldMode = fields[0] ?? "";
    const newMode = fields[1] ?? "";
    const status = fields[4] ?? "";
    if (path.length === 0) continue;
    entries.push({ path, oldMode, newMode, status });
  }
  return entries;
}

function computeGatePathSet(runGit, gitDir, baseSha, commit) {
  const res = runGit({
    gitDir,
    args: [...COMMIT_SCOPE_DIFF_TEXTCONV_OFF, "diff-tree", "--raw", "-r", "--no-renames", baseSha, commit]
  });
  if (!res || res.ok !== true) {
    fail(
      COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.GATE_DIFF_FAILED,
      `the security-pinned gate diff base_sha -> commit could not run; the gate fails closed`,
      { base_sha: baseSha, commit, status: res?.status ?? null, stderr: res?.stderr ?? null, error: res?.error ?? null }
    );
  }
  const entries = parseRawDiffTree(res.stdout);
  const changedPaths = [];
  const symlinkOrTypeSwap = [];
  const forbiddenRepositoryPaths = [];
  for (const e of entries) {
    changedPaths.push(e.path);

    if (e.newMode === SYMLINK_MODE || e.oldMode === SYMLINK_MODE || e.status.startsWith("T")) {
      symlinkOrTypeSwap.push(e.path);
    }
    const forbidden = getForbiddenSidecarPathMatch(e.path);
    if (forbidden) {
      forbiddenRepositoryPaths.push(Object.freeze({
        path: e.path,
        pattern: forbidden.pattern,
        reason: forbidden.reason
      }));
    }
  }
  changedPaths.sort();
  symlinkOrTypeSwap.sort();
  forbiddenRepositoryPaths.sort((left, right) => left.path.localeCompare(right.path));
  return { changedPaths, symlinkOrTypeSwap, forbiddenRepositoryPaths };
}

function buildScopeMatcher(resolveWriteScope, writeScope) {
  if (typeof resolveWriteScope !== "function") {
    fail(
      COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.MISSING_RESOLVER,
      "a resolveWriteScope resolver dep is required (WK-1284 canonical resolver); refusing to fall back to a naive containment check"
    );
  }
  const matcher = resolveWriteScope(writeScope);
  if (!matcher || typeof matcher.matches !== "function") {
    fail(
      COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.MISSING_RESOLVER,
      "resolveWriteScope must return a matcher exposing matches(relPath) => boolean"
    );
  }
  return matcher;
}

function computeOutOfScope(matcher, changedPaths) {
  const outOfScope = [];
  for (const p of changedPaths) {
    let within;
    try {
      within = matcher.matches(p) === true;
    } catch (err) {

      within = false;
    }
    if (!within) outOfScope.push(p);
  }
  return outOfScope;
}

function readTreeBlobSizes(runGit, gitDir, treeish) {
  const res = runGit({ gitDir, args: ["ls-tree", "-r", "--long", treeish] });
  if (!res || res.ok !== true) {
    throw new CommitScopeEnvelopeError("ls-tree blob-size probe failed", {
      code: COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.GATE_DIFF_FAILED,
      detail: { treeish, status: res?.status ?? null, stderr: res?.stderr ?? null }
    });
  }
  const sizes = {};
  for (const line of res.stdout.split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab).trim().split(/\s+/);
    const path = line.slice(tab + 1);

    const size = Number.parseInt(meta[3], 10);
    if (Number.isFinite(size)) sizes[path] = size;
  }
  return sizes;
}

function readChangedLineCount(runGit, gitDir, baseSha, commit) {
  const res = runGit({
    gitDir,
    args: [...COMMIT_SCOPE_DIFF_TEXTCONV_OFF, "diff-tree", "--numstat", "-r", "--no-renames", baseSha, commit]
  });
  if (!res || res.ok !== true) {
    throw new CommitScopeEnvelopeError("numstat changed-line probe failed", {
      code: COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.GATE_DIFF_FAILED,
      detail: { base_sha: baseSha, commit, status: res?.status ?? null, stderr: res?.stderr ?? null }
    });
  }
  let added = 0;
  let deleted = 0;
  const binaryPaths = [];
  for (const line of res.stdout.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const a = parts[0];
    const d = parts[1];
    const path = parts.slice(2).join("\t");
    if (a === "-" || d === "-") {
      binaryPaths.push(path);
      continue;
    }
    const an = Number.parseInt(a, 10);
    const dn = Number.parseInt(d, 10);
    if (Number.isFinite(an)) added += an;
    if (Number.isFinite(dn)) deleted += dn;
  }
  binaryPaths.sort();
  return { added, deleted, total: added + deleted, binary_paths: binaryPaths };
}

function measureEnvelope({ runGit, gitDir, baseSha, commit, changedPaths, writeScope }) {
  try {
    const lineCount = readChangedLineCount(runGit, gitDir, baseSha, commit);
    const finalSizesAll = readTreeBlobSizes(runGit, gitDir, commit);

    const finalFileSizes = {};
    for (const p of changedPaths) {
      if (Object.prototype.hasOwnProperty.call(finalSizesAll, p)) finalFileSizes[p] = finalSizesAll[p];
    }
    return Object.freeze({
      schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
      measured: true,
      changed_line_count: Object.freeze(lineCount),
      final_file_sizes: Object.freeze(finalFileSizes),
      changed_file_count: changedPaths.length,
      scope_count: Array.isArray(writeScope) ? writeScope.length : 0
    });
  } catch (err) {

    return Object.freeze({
      schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
      measured: false,
      reason: err?.code ?? "agent_launch.commit_scope_envelope.metric_failed.v1",
      detail: { message: err?.message ?? String(err) }
    });
  }
}

function measureBaseline({ runGit, gitDir, baseSha, changedPaths }) {
  try {
    const baseSizesAll = readTreeBlobSizes(runGit, gitDir, baseSha);
    const fileSizesAtBase = {};
    for (const p of changedPaths) {
      if (Object.prototype.hasOwnProperty.call(baseSizesAll, p)) fileSizesAtBase[p] = baseSizesAll[p];
    }
    return Object.freeze({
      schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
      measured: true,
      file_sizes_at_base: Object.freeze(fileSizesAtBase)
    });
  } catch (err) {
    return Object.freeze({
      schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
      measured: false,
      reason: err?.code ?? "agent_launch.commit_scope_envelope.baseline_failed.v1",
      detail: { message: err?.message ?? String(err) }
    });
  }
}

export const DELIVERY_ENVELOPE_POLICY_PROFILE_SCHEMA = Object.freeze({
  schema_version: "delivery_envelope.policy_profile.v1",

  metric_vocabulary: Object.freeze([
    "changed_line_count",
    "final_file_size",
    "changed_file_count",
    "scope_count"
  ]),

  reduction_semantics: Object.freeze({
    kind: "delta_aware",
    compares: "final_delivered_size_vs_pre_edit_baseline",
    absolute_ceiling: false
  }),

  values_owner: "org_repo_profile",
  enforcement_owner: "node_engine",
  engine_bakes_values: false
});

export const EXPECTED_ENVELOPE_FIELD_SCHEMA = Object.freeze({
  schema_version: "expected_envelope_field.v1",
  field: "expected_envelope",
  required: true,
  read_as_of: "base_sha_tree",
  presence_guarantor: "WK-1432",
  vocabulary: Object.freeze(["declared_metrics", "profile_ref"])
});

export const ENVELOPE_ATTESTATION_STATES = Object.freeze({

  NOT_ATTESTED_FREE: "not_attested_free",

  NOT_ATTESTED_FAIL_OPEN: "not_attested_fail_open",

  ATTESTED: "attested"
});

export const ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION = "envelope-attestation-marker.v1";

export function buildFreeTierNotAttestedMarker({ baseSha, commit, tree }) {
  return Object.freeze({
    schema_version: ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION,
    state: ENVELOPE_ATTESTATION_STATES.NOT_ATTESTED_FREE,
    attested: false,

    base_sha: baseSha,
    commit,
    tree
  });
}

export function assertExpectedEnvelopeInvariant(expectedEnvelope) {
  const present =
    expectedEnvelope !== null &&
    expectedEnvelope !== undefined &&
    typeof expectedEnvelope === "object" &&
    Object.keys(expectedEnvelope).length > 0;
  return Object.freeze({
    schema_version: EXPECTED_ENVELOPE_FIELD_SCHEMA.schema_version,
    present,
    blocking: false,
    violation: present
      ? null
      : Object.freeze({
          kind: "expected_envelope_absent_at_commit",
          note: "WK-1432 provisioning invariant violated: base_sha minted without a non-empty expected-envelope"
        })
  });
}

export function verifyAndMeasureCommitScope({
  gitDir,
  baseSha,
  commit,
  tree,
  writeScope = [],
  expectedEnvelope = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const resolveWriteScope = deps.resolveWriteScope;

  assertNonEmptyString(gitDir, "gitDir");
  assertOid(baseSha, "baseSha");
  assertOid(commit, "commit");
  assertOid(tree, "tree");
  if (!Array.isArray(writeScope)) {
    fail(COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.INVALID_ARG, "writeScope must be an array");
  }

  const { changedPaths, symlinkOrTypeSwap, forbiddenRepositoryPaths } = computeGatePathSet(runGit, gitDir, baseSha, commit);

  const matcher = buildScopeMatcher(resolveWriteScope, writeScope);
  const outOfScope = computeOutOfScope(matcher, changedPaths);

  const reasons = [];
  if (symlinkOrTypeSwap.length > 0) reasons.push(COMMIT_SCOPE_ENVELOPE_REFUSAL_REASONS.SYMLINK_OR_TYPE_SWAP);
  if (forbiddenRepositoryPaths.length > 0) reasons.push(COMMIT_SCOPE_ENVELOPE_REFUSAL_REASONS.FORBIDDEN_REPOSITORY_PATH);
  if (outOfScope.length > 0) reasons.push(COMMIT_SCOPE_ENVELOPE_REFUSAL_REASONS.OUT_OF_SCOPE);
  const contained = reasons.length === 0;
  const refusal = contained
    ? null
    : Object.freeze({
        schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,

        code:
          symlinkOrTypeSwap.length > 0
            ? COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.SYMLINK_OR_TYPE_SWAP
            : forbiddenRepositoryPaths.length > 0
              ? COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.FORBIDDEN_REPOSITORY_PATH
              : COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES.OUT_OF_SCOPE,
        reasons: Object.freeze(reasons),
        out_of_scope: Object.freeze(outOfScope.slice()),
        symlink_or_type_swap: Object.freeze(symlinkOrTypeSwap.slice()),
        forbidden_repository_paths: Object.freeze(forbiddenRepositoryPaths.slice())
      });

  const metrics = measureEnvelope({ runGit, gitDir, baseSha, commit, changedPaths, writeScope });
  const baseline = measureBaseline({ runGit, gitDir, baseSha, changedPaths });

  const attestation = buildFreeTierNotAttestedMarker({ baseSha, commit, tree });
  const expectedEnvelopeInvariant = assertExpectedEnvelopeInvariant(expectedEnvelope);

  return Object.freeze({
    schema_version: COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
    contained,
    changed_paths: Object.freeze(changedPaths.slice()),
    refusal,
    metrics,
    baseline,
    attestation,
    expected_envelope_invariant: expectedEnvelopeInvariant
  });
}
