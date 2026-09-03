import { createHash } from "node:crypto";
import path from "node:path";
import { runGitAsync } from "../../../agent-launch-core/src/lib/git.mjs";
import {
  assertAuthenticatedControlledContractGeneration,
  authenticatedControlledContractGenerationMetadataFromFields,
  authenticatedControlledContractGenerationMatchesMetadata,
  projectAuthenticatedControlledContractGeneration
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";

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
const VERSIONED_CANDIDATE_REF_PREFIX =
  "refs/agent-launch/terminal-candidates-v1";
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

export async function defaultTerminalCandidateRunGit({ repo, args, env = null, input = undefined }) {
  const result = await runGitAsync({
    repo,
    args,
    quotePath: true,
    input,
    env: env === null ? process.env : { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    stderrLimit: 8192
  });
  if (result.error) return { ok: false, error: result.error, ...(result.overflow === true ? { overflow: true } : {}) };
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal ?? null,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : ""
  };
}

function authorityGitArgs(args) {
  return ["--no-replace-objects", ...args];
}

async function git(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const authorityArgs = authorityGitArgs(args);
  const result = await runGit({ repo, args: authorityArgs, env });
  if (!result || result.ok !== true) {
    fail(code, message ?? `git ${args[0]} failed`, {
      args: authorityArgs,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "").trim();
}

async function gitRaw(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const authorityArgs = authorityGitArgs(args);
  const result = await runGit({ repo, args: authorityArgs, env });
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

function oidReForObjectFormat(objectFormat) {
  if (objectFormat === "sha1") return /^[0-9a-f]{40}$/u;
  if (objectFormat === "sha256") return /^[0-9a-f]{64}$/u;
  return OID_RE;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function generationFromInput(value, mainRepo, canonicalWkId) {
  if (value === undefined || value === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "candidate requires the exact-W controlled generation identity");
  }
  try {
    return assertAuthenticatedControlledContractGeneration(value, {
      repository: mainRepo,
      wkId: canonicalWkId,
      requireManifest: true
    });
  } catch (error) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "exact-W controlled generation identity is malformed or unauthenticated", null, error);
  }
}

function assertGenerationForCandidate(value, { mainRepo, canonicalWkId, wkTip }) {
  try {
    return assertAuthenticatedControlledContractGeneration(value, {
      repository: mainRepo,
      wkId: canonicalWkId,
      wkTipSha: wkTip,
      requireManifest: true
    });
  } catch (error) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "exact-W controlled generation contradicts candidate W", null, error);
  }
}

async function resolveRepositoryIdentity(mainRepo, runGit) {
  const root = await git(runGit, mainRepo, ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
    message: "could not resolve canonical repository root"
  });
  const commonDir = await git(runGit, mainRepo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    message: "could not resolve canonical repository object store"
  });
  const objectFormat = await git(runGit, mainRepo, ["rev-parse", "--show-object-format"], {
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

async function resolveRef(runGit, repo, ref, field) {
  return canonicalOid(await git(runGit, repo, ["rev-parse", "--verify", `${ref}^{commit}`], {
    message: `could not resolve ${field}`
  }), field);
}

async function assertBaseAncestor(runGit, repo, base, wkTip) {
  const result = await runGit({ repo, args: authorityGitArgs(["merge-base", "--is-ancestor", base, wkTip]), env: null });
  if (!result || result.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, "base is not an ancestor of the accumulated WK tip", {
      args: ["merge-base", "--is-ancestor", base, wkTip],
      status: result?.status ?? null
    });
  }
}

export async function freezeTerminalWkCandidateInputs({
  mainRepo,
  baseSha,
  baseRef = "main",
  wkRef,
  canonicalWkId,
  canonicalWkDigest,
  generationAuthentication = null,
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
  const repository = await resolveRepositoryIdentity(mainRepo, runGit);
  const generationIdentity = generationFromInput(
    generationAuthentication, mainRepo, canonicalWkId);

  const base = await resolveRef(runGit, mainRepo, baseSha, "base");
  const wkTip = await resolveRef(runGit, mainRepo, wkRef, "WK tip");
  assertGenerationForCandidate(generationIdentity, { mainRepo, canonicalWkId, wkTip });

  await assertBaseAncestor(runGit, mainRepo, base, wkTip);
  return Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: canonicalWkDigest,
    base_ref: baseRef,
    base,
    wk_ref: wkRef,
    wk_tip: wkTip,
    controlled_generation: generationIdentity
  });
}

export async function freezeRecoveredTerminalWkCandidateInputs({
  mainRepo,
  baseRef = "main",
  wkRef,
  canonicalWkId,
  candidate,

  canonicalWkDigest = null,
  generationAuthentication = null,
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
  const repository = await resolveRepositoryIdentity(mainRepo, runGit);
  const generationIdentity = generationFromInput(
    generationAuthentication, mainRepo, canonicalWkId);
  const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  if (metadata.canonical_wk_id !== canonicalWkId || metadata.repository_digest !== repository.digest) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered candidate repository or WK identity disagrees", {
        expected_wk: canonicalWkId,
        actual_wk: metadata.canonical_wk_id,
        expected_repository: repository.digest,
        actual_repository: metadata.repository_digest
      });
  }
  const parentLine = (await git(runGit, mainRepo, ["rev-list", "--parents", "-n", "1", candidate], {
    message: "could not resolve recovered candidate parent"
  })).split(/\s+/u);
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
    ? await observeExactDirectCommitRef({ mainRepo, ref: wkRef, runGit, subject: "durable WK ref" })
    : await resolveRef(runGit, mainRepo, wkRef, "WK tip");
  if (wkTip !== metadata.wk_tip) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
      "accumulated WK ref moved after candidate construction", {
        expected: metadata.wk_tip,
        actual: wkTip
      });
  }
  assertGenerationForCandidate(generationIdentity, { mainRepo, canonicalWkId, wkTip });
  await assertBaseAncestor(runGit, mainRepo, base, wkTip);
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
    wk_tip: wkTip,
    controlled_generation: generationIdentity
  });
}

export async function freezeReconstructedTerminalWkCandidateInputs({
  mainRepo,
  initiative,
  canonicalWkId,
  canonicalWkDigest,
  terminalReviewSubject,
  terminalReviewContractDigest,
  generationAuthentication = null,
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
  const repository = await resolveRepositoryIdentity(mainRepo, runGit);
  const base = await observeExactDirectCommitRef({
    mainRepo, ref: refs.fork_ref, runGit, subject: "durable WK fork ref"
  });
  const wkTip = await observeExactDirectCommitRef({
    mainRepo, ref: refs.wk_ref, runGit, subject: "durable WK ref"
  });
  if (base === null || wkTip === null) return null;
  const generationIdentity = generationFromInput(
    generationAuthentication, mainRepo, canonicalWkId);
  assertGenerationForCandidate(generationIdentity, { mainRepo, canonicalWkId, wkTip });
  await assertBaseAncestor(runGit, mainRepo, base, wkTip);
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
    wk_tip: wkTip,
    controlled_generation: generationIdentity
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
  try {
    assertAuthenticatedControlledContractGeneration(frozen.controlled_generation, {
      repository: frozen.main_repo,
      wkId: frozen.canonical_wk_id,
      wkTipSha: frozen.wk_tip,
      requireManifest: true
    });
  } catch (error) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "frozen candidate controlled generation is unauthenticated", null, error);
  }
  return frozen;
}

export async function assertTerminalWkCandidateInputsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  assertFrozenShape(frozen);
  const observedRepository = await resolveRepositoryIdentity(frozen.main_repo, runGit);

  const checks = frozen.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3
    ? [
        ["repository", observedRepository.digest, frozen.repository.digest],
        ["wk_tip", await observeExactDirectCommitRef({
          mainRepo: frozen.main_repo, ref: frozen.wk_ref, runGit, subject: "durable WK ref"
        }), frozen.wk_tip],
        ["base", await observeExactDirectCommitRef({
          mainRepo: frozen.main_repo, ref: frozen.base_ref, runGit, subject: "durable WK fork ref"
        }), frozen.base]
      ]
    : [
        ["repository", observedRepository.digest, frozen.repository.digest],
        ["wk_tip", await resolveRef(runGit, frozen.main_repo, frozen.wk_ref, "WK tip"), frozen.wk_tip]
      ];
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED, `frozen ${mismatch[0]} moved`, {
      field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
    });
  }
  return frozen;
}

export async function assertTerminalWkCandidatePublicationFactsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return await assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });
}

export function deriveTerminalCandidateCurrentRef({ canonicalWkId } = {}) {
  if (!WK_RE.test(canonicalWkId ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate ref input is invalid");
  }
  return `${CURRENT_CANDIDATE_REF_PREFIX}/${canonicalWkId}`;
}

function assertTerminalWkCandidateVersionIdentityBinding(binding) {
  try {
    assertFrozenShape(binding);
  } catch (error) {
    if (!(error instanceof TerminalWkCandidateError)) {
      throw error;
    }
    fail(
      TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "candidate version binding is incomplete or unauthenticated",
      null,
      error
    );
  }

  const repository = binding.repository;
  const repositoryKeys = Reflect.ownKeys(repository);
  const expectedRepositoryKeys = [
    "common_dir",
    "digest",
    "object_format",
    "root"
  ];
  const repositoryFacts = {
    root: repository.root,
    common_dir: repository.common_dir,
    object_format: repository.object_format
  };
  const oidPattern = oidReForObjectFormat(repository.object_format);
  const requiredOids = [
    binding.base,
    binding.wk_tip,
    binding.candidate_tree,
    binding.candidate_parent,
    binding.candidate
  ];

  if (
    repositoryKeys.some((key) => typeof key !== "string") ||
    repositoryKeys.length !== expectedRepositoryKeys.length ||
    repositoryKeys.filter((key) => typeof key === "string").sort()
      .some((key, index) => key !== expectedRepositoryKeys[index]) ||
    typeof repository.root !== "string" ||
    !path.isAbsolute(repository.root) ||
    path.normalize(repository.root) !== repository.root ||
    repository.root !== binding.main_repo ||
    typeof repository.common_dir !== "string" ||
    !path.isAbsolute(repository.common_dir) ||
    path.normalize(repository.common_dir) !== repository.common_dir ||
    !["sha1", "sha256"].includes(repository.object_format) ||
    !DIGEST_RE.test(repository.digest) ||
    repository.digest !== sha256(JSON.stringify(repositoryFacts)) ||
    requiredOids.some(
      (oid) => typeof oid !== "string" || !oidPattern.test(oid) || /^0+$/u.test(oid)
    ) ||
    binding.candidate_parent !== binding.base ||
    binding.candidate_ref !==
      deriveTerminalCandidateCurrentRef({ canonicalWkId: binding.canonical_wk_id })
  ) {
    fail(
      TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "candidate version binding is incomplete or non-canonical"
    );
  }

  return binding;
}

export function deriveTerminalWkCandidateVersionIdentity({ binding } = {}) {
  const authenticatedBinding =
    assertTerminalWkCandidateVersionIdentityBinding(binding);
  const tuple = {
    repository: {
      root: authenticatedBinding.repository.root,
      common_dir: authenticatedBinding.repository.common_dir,
      object_format: authenticatedBinding.repository.object_format,
      digest: authenticatedBinding.repository.digest
    },
    canonical_wk_id: authenticatedBinding.canonical_wk_id,
    base: authenticatedBinding.base,
    wk_tip: authenticatedBinding.wk_tip,
    controlled_generation: authenticatedBinding.controlled_generation,
    candidate_tree: authenticatedBinding.candidate_tree,
    candidate_format: authenticatedBinding.schema_version,
    candidate: authenticatedBinding.candidate
  };
  return createHash("sha256")
    .update(JSON.stringify(tuple), "utf8")
    .digest("hex");
}

export const TERMINAL_WK_CANDIDATE_VERSION_DECISION_SCHEMA_VERSION =
  "agent_launch.terminal_wk_candidate.version_decision.v1";

const terminalCandidateVersionDecisions = new WeakSet();

function mintTerminalWkCandidateVersionDecision({
  binding,
  versionIdentity,
  versionRef,
  versionTarget,
  currentTarget
}) {
  const state = versionTarget === null
    ? "unpublished"
    : versionTarget !== binding.candidate
      ? "conflict"
      : currentTarget === binding.candidate
        ? "selected"
        : currentTarget === null
          ? "recovery"
          : "superseded";
  const decision = Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_VERSION_DECISION_SCHEMA_VERSION,
    state,
    repository_digest: binding.repository.digest,
    canonical_wk_id: binding.canonical_wk_id,
    version_identity: versionIdentity,
    immutable_version_ref: versionRef,
    immutable_version_target: versionTarget,
    current_selection_ref: binding.candidate_ref,
    current_selection_observation: currentTarget,
    candidate: binding.candidate,
    base: binding.base,
    wk: binding.wk_tip,
    controlled_generation:
      projectAuthenticatedControlledContractGeneration(binding.controlled_generation),
    tree: binding.candidate_tree,
    candidate_format: binding.schema_version
  });
  terminalCandidateVersionDecisions.add(decision);
  return decision;
}

export function assertTerminalWkCandidateVersionDecision(
  decision,
  { binding = null, requireSelected = false } = {}
) {
  if (!isPlainObject(decision) || !Object.isFrozen(decision) ||
      !terminalCandidateVersionDecisions.has(decision) ||
      decision.schema_version !== TERMINAL_WK_CANDIDATE_VERSION_DECISION_SCHEMA_VERSION ||
      (requireSelected && decision.state !== "selected")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      "candidate version decision is unauthenticated or inapplicable");
  }
  if (binding !== null) {
    const versionIdentity = deriveTerminalWkCandidateVersionIdentity({ binding });
    const versionRef = deriveTerminalCandidateVersionRef({
      canonicalWkId: binding.canonical_wk_id,
      versionIdentity
    });
    if (decision.repository_digest !== binding.repository.digest ||
        decision.canonical_wk_id !== binding.canonical_wk_id ||
        decision.version_identity !== versionIdentity ||
        decision.immutable_version_ref !== versionRef ||
        decision.candidate !== binding.candidate || decision.base !== binding.base ||
        decision.wk !== binding.wk_tip || decision.tree !== binding.candidate_tree ||
        decision.candidate_format !== binding.schema_version ||
        decision.current_selection_ref !== binding.candidate_ref ||
        canonicalizeGeneration(decision.controlled_generation) !==
          canonicalizeGeneration(projectAuthenticatedControlledContractGeneration(
            binding.controlled_generation
          ))) {
      fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
        "candidate version decision disagrees with its exact binding");
    }
  }
  return decision;
}

function canonicalizeGeneration(value) {
  return JSON.stringify(value);
}

export async function inspectTerminalWkCandidateVersion({
  binding,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  const versionIdentity = deriveTerminalWkCandidateVersionIdentity({ binding });
  const versionRef = deriveTerminalCandidateVersionRef({
    canonicalWkId: binding.canonical_wk_id,
    versionIdentity
  });
  const [versionTarget, currentTarget] = await Promise.all([
    observeExactDirectCommitRef({
      mainRepo: binding.main_repo,
      ref: versionRef,
      runGit,
      subject: "immutable candidate version ref",
      objectFormat: binding.repository.object_format
    }),
    observeExactDirectCommitRef({
      mainRepo: binding.main_repo,
      ref: binding.candidate_ref,
      runGit,
      subject: "current candidate selection ref",
      objectFormat: binding.repository.object_format
    })
  ]);
  return mintTerminalWkCandidateVersionDecision({
    binding,
    versionIdentity,
    versionRef,
    versionTarget,
    currentTarget
  });
}

export async function observeExactDirectCommitRef({ mainRepo, ref, runGit, subject, objectFormat = null }) {
  const observed = await runGit({
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
      (observed?.status !== undefined && observed.status !== 0)) {
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
  if (!oidReForObjectFormat(objectFormat).test(rawTarget) || /^0+$/u.test(rawTarget)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} target is not a canonical object id`, { ref });
  }
  if (objectType !== "commit") {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
      `${subject} target is not a commit`, { ref, object: rawTarget });
  }
  return rawTarget;
}

export async function readExactWkRecordBlobObservation({
  mainRepo,
  wkTip,
  canonicalWkId,
  runGit = defaultTerminalCandidateRunGit,
  objectFormat
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !["sha1", "sha256"].includes(objectFormat) ||
      !oidReForObjectFormat(objectFormat).test(wkTip ?? "") ||
      !WK_RE.test(canonicalWkId ?? "") || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "WK record observation inputs are invalid");
  }
  const recordPath = `wiki/work-records/${canonicalWkId}.json`;
  const result = await runGit({
    repo: mainRepo,
    args: authorityGitArgs(["ls-tree", "-z", "--full-tree", wkTip, "--", recordPath]),
    env: null
  });
  if (!result || result.ok !== true || result.error != null || result.signal != null ||
      (result.status !== undefined && result.status !== 0)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not observe exact WK record path", {
      path: recordPath, status: result?.status ?? null, stderr: result?.stderr ?? result?.error ?? null
    });
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : null;
  if (stdout === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is malformed", { path: recordPath });
  }
  if (stdout === "") return Object.freeze({ state: "absent", path: recordPath, wk_tip: wkTip });
  if (!stdout.endsWith("\0")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is malformed", { path: recordPath });
  }
  const entries = stdout.slice(0, -1).split("\0");
  if (entries.length !== 1) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is ambiguous", { path: recordPath });
  }
  const match = /^(\d{6}) (blob|tree) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)$/u.exec(entries[0]);
  if (match === null || match[1] !== "100644" || match[2] !== "blob" || match[4] !== recordPath ||
      /^0+$/u.test(match[3]) || !oidReForObjectFormat(objectFormat).test(match[3])) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is not one canonical blob", {
      path: recordPath
    });
  }
  const oid = match[3];
  const blobResult = await runGit({ repo: mainRepo, args: authorityGitArgs(["cat-file", "blob", oid]), env: null });
  if (!blobResult || blobResult.ok !== true || blobResult.error != null || blobResult.signal != null ||
      (blobResult.status !== undefined && blobResult.status !== 0)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not read exact WK record blob", {
      path: recordPath, oid, status: blobResult?.status ?? null,
      stderr: blobResult?.stderr ?? blobResult?.error ?? null
    });
  }
  if (typeof blobResult.stdout !== "string") {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record blob is unreadable", { path: recordPath, oid });
  }
  return Object.freeze({ state: "present", path: recordPath, wk_tip: wkTip, oid, content: blobResult.stdout });
}

export async function inspectTerminalReviewCandidateAuthority({
  mainRepo,
  initiative,
  canonicalWkId,
  generationAuthentication = null,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !INITIATIVE_RE.test(initiative ?? "") || !WK_RE.test(canonicalWkId ?? "") || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "candidate inspection inputs are invalid");
  }
  const repository = await resolveRepositoryIdentity(mainRepo, runGit);
  const refs = deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId });
  const candidateRef = deriveTerminalCandidateCurrentRef({ canonicalWkId });
  const candidate = await observeExactDirectCommitRef({ mainRepo, ref: candidateRef, runGit, subject: "current candidate ref", objectFormat: repository.object_format });
  const fork = await observeExactDirectCommitRef({ mainRepo, ref: refs.fork_ref, runGit, subject: "durable fork ref", objectFormat: repository.object_format });
  const wk = await observeExactDirectCommitRef({ mainRepo, ref: refs.wk_ref, runGit, subject: "durable WK ref", objectFormat: repository.object_format });
  const directRefAvailability = Object.freeze({
    candidate: candidate !== null,
    fork: fork !== null,
    wk: wk !== null
  });
  const snapshot = {
    candidate_ref: candidateRef,
    fork_ref: refs.fork_ref,
    wk_ref: refs.wk_ref,
    direct_ref_availability: directRefAvailability
  };
  if (candidate === null) return Object.freeze({ ...snapshot, state: "absent" });
  const currentGeneration = generationFromInput(
    generationAuthentication, mainRepo, canonicalWkId);
  assertGenerationForCandidate(currentGeneration, { mainRepo, canonicalWkId, wkTip: wk });
  const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  const generationIdentityEqual = authenticatedControlledContractGenerationMatchesMetadata(
    currentGeneration, metadata.controlled_generation);
  const wkIdentityEqual = metadata.canonical_wk_id === canonicalWkId;
  const repositoryBindingEqual = metadata.repository_digest === repository.digest;
  const causes = [];
  if (!wkIdentityEqual) causes.push("wk_identity_mismatch");
  if (!repositoryBindingEqual) causes.push("repository_digest_mismatch");
  if (!generationIdentityEqual) causes.push("generation_identity_mismatch");
  if (fork === null || wk === null) {
    const absenceCauses = [];
    if (fork === null) absenceCauses.push("fork_ref_absent");
    if (wk === null) absenceCauses.push("wk_ref_absent");
    return Object.freeze({ ...snapshot, state: "incomplete", absence_causes: Object.freeze(absenceCauses) });
  }
  const tree = await git(runGit, mainRepo, ["rev-parse", `${candidate}^{tree}`], { message: "could not resolve candidate tree" });
  const embeddedWTree = await git(runGit, mainRepo, ["rev-parse", `${metadata.wk_tip}^{tree}`], { message: "could not resolve embedded W tree" });
  const wkTree = await git(runGit, mainRepo, ["rev-parse", `${wk}^{tree}`], { message: "could not resolve current WK tree" });
  const parents = (await git(runGit, mainRepo, ["rev-list", "--parents", "-n", "1", candidate], { message: "could not resolve candidate parent" })).split(/\s+/u);
  const embeddedWEqualCurrentW = metadata.wk_tip === wk;
  const treeEqual = tree === embeddedWTree;
  const soleParentBase = parents.length === 2 && parents[0] === candidate && parents[1] === metadata.base;
  const forkEqualBase = fork === metadata.base;
  const ancestor = await runGit({ repo: mainRepo, args: authorityGitArgs(["merge-base", "--is-ancestor", metadata.base, wk]), env: null });
  if (!ancestor || ancestor.ok !== true) {
    if (ancestor?.status !== 1) fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      "could not observe whether embedded B is an ancestor of current W", {
        args: ["merge-base"],
        status: ancestor?.status ?? null, base: metadata.base, wk_tip: wk,
        stderr: ancestor?.stderr ?? ancestor?.error ?? null
      });
  }
  const baseAncestorCurrentW = ancestor?.status === 1 ? false : ancestor?.ok === true;
  if (!treeEqual) causes.push("candidate_tree_mismatch");
  if (!soleParentBase) causes.push("sole_parent_mismatch");
  if (!forkEqualBase) causes.push("fork_base_mismatch");
  if (!baseAncestorCurrentW) causes.push("non_ancestor");
  const movementCauses = embeddedWEqualCurrentW ? [] : ["w_moved"];
  return Object.freeze({ ...snapshot, state: "observed", candidate_oid: candidate, schema_version: metadata.schema_version, embedded_base: metadata.base,
    embedded_wk: metadata.wk_tip, current_base: fork, current_wk: wk, candidate_tree: tree, embedded_w_tree: embeddedWTree, current_wk_tree: wkTree,
    wk_identity_equal: wkIdentityEqual, repository_binding_equal: repositoryBindingEqual,
    generation_identity: metadata.controlled_generation,
    current_generation_identity: projectAuthenticatedControlledContractGeneration(currentGeneration),
    generation_identity_equal: generationIdentityEqual,
    tree_equal: treeEqual, sole_parent_base: soleParentBase,
    fork_equal_base: forkEqualBase, base_ancestor_current_w: baseAncestorCurrentW,
    embedded_w_equal_current_w: embeddedWEqualCurrentW, current_w_tree_equal_embedded_w_tree: wkTree === embeddedWTree,
    invariant_causes: Object.freeze(causes), movement_causes: Object.freeze(movementCauses) });
}

export async function readTerminalCandidateCurrentRef({
  mainRepo,
  canonicalWkId,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate lookup inputs are invalid");
  }
  return await observeExactDirectCommitRef({
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
    fork_ref: `refs/agent-launch/wk-forks/${initiative}/${canonicalWkId}`,
    candidates_ref: `${VERSIONED_CANDIDATE_REF_PREFIX}/${canonicalWkId}`
  });
}

export function deriveTerminalCandidateVersionRef({ canonicalWkId, versionIdentity } = {}) {
  if (!WK_RE.test(canonicalWkId ?? "") ||
      typeof versionIdentity !== "string" || !/^[0-9a-f]{64}$/u.test(versionIdentity)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "immutable candidate version ref inputs are invalid");
  }
  return `${VERSIONED_CANDIDATE_REF_PREFIX}/${canonicalWkId}/${versionIdentity}`;
}

async function createImmutableCandidateRef({ mainRepo, ref, candidate, runGit }) {
  const observed = await observeExactDirectCommitRef({
    mainRepo, ref, runGit, subject: "immutable candidate version ref"
  });
  if (observed !== null) {
    if (observed === candidate) return "converged";
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
      "immutable candidate version ref already names a different candidate", {
        ref, expected: candidate, actual: observed
      });
  }
  const result = await runGit({
    repo: mainRepo,
    args: authorityGitArgs(["update-ref", "--no-deref", "--stdin"]),
    input: `create ${ref} ${candidate}\n`,
    env: null
  });
  if (result?.ok === true && (result.status === undefined || result.status === 0) &&
      result.error == null && result.signal == null && String(result.stderr ?? "") === "") {
    return "created";
  }
  const winner = await observeExactDirectCommitRef({
    mainRepo, ref, runGit, subject: "immutable candidate version ref"
  });
  if (winner === candidate) return "converged";
  fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    "immutable candidate version ref could not be created", { ref, expected: candidate });
}

export async function publishTerminalWkCandidateVersion({
  binding,
  expectedOld,
  verifyRefs = [],
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  const versionIdentity = deriveTerminalWkCandidateVersionIdentity({ binding });
  const versionRef = deriveTerminalCandidateVersionRef({
    canonicalWkId: binding.canonical_wk_id, versionIdentity
  });
  const versionState = await createImmutableCandidateRef({
    mainRepo: binding.main_repo, ref: versionRef, candidate: binding.candidate, runGit
  });
  const selection = await casTerminalCandidateCurrentRef({
    mainRepo: binding.main_repo,
    canonicalWkId: binding.canonical_wk_id,
    candidate: binding.candidate,
    expectedOld,
    verifyRefs,
    runGit
  });
  const versionDecision = await inspectTerminalWkCandidateVersion({ binding, runGit });
  assertTerminalWkCandidateVersionDecision(versionDecision, {
    binding,
    requireSelected: true
  });
  return Object.freeze({ ...binding, version_identity: versionIdentity,
    version_ref: versionRef, version_state: versionState, selection,
    candidate_ref_state: selection.state,
    current_selection_observation: versionDecision.current_selection_observation,
    version_decision: versionDecision });
}

function durableForkRefForWkRef(wkRef) {
  const match = WK_REF_RE.exec(wkRef ?? "");
  if (match === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "durable WK ref is not canonical");
  }
  return deriveTerminalCandidateDurableRefs({ initiative: match[1], canonicalWkId: match[2] }).fork_ref;
}

export async function casTerminalCandidateCurrentRef({
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
  const advanced = await runGit({
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

  const reauthenticated = await Promise.all(verifyRefs.map(async ({ ref, oid }) => ({
    ref,
    expected: oid,
    actual: await observeExactDirectCommitRef({
      mainRepo,
      ref,
      runGit,
      subject: `verified ${ref}`
    })
  })));
  const current = await readTerminalCandidateCurrentRef({ mainRepo, canonicalWkId, runGit });
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
  const generation = frozen.controlled_generation;
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
    `Generation-Digest: ${generation.generation_digest}`,
    `Generation-Count: ${generation.count}`,
    `Manifest-Identity: ${generation.manifest_identity}`,
    ...generation.descriptors.map(({ path: carrierPath, content_digest: contentDigest }) =>
      `Carrier: ${carrierPath} ${contentDigest}`),
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

export async function readTerminalWkCandidateMetadata({
  mainRepo,
  candidate,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || !OID_RE.test(candidate ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "candidate contract lookup inputs are invalid");
  }
  const commitBytes = await gitRaw(runGit, mainRepo, ["cat-file", "commit", candidate], {
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
  const generationDigest = exactlyOnce(/^Generation-Digest: (sha256:[0-9a-f]{64})$/gmu);
  const generationCountText = exactlyOnce(/^Generation-Count: ([1-9][0-9]*)$/gmu);
  const manifestIdentity = exactlyOnce(/^Manifest-Identity: (sha256:[0-9a-f]{64})$/gmu);
  const carriers = [...commitBytes.matchAll(/^Carrier: ([^\n ]+) (sha256:[0-9a-f]{64})$/gmu)]
    .map((match) => ({ path: match[1], content_digest: match[2] }));

  const v2 = canonicalWkDigest !== null && reviewSubject === null && reviewContractDigest === null;
  const v3 = canonicalWkDigest === null && reviewSubject !== null && reviewContractDigest !== null &&
    commitBytes.includes(`Review-Contract: ${reviewContractDigest}\n`);
  if (firstLine === null || base === null || wkTip === null || repositoryDigest === null ||
      generationDigest === null || generationCountText === null || manifestIdentity === null ||
      carriers.length !== Number(generationCountText) ||
      new Set(carriers.map(({ path: carrierPath }) => carrierPath)).size !== carriers.length ||
      carriers.some(({ path: carrierPath }, index) => index > 0 && carriers[index - 1].path >= carrierPath) ||
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
    terminal_review_contract_digest: reviewContractDigest,
    controlled_generation: authenticatedControlledContractGenerationMetadataFromFields({
      wkId: firstLine[1],
      generationDigest,
      count: Number(generationCountText),
      manifestIdentity,

      descriptors: carriers
    })
  });
}

async function deriveTerminalWkCandidateIdentityWithGuard({ frozen, runGit, assertFacts }) {
  await assertFacts({ frozen, runGit });

  const treeArgs = ["rev-parse", "--verify", `${frozen.wk_tip}^{tree}`];
  const treeResult = await runGit({ repo: frozen.main_repo, args: authorityGitArgs(treeArgs), env: null });
  if (!treeResult || treeResult.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not resolve the accumulated WK tree", {
      args: authorityGitArgs(treeArgs),
      status: treeResult?.status ?? null,
      stderr: String(treeResult?.stderr ?? treeResult?.error ?? "").slice(0, 8192)
    });
  }
  const tree = canonicalOid(String(treeResult.stdout ?? "").split(/\r?\n/u)[0], "candidate tree");
  await assertFacts({ frozen, runGit });
  const objectFormat = await git(runGit, frozen.main_repo, ["rev-parse", "--show-object-format"], {
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
  await assertFacts({ frozen, runGit });
  return Object.freeze({

    ...frozen,
    candidate,
    candidate_tree: tree,
    candidate_parent: frozen.base,
    candidate_ref: deriveTerminalCandidateCurrentRef({ canonicalWkId: frozen.canonical_wk_id }),
    candidate_ref_state: "derived"
  });
}

export async function deriveTerminalWkCandidateIdentity({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return await deriveTerminalWkCandidateIdentityWithGuard({
    frozen,
    runGit,
    assertFacts: assertTerminalWkCandidateInputsUnmoved
  });
}

export async function deriveRecoveredTerminalWkCandidateIdentity({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return await deriveTerminalWkCandidateIdentityWithGuard({
    frozen,
    runGit,
    assertFacts: assertTerminalWkCandidatePublicationFactsUnmoved
  });
}

export async function deriveTerminalWkCandidate({ frozen, runGit = defaultTerminalCandidateRunGit } = {}) {
  const identity = await deriveTerminalWkCandidateIdentity({ frozen, runGit });
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
  const candidate = canonicalOid(await git(runGit, frozen.main_repo, [
    "commit-tree", identity.candidate_tree, "-p", frozen.base, "-m", deterministicMessage(frozen)
  ], { message: "could not create deterministic terminal candidate", env: commitEnv }), "candidate commit");
  if (candidate !== identity.candidate) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "git commit-tree disagrees with deterministic candidate bytes", {
        expected: identity.candidate,
        actual: candidate
      });
  }
  const parentLine = (await git(runGit, frozen.main_repo, ["rev-list", "--parents", "-n", "1", candidate], {
    message: "could not verify candidate parent"
  })).split(/\s+/u);
  const observedTree = await git(runGit, frozen.main_repo, ["rev-parse", `${candidate}^{tree}`], {
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
  await assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });
  return identity;
}

export async function constructTerminalWkCandidate({ frozen, runGit = defaultTerminalCandidateRunGit } = {}) {
  assertFrozenShape(frozen);
  const expectedOld = await readTerminalCandidateCurrentRef({
    mainRepo: frozen.main_repo,
    canonicalWkId: frozen.canonical_wk_id,
    runGit
  });
  const derived = await deriveTerminalWkCandidate({ frozen, runGit });
  const refState = await casTerminalCandidateCurrentRef({
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

export async function verifyTerminalWkCandidateObjectBinding({ binding, runGit = defaultTerminalCandidateRunGit } = {}) {
  if (!isPlainObject(binding) || !Object.isFrozen(binding) ||
      !TERMINAL_WK_CANDIDATE_SCHEMA_VERSIONS.has(binding.schema_version) ||
      !OID_RE.test(binding.candidate ?? "") || !OID_RE.test(binding.candidate_tree ?? "") ||
      binding.candidate_parent !== binding.base ||
      binding.candidate_ref !== deriveTerminalCandidateCurrentRef({ canonicalWkId: binding.canonical_wk_id })) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, "candidate binding shape is invalid");
  }
  await assertTerminalWkCandidatePublicationFactsUnmoved({ frozen: binding, runGit });
  const observedCommitBytes = await gitRaw(runGit, binding.main_repo, ["cat-file", "commit", binding.candidate], {
    message: "could not read exact terminal candidate commit bytes"
  });
  const checks = [
    ["candidate_tree", await git(runGit, binding.main_repo, ["rev-parse", `${binding.candidate}^{tree}`]), binding.candidate_tree],
    [
      "candidate_commit_bytes",
      observedCommitBytes,
      deterministicCommitBytes({ frozen: binding, tree: binding.candidate_tree })
    ]
  ];
  const parentLine = (await git(runGit, binding.main_repo, ["rev-list", "--parents", "-n", "1", binding.candidate])).split(/\s+/u);
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
