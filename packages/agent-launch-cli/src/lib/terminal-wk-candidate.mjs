import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export const TERMINAL_WK_CANDIDATE_SCHEMA_VERSION = "agent_launch.terminal_wk_candidate.v2";

export const TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3 = "agent_launch.terminal_wk_candidate.v3";

const TERMINAL_WK_CANDIDATE_SCHEMA_VERSIONS = Object.freeze(new Set([
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
]));

export const TERMINAL_WK_CANDIDATE_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.terminal_wk_candidate.invalid_argument.v1",
  GIT_FAILED: "agent_launch.terminal_wk_candidate.git_failed.v1",

  BASE_INVALID: "agent_launch.terminal_wk_candidate.base_invalid.v1",
  INPUT_MOVED: "agent_launch.terminal_wk_candidate.input_moved.v1",

  CONFLICT: "agent_launch.terminal_wk_candidate.conflict.v1",
  CANDIDATE_INVALID: "agent_launch.terminal_wk_candidate.candidate_invalid.v1",
  CANDIDATE_REF_DISAGREES: "agent_launch.terminal_wk_candidate.candidate_ref_disagrees.v1",
  BINDING_MISMATCH: "agent_launch.terminal_wk_candidate.binding_mismatch.v1"
});

export const TERMINAL_WK_CANDIDATE_IDENTITY = Object.freeze({
  name: "agent-launch terminal candidate",
  email: "terminal-candidate@agent-launch.local",
  date: "2000-01-01T00:00:00Z"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const WK_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/u;

const WK_FORK_REF_RE = /^refs\/agent-launch\/wk-forks\/(IN-\d{4})\/(WK-\d{4})$/u;
const REVIEW_SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

const BASE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

const CURRENT_CANDIDATE_REF_PREFIX = "refs/agent-launch/terminal-current-v2";
const CURRENT_CANDIDATE_REF_FORMAT =
  "%(refname)%00%(objectname)%00%(objecttype)%00%(symref)";

export class TerminalWkCandidateError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(`terminal WK candidate: ${message}`);
    this.name = "TerminalWkCandidateError";
    this.code = code;
    this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new TerminalWkCandidateError(message, { code, detail, cause });
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedFailureMessage(message) {
  return String(message ?? "").slice(0, 4096);
}

function boundedMechanicalDetail(detail) {
  if (!isPlainObject(detail)) return null;
  const projected = {};
  if (Array.isArray(detail.args)) {
    projected.git_args = detail.args.slice(0, 32).map((arg) => String(arg).slice(0, 256));
  }
  if (detail.status !== undefined) {
    projected.git_status = detail.status === null ? null : Number(detail.status);
  }
  if (detail.stderr !== undefined && detail.stderr !== null) {
    projected.git_stderr = String(detail.stderr).slice(0, 8192);
  }
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

export const TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE =
  "terminal WK candidate: unknown construction or recovery failure";

const TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE = Object.freeze({
  kind: "unknown_cause",
  code: null,
  name: null,
  message: TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

export function projectTerminalWkCandidateFailure(error) {
  if (error instanceof TerminalWkCandidateError) {
    return Object.freeze({
      kind: "typed_candidate_error",
      code: typeof error.code === "string" ? error.code : null,
      message: boundedFailureMessage(error.message),
      detail: boundedMechanicalDetail(error.detail)
    });
  }
  return TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE;
}

export function defaultTerminalCandidateRunGit({ repo, args, env = null, input = undefined }) {
  const result = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    input,
    env: env === null ? process.env : { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) return { ok: false, error: result.error.message };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr.slice(0, 8192) : ""
  };
}

function authorityGitArgs(args) {
  return ["--no-replace-objects", ...args];
}

function git(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const authorityArgs = authorityGitArgs(args);
  const result = runGit({ repo, args: authorityArgs, env });
  if (!result || result.ok !== true) {
    fail(code, message ?? `git ${args[0]} failed`, {
      args: authorityArgs,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "").trim();
}

function gitRaw(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const authorityArgs = authorityGitArgs(args);
  const result = runGit({ repo, args: authorityArgs, env });
  if (!result || result.ok !== true) {
    fail(code, message ?? `git ${args[0]} failed`, {
      args: authorityArgs,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "");
}

function canonicalOid(value, field) {
  const oid = String(value ?? "").trim();
  if (!OID_RE.test(oid) || /^0+$/u.test(oid)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, `${field} is not a canonical object id`, { field, value: oid });
  }
  return oid;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function resolveRepositoryIdentity(mainRepo, runGit) {
  const root = git(runGit, mainRepo, ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
    message: "could not resolve canonical repository root"
  });
  const commonDir = git(runGit, mainRepo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    message: "could not resolve canonical repository object store"
  });
  const objectFormat = git(runGit, mainRepo, ["rev-parse", "--show-object-format"], {
    message: "could not resolve repository object format"
  });
  if (path.resolve(mainRepo) !== root || !path.isAbsolute(commonDir) || !["sha1", "sha256"].includes(objectFormat)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "repository identity is not canonical", {
      main_repo: mainRepo,
      resolved_root: root,
      common_dir: commonDir,
      object_format: objectFormat
    });
  }
  const facts = Object.freeze({ root, common_dir: commonDir, object_format: objectFormat });
  return Object.freeze({ ...facts, digest: sha256(JSON.stringify(facts)) });
}

function resolveRef(runGit, repo, ref, field) {
  return canonicalOid(git(runGit, repo, ["rev-parse", "--verify", `${ref}^{commit}`], {
    message: `could not resolve ${field}`
  }), field);
}

function assertBaseAncestor(runGit, repo, base, wkTip) {
  const result = runGit({ repo, args: authorityGitArgs(["merge-base", "--is-ancestor", base, wkTip]), env: null });
  if (!result || result.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, "base is not an ancestor of the accumulated WK tip", {
      base,
      wk_tip: wkTip,
      status: result?.status ?? null
    });
  }
}

export function freezeTerminalWkCandidateInputs({
  mainRepo,
  baseSha,
  baseRef = "main",
  wkRef,
  canonicalWkId,
  canonicalWkDigest,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      typeof baseSha !== "string" || !OID_RE.test(baseSha) || /^0+$/u.test(baseSha) ||
      typeof baseRef !== "string" || !BASE_REF_RE.test(baseRef) ||
      typeof wkRef !== "string" || !WK_REF_RE.test(wkRef) ||
      typeof canonicalWkId !== "string" || !WK_RE.test(canonicalWkId) ||
      !wkRef.endsWith(`/${canonicalWkId}`) ||
      typeof canonicalWkDigest !== "string" || !DIGEST_RE.test(canonicalWkDigest) ||
      typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "launcher-owned candidate inputs are incomplete or invalid");
  }
  const repository = resolveRepositoryIdentity(mainRepo, runGit);

  const base = resolveRef(runGit, mainRepo, baseSha, "base");
  const wkTip = resolveRef(runGit, mainRepo, wkRef, "WK tip");

  assertBaseAncestor(runGit, mainRepo, base, wkTip);
  return Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: canonicalWkDigest,
    base_ref: baseRef,
    base,
    wk_ref: wkRef,
    wk_tip: wkTip
  });
}

export function freezeRecoveredTerminalWkCandidateInputs({
  mainRepo,
  baseRef = "main",
  wkRef,
  canonicalWkId,
  candidate,

  canonicalWkDigest = null,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      typeof baseRef !== "string" || !BASE_REF_RE.test(baseRef) ||
      typeof wkRef !== "string" || !WK_REF_RE.test(wkRef) ||
      typeof canonicalWkId !== "string" || !WK_RE.test(canonicalWkId) ||
      !wkRef.endsWith(`/${canonicalWkId}`) ||
      (canonicalWkDigest !== null && !DIGEST_RE.test(canonicalWkDigest)) ||
      !OID_RE.test(candidate ?? "") || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "launcher-owned recovered candidate inputs are incomplete or invalid");
  }
  const repository = resolveRepositoryIdentity(mainRepo, runGit);
  const metadata = readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  if (metadata.canonical_wk_id !== canonicalWkId || metadata.repository_digest !== repository.digest) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered candidate repository or WK identity disagrees", {
        expected_wk: canonicalWkId,
        actual_wk: metadata.canonical_wk_id,
        expected_repository: repository.digest,
        actual_repository: metadata.repository_digest
      });
  }
  const parentLine = git(runGit, mainRepo, ["rev-list", "--parents", "-n", "1", candidate], {
    message: "could not resolve recovered candidate parent"
  }).split(/\s+/u);
  if (parentLine.length !== 2 || parentLine[0] !== candidate || !OID_RE.test(parentLine[1])) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered candidate must have exactly one canonical parent");
  }
  const base = parentLine[1];
  if (base !== metadata.base) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered candidate parent disagrees with immutable base metadata");
  }
  const reconstructed = metadata.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3;
  if (reconstructed && canonicalWkDigest === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "a reconstructed candidate requires the current canonical record digest");
  }

  const wkTip = reconstructed
    ? observeExactDirectCommitRef({ mainRepo, ref: wkRef, runGit, subject: "durable WK ref" })
    : resolveRef(runGit, mainRepo, wkRef, "WK tip");
  if (wkTip !== metadata.wk_tip) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
      "accumulated WK ref moved after candidate construction", {
        expected: metadata.wk_tip,
        actual: wkTip
      });
  }
  assertBaseAncestor(runGit, mainRepo, base, wkTip);
  return Object.freeze({
    schema_version: metadata.schema_version,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: reconstructed ? canonicalWkDigest : metadata.canonical_wk_digest,
    ...(reconstructed
      ? {
          terminal_review_subject: metadata.terminal_review_subject,
          terminal_review_contract_digest: metadata.terminal_review_contract_digest
        }
      : {}),

    base_ref: reconstructed ? durableForkRefForWkRef(wkRef) : baseRef,
    base,
    wk_ref: wkRef,
    wk_tip: wkTip
  });
}

export function freezeReconstructedTerminalWkCandidateInputs({
  mainRepo,
  initiative,
  canonicalWkId,
  canonicalWkDigest,
  terminalReviewSubject,
  terminalReviewContractDigest,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      typeof canonicalWkId !== "string" || !WK_RE.test(canonicalWkId) ||
      typeof canonicalWkDigest !== "string" || !DIGEST_RE.test(canonicalWkDigest) ||
      typeof terminalReviewSubject !== "string" || !REVIEW_SUBJECT_RE.test(terminalReviewSubject) ||
      !terminalReviewSubject.startsWith(`${canonicalWkId}#`) ||
      typeof terminalReviewContractDigest !== "string" || !DIGEST_RE.test(terminalReviewContractDigest) ||
      typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "launcher-owned reconstructed candidate inputs are incomplete or invalid");
  }
  const refs = deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId });
  const repository = resolveRepositoryIdentity(mainRepo, runGit);
  const base = observeExactDirectCommitRef({
    mainRepo, ref: refs.fork_ref, runGit, subject: "durable WK fork ref"
  });
  const wkTip = observeExactDirectCommitRef({
    mainRepo, ref: refs.wk_ref, runGit, subject: "durable WK ref"
  });
  if (base === null || wkTip === null) return null;
  assertBaseAncestor(runGit, mainRepo, base, wkTip);
  return Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: canonicalWkDigest,
    terminal_review_subject: terminalReviewSubject,
    terminal_review_contract_digest: terminalReviewContractDigest,
    base_ref: refs.fork_ref,
    base,
    wk_ref: refs.wk_ref,
    wk_tip: wkTip
  });
}

function assertFrozenShape(frozen) {
  if (!isPlainObject(frozen) || !Object.isFrozen(frozen) ||
      !TERMINAL_WK_CANDIDATE_SCHEMA_VERSIONS.has(frozen.schema_version) ||
      !isPlainObject(frozen.repository) || !Object.isFrozen(frozen.repository) ||
      typeof frozen.main_repo !== "string" || !path.isAbsolute(frozen.main_repo) ||
      !WK_RE.test(frozen.canonical_wk_id ?? "") || !DIGEST_RE.test(frozen.canonical_wk_digest ?? "") ||
      !BASE_REF_RE.test(frozen.base_ref ?? "") || !WK_REF_RE.test(frozen.wk_ref ?? "") ||
      !frozen.wk_ref.endsWith(`/${frozen.canonical_wk_id}`) ||
      !OID_RE.test(frozen.base ?? "") || !OID_RE.test(frozen.wk_tip ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "frozen candidate tuple is incomplete or untrusted");
  }
  const reconstructed = frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3;

  if (reconstructed
    ? (!WK_FORK_REF_RE.test(frozen.base_ref) ||
        !frozen.base_ref.endsWith(`/${frozen.canonical_wk_id}`) ||
        durableForkRefForWkRef(frozen.wk_ref) !== frozen.base_ref ||
        !REVIEW_SUBJECT_RE.test(frozen.terminal_review_subject ?? "") ||
        !frozen.terminal_review_subject.startsWith(`${frozen.canonical_wk_id}#`) ||
        !DIGEST_RE.test(frozen.terminal_review_contract_digest ?? ""))
    : (frozen.terminal_review_subject !== undefined ||
        frozen.terminal_review_contract_digest !== undefined)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "frozen candidate tuple does not match its declared candidate schema version");
  }
  return frozen;
}

export function assertTerminalWkCandidateInputsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  assertFrozenShape(frozen);
  const observedRepository = resolveRepositoryIdentity(frozen.main_repo, runGit);

  const checks = frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
    ? [
        ["repository", observedRepository.digest, frozen.repository.digest],
        ["wk_tip", observeExactDirectCommitRef({
          mainRepo: frozen.main_repo, ref: frozen.wk_ref, runGit, subject: "durable WK ref"
        }), frozen.wk_tip],
        ["base", observeExactDirectCommitRef({
          mainRepo: frozen.main_repo, ref: frozen.base_ref, runGit, subject: "durable WK fork ref"
        }), frozen.base]
      ]
    : [
        ["repository", observedRepository.digest, frozen.repository.digest],
        ["wk_tip", resolveRef(runGit, frozen.main_repo, frozen.wk_ref, "WK tip"), frozen.wk_tip]
      ];
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED, `frozen ${mismatch[0]} moved`, {
      field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
    });
  }
  return frozen;
}

export function assertTerminalWkCandidatePublicationFactsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });
}

export function deriveTerminalCandidateCurrentRef({ canonicalWkId } = {}) {
  if (!WK_RE.test(canonicalWkId ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate ref input is invalid");
  }
  return `${CURRENT_CANDIDATE_REF_PREFIX}/${canonicalWkId}`;
}

function observeExactDirectCommitRef({ mainRepo, ref, runGit, subject }) {
  const observed = runGit({
    repo: mainRepo,
    args: authorityGitArgs([
      "for-each-ref",
      `--format=${CURRENT_CANDIDATE_REF_FORMAT}`,
      "--count=2",
      "--",
      ref
    ]),
    env: null
  });

  if (observed?.ok !== true || observed?.error != null || observed?.signal != null ||
      (observed?.status !== undefined && observed.status !== 0) ||
      (observed?.stderr !== undefined && String(observed.stderr ?? "") !== "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, `${subject} could not be observed`, {
      ref,
      status: observed?.status ?? null,
      stderr: observed?.stderr ?? observed?.error ?? null
    });
  }
  const stdout = typeof observed.stdout === "string" ? observed.stdout : null;
  if (stdout === "") return null;
  if (stdout === null || !stdout.endsWith("\n")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} observation is malformed`, { ref });
  }
  const records = stdout.slice(0, -1).split("\n");
  if (records.length !== 1) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} observation is ambiguous`, { ref });
  }
  const fields = records[0].split("\0");
  if (fields.length !== 4 || fields[0] !== ref) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} observation does not name the exact fixed ref`, { ref });
  }
  const [, rawTarget, objectType, symbolicTarget] = fields;
  if (symbolicTarget !== "") {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} is not a direct object ref`, { ref });
  }
  if (!OID_RE.test(rawTarget) || /^0+$/u.test(rawTarget)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} target is not a canonical object id`, { ref });
  }
  if (objectType !== "commit") {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} target is not a commit`, { ref, object: rawTarget });
  }
  return rawTarget;
}

export function readTerminalCandidateCurrentRef({
  mainRepo,
  canonicalWkId,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate lookup inputs are invalid");
  }
  return observeExactDirectCommitRef({
    mainRepo,
    ref: deriveTerminalCandidateCurrentRef({ canonicalWkId }),
    runGit,
    subject: "current candidate ref"
  });
}

export function deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId } = {}) {
  if (!INITIATIVE_RE.test(initiative ?? "") || !WK_RE.test(canonicalWkId ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "durable launcher ref inputs are invalid");
  }
  return Object.freeze({
    wk_ref: `refs/heads/wk/${initiative}/${canonicalWkId}`,
    fork_ref: `refs/agent-launch/wk-forks/${initiative}/${canonicalWkId}`
  });
}

function durableForkRefForWkRef(wkRef) {
  const match = WK_REF_RE.exec(wkRef ?? "");
  if (match === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "durable WK ref is not canonical");
  }
  return deriveTerminalCandidateDurableRefs({ initiative: match[1], canonicalWkId: match[2] }).fork_ref;
}

export function casTerminalCandidateCurrentRef({
  mainRepo,
  canonicalWkId,
  candidate,
  expectedOld,
  verifyRefs = [],
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  const candidateRef = deriveTerminalCandidateCurrentRef({ canonicalWkId });
  canonicalOid(candidate, "candidate");
  if (expectedOld !== null) canonicalOid(expectedOld, "expected current candidate");
  for (const { ref, oid } of verifyRefs) {
    if (typeof ref !== "string" || ref.length === 0) {
      fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "verified ref is invalid");
    }
    canonicalOid(oid, `verified ${ref}`);
  }

  const transaction = [
    ...verifyRefs.map(({ ref, oid }) => ["verify", ref, oid]),
    expectedOld === null
      ? ["create", candidateRef, candidate]
      : ["update", candidateRef, candidate, expectedOld]
  ].map((command) => command.join(" ")).join("\n") + "\n";
  const advanced = runGit({
    repo: mainRepo,
    args: authorityGitArgs(["update-ref", "--no-deref", "--stdin"]),
    input: transaction,
    env: null
  });
  if (advanced?.ok === true && (advanced?.status === undefined || advanced.status === 0) &&
      advanced?.error == null && advanced?.signal == null && String(advanced?.stderr ?? "") === "") {
    return Object.freeze({
      state: expectedOld === null ? "created" : expectedOld === candidate ? "current" : "advanced",
      ref: candidateRef,
      candidate
    });
  }

  const reauthenticated = verifyRefs.map(({ ref, oid }) => ({
    ref,
    expected: oid,
    actual: observeExactDirectCommitRef({
      mainRepo,
      ref,
      runGit,
      subject: `verified ${ref}`
    })
  }));
  const current = readTerminalCandidateCurrentRef({ mainRepo, canonicalWkId, runGit });
  const factsMatch = reauthenticated.every(({ expected, actual }) => expected === actual);
  if (factsMatch && current === candidate) {
    return Object.freeze({ state: "converged", ref: candidateRef, candidate });
  }
  fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    "current candidate transaction lost without an exact captured winner", {
      ref: candidateRef,
      expected_old: expectedOld,
      proposed: candidate,
      actual: current,
      reauthenticated,
      transaction
    });
}

function deterministicMessage(frozen) {
  return [
    `${frozen.canonical_wk_id}: terminal squash candidate`,
    "",
    `Base: ${frozen.base}`,
    `WK: ${frozen.wk_tip}`,
    `Repository: ${frozen.repository.digest}`,

    ...(frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
      ? [
          `Review-Unit: ${frozen.terminal_review_subject}`,
          `Review-Contract: ${frozen.terminal_review_contract_digest}`
        ]
      : [`Contract: ${frozen.canonical_wk_digest}`]),
    ""
  ].join("\n");
}

function deterministicCommitBytes({ frozen, tree }) {
  const timestamp = Math.floor(Date.parse(TERMINAL_WK_CANDIDATE_IDENTITY.date) / 1000);
  const identity = `${TERMINAL_WK_CANDIDATE_IDENTITY.name} <${TERMINAL_WK_CANDIDATE_IDENTITY.email}> ${timestamp} +0000`;
  return [
    `tree ${tree}`,
    `parent ${frozen.base}`,
    `author ${identity}`,
    `committer ${identity}`,
    "",
    deterministicMessage(frozen)
  ].join("\n");
}

export function readTerminalWkCandidateMetadata({
  mainRepo,
  candidate,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || !OID_RE.test(candidate ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "candidate contract lookup inputs are invalid");
  }
  const commitBytes = gitRaw(runGit, mainRepo, ["cat-file", "commit", candidate], {
    message: "could not read exact terminal candidate commit bytes"
  });
  const firstLine = /^((?:WK-\d{4})): terminal squash candidate$/mu.exec(commitBytes);
  const exactlyOnce = (pattern) => {
    const matches = [...commitBytes.matchAll(pattern)];
    return matches.length === 1 ? matches[0][1] : null;
  };
  const base = exactlyOnce(/^Base: ([0-9a-f]{40}|[0-9a-f]{64})$/gmu);
  const wkTip = exactlyOnce(/^WK: ([0-9a-f]{40}|[0-9a-f]{64})$/gmu);
  const repositoryDigest = exactlyOnce(/^Repository: (sha256:[0-9a-f]{64})$/gmu);
  const canonicalWkDigest = exactlyOnce(/^Contract: (sha256:[0-9a-f]{64})$/gmu);
  const reviewSubject = exactlyOnce(/^Review-Unit: (WK-\d{4}#SLICE-\d{3})$/gmu);
  const reviewContractDigest = exactlyOnce(/^Review-Contract: (sha256:[0-9a-f]{64})$/gmu);

  const v2 = canonicalWkDigest !== null && reviewSubject === null && reviewContractDigest === null &&
    commitBytes.endsWith(`Contract: ${canonicalWkDigest}\n`);
  const v3 = canonicalWkDigest === null && reviewSubject !== null && reviewContractDigest !== null &&
    commitBytes.endsWith(`Review-Contract: ${reviewContractDigest}\n`);
  if (firstLine === null || base === null || wkTip === null || repositoryDigest === null ||
      v2 === v3) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "candidate commit does not carry one exact immutable terminal metadata block");
  }
  return Object.freeze({
    schema_version: v2
      ? TERMINAL_WK_CANDIDATE_SCHEMA_VERSION
      : TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
    canonical_wk_id: firstLine[1],
    base,
    wk_tip: wkTip,
    repository_digest: repositoryDigest,
    canonical_wk_digest: canonicalWkDigest,
    terminal_review_subject: reviewSubject,
    terminal_review_contract_digest: reviewContractDigest
  });
}

function deriveTerminalWkCandidateIdentityWithGuard({ frozen, runGit, assertFacts }) {
  assertFacts({ frozen, runGit });

  const treeArgs = ["rev-parse", "--verify", `${frozen.wk_tip}^{tree}`];
  const treeResult = runGit({ repo: frozen.main_repo, args: authorityGitArgs(treeArgs), env: null });
  if (!treeResult || treeResult.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not resolve the accumulated WK tree", {
      args: authorityGitArgs(treeArgs),
      status: treeResult?.status ?? null,
      stderr: String(treeResult?.stderr ?? treeResult?.error ?? "").slice(0, 8192)
    });
  }
  const tree = canonicalOid(String(treeResult.stdout ?? "").split(/\r?\n/u)[0], "candidate tree");
  assertFacts({ frozen, runGit });
  const objectFormat = git(runGit, frozen.main_repo, ["rev-parse", "--show-object-format"], {
    message: "could not resolve repository object format"
  });
  if (!new Set(["sha1", "sha256"]).has(objectFormat)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "repository object format is unsupported", {
      object_format: objectFormat
    });
  }
  const commitBytes = deterministicCommitBytes({ frozen, tree });
  const header = `commit ${Buffer.byteLength(commitBytes, "utf8")}\0`;
  const candidate = createHash(objectFormat)
    .update(header, "utf8")
    .update(commitBytes, "utf8")
    .digest("hex");
  assertFacts({ frozen, runGit });
  return Object.freeze({

    ...frozen,
    candidate,
    candidate_tree: tree,
    candidate_parent: frozen.base,
    candidate_ref: deriveTerminalCandidateCurrentRef({ canonicalWkId: frozen.canonical_wk_id }),
    candidate_ref_state: "derived"
  });
}

export function deriveTerminalWkCandidateIdentity({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return deriveTerminalWkCandidateIdentityWithGuard({
    frozen,
    runGit,
    assertFacts: assertTerminalWkCandidateInputsUnmoved
  });
}

export function deriveRecoveredTerminalWkCandidateIdentity({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return deriveTerminalWkCandidateIdentityWithGuard({
    frozen,
    runGit,
    assertFacts: assertTerminalWkCandidatePublicationFactsUnmoved
  });
}

export function deriveTerminalWkCandidate({ frozen, runGit = defaultTerminalCandidateRunGit } = {}) {
  const identity = deriveTerminalWkCandidateIdentity({ frozen, runGit });
  const commitEnv = {
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: TERMINAL_WK_CANDIDATE_IDENTITY.name,
    GIT_AUTHOR_EMAIL: TERMINAL_WK_CANDIDATE_IDENTITY.email,
    GIT_AUTHOR_DATE: TERMINAL_WK_CANDIDATE_IDENTITY.date,
    GIT_COMMITTER_NAME: TERMINAL_WK_CANDIDATE_IDENTITY.name,
    GIT_COMMITTER_EMAIL: TERMINAL_WK_CANDIDATE_IDENTITY.email,
    GIT_COMMITTER_DATE: TERMINAL_WK_CANDIDATE_IDENTITY.date
  };
  const candidate = canonicalOid(git(runGit, frozen.main_repo, [
    "commit-tree", identity.candidate_tree, "-p", frozen.base, "-m", deterministicMessage(frozen)
  ], { message: "could not create deterministic terminal candidate", env: commitEnv }), "candidate commit");
  if (candidate !== identity.candidate) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "git commit-tree disagrees with deterministic candidate bytes", {
        expected: identity.candidate,
        actual: candidate
      });
  }
  const parentLine = git(runGit, frozen.main_repo, ["rev-list", "--parents", "-n", "1", candidate], {
    message: "could not verify candidate parent"
  }).split(/\s+/u);
  const observedTree = git(runGit, frozen.main_repo, ["rev-parse", `${candidate}^{tree}`], {
    message: "could not verify candidate tree"
  });
  if (parentLine.length !== 2 || parentLine[0] !== candidate || parentLine[1] !== frozen.base ||
      observedTree !== identity.candidate_tree) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "candidate does not have the exact tree and sole base parent", {
      candidate,
      parents: parentLine.slice(1),
      expected_parent: frozen.base,
      tree: identity.candidate_tree,
      observed_tree: observedTree
    });
  }
  assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });
  return identity;
}

export function constructTerminalWkCandidate({ frozen, runGit = defaultTerminalCandidateRunGit } = {}) {
  assertFrozenShape(frozen);
  const expectedOld = readTerminalCandidateCurrentRef({
    mainRepo: frozen.main_repo,
    canonicalWkId: frozen.canonical_wk_id,
    runGit
  });
  const derived = deriveTerminalWkCandidate({ frozen, runGit });
  const refState = casTerminalCandidateCurrentRef({
    mainRepo: frozen.main_repo,
    canonicalWkId: frozen.canonical_wk_id,
    candidate: derived.candidate,
    expectedOld,
    verifyRefs: [
      { ref: frozen.wk_ref, oid: frozen.wk_tip },
      ...(frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
        ? [{ ref: frozen.base_ref, oid: frozen.base }]
        : [])
    ],
    runGit
  });
  return Object.freeze({
    ...derived,
    candidate_ref_state: refState.state
  });
}

export function verifyTerminalWkCandidateObjectBinding({ binding, runGit = defaultTerminalCandidateRunGit } = {}) {
  if (!isPlainObject(binding) || !Object.isFrozen(binding) ||
      !TERMINAL_WK_CANDIDATE_SCHEMA_VERSIONS.has(binding.schema_version) ||
      !OID_RE.test(binding.candidate ?? "") || !OID_RE.test(binding.candidate_tree ?? "") ||
      binding.candidate_parent !== binding.base ||
      binding.candidate_ref !== deriveTerminalCandidateCurrentRef({ canonicalWkId: binding.canonical_wk_id })) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, "candidate binding shape is invalid");
  }
  assertTerminalWkCandidatePublicationFactsUnmoved({ frozen: binding, runGit });
  const observedCommitBytes = gitRaw(runGit, binding.main_repo, ["cat-file", "commit", binding.candidate], {
    message: "could not read exact terminal candidate commit bytes"
  });
  const checks = [
    ["candidate_tree", git(runGit, binding.main_repo, ["rev-parse", `${binding.candidate}^{tree}`]), binding.candidate_tree],
    [
      "candidate_commit_bytes",
      observedCommitBytes,
      deterministicCommitBytes({ frozen: binding, tree: binding.candidate_tree })
    ]
  ];
  const parentLine = git(runGit, binding.main_repo, ["rev-list", "--parents", "-n", "1", binding.candidate]).split(/\s+/u);
  if (parentLine.length !== 2 || parentLine[1] !== binding.base) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, "candidate parent binding moved or disagrees", {
      expected: binding.base,
      actual: parentLine.slice(1)
    });
  }
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, `candidate ${mismatch[0]} moved or disagrees`, {
      field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
    });
  }
  return binding;
}
