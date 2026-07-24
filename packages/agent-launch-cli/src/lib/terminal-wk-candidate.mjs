import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export const TERMINAL_WK_CANDIDATE_SCHEMA_VERSION = "agent_launch.terminal_wk_candidate.v1";

export const TERMINAL_WK_CANDIDATE_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.terminal_wk_candidate.invalid_argument.v1",
  GIT_FAILED: "agent_launch.terminal_wk_candidate.git_failed.v1",
  MERGE_BASE_INVALID: "agent_launch.terminal_wk_candidate.merge_base_invalid.v1",
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
const WK_REF_RE = /^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u;
const LANDING_REF_RE = /^refs\/heads\/(?!wk\/|slice\/|handoff\/)[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CURRENT_CANDIDATE_REF_PREFIX = "refs/agent-launch/terminal-current";

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

export function defaultTerminalCandidateRunGit({ repo, args, env = null }) {
  const result = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
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

function git(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const result = runGit({ repo, args, env });
  if (!result || result.ok !== true) {
    fail(code, message ?? `git ${args[0]} failed`, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return String(result.stdout ?? "").trim();
}

function gitRaw(runGit, repo, args, { code = TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, message, env = null } = {}) {
  const result = runGit({ repo, args, env });
  if (!result || result.ok !== true) {
    fail(code, message ?? `git ${args[0]} failed`, {
      args,
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

function assertAncestor(runGit, repo, ancestor, descendant, label) {
  const result = runGit({ repo, args: ["merge-base", "--is-ancestor", ancestor, descendant], env: null });
  if (!result || result.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID, `merge base is not an ancestor of ${label}`, {
      ancestor,
      descendant,
      status: result?.status ?? null
    });
  }
}

export function freezeTerminalWkCandidateInputs({
  mainRepo,
  landingRef,
  wkRef,
  canonicalWkId,
  canonicalWkDigest,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      typeof landingRef !== "string" || !LANDING_REF_RE.test(landingRef) ||
      typeof wkRef !== "string" || !WK_REF_RE.test(wkRef) ||
      typeof canonicalWkId !== "string" || !WK_RE.test(canonicalWkId) ||
      !wkRef.endsWith(`/${canonicalWkId}`) ||
      typeof canonicalWkDigest !== "string" || !DIGEST_RE.test(canonicalWkDigest) ||
      typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "launcher-owned candidate inputs are incomplete or invalid");
  }
  const repository = resolveRepositoryIdentity(mainRepo, runGit);
  const landingTip = resolveRef(runGit, mainRepo, landingRef, "landing tip");
  const wkTip = resolveRef(runGit, mainRepo, wkRef, "WK tip");
  const baseResult = runGit({ repo: mainRepo, args: ["merge-base", "--all", landingTip, wkTip], env: null });
  if (!baseResult || baseResult.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID, "could not resolve merge base", {
      status: baseResult?.status ?? null,
      stderr: baseResult?.stderr ?? baseResult?.error ?? null
    });
  }
  const bases = String(baseResult.stdout ?? "").split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (bases.length !== 1 || !OID_RE.test(bases[0]) || /^0+$/u.test(bases[0])) {
    fail(TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID, "exactly one canonical merge base is required", {
      count: bases.length,
      bases
    });
  }
  const mergeBase = bases[0];
  assertAncestor(runGit, mainRepo, mergeBase, landingTip, "landing tip");
  assertAncestor(runGit, mainRepo, mergeBase, wkTip, "WK tip");
  return Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: canonicalWkDigest,
    landing_ref: landingRef,
    landing_tip: landingTip,
    wk_ref: wkRef,
    wk_tip: wkTip,
    merge_base: mergeBase
  });
}

export function freezeRecoveredTerminalWkCandidateInputs({
  mainRepo,
  landingRef,
  wkRef,
  canonicalWkId,
  candidate,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      typeof landingRef !== "string" || !LANDING_REF_RE.test(landingRef) ||
      typeof wkRef !== "string" || !WK_REF_RE.test(wkRef) ||
      typeof canonicalWkId !== "string" || !WK_RE.test(canonicalWkId) ||
      !wkRef.endsWith(`/${canonicalWkId}`) ||
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
  const landingTip = parentLine[1];
  if (landingTip !== metadata.landing_tip) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered candidate parent disagrees with immutable landing metadata");
  }
  const wkTip = resolveRef(runGit, mainRepo, wkRef, "WK tip");
  if (wkTip !== metadata.wk_tip) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
      "accumulated WK ref moved after candidate construction", {
        expected: metadata.wk_tip,
        actual: wkTip
      });
  }
  const baseResult = runGit({ repo: mainRepo, args: ["merge-base", "--all", landingTip, wkTip], env: null });
  if (!baseResult || baseResult.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID, "could not resolve recovered merge base", {
      status: baseResult?.status ?? null,
      stderr: baseResult?.stderr ?? baseResult?.error ?? null
    });
  }
  const bases = String(baseResult.stdout ?? "").split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (bases.length !== 1 || !OID_RE.test(bases[0]) || /^0+$/u.test(bases[0])) {
    fail(TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID,
      "exactly one recovered canonical merge base is required", { count: bases.length, bases });
  }
  const mergeBase = bases[0];
  if (mergeBase !== metadata.merge_base) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "recovered merge base disagrees with immutable candidate metadata");
  }
  assertAncestor(runGit, mainRepo, mergeBase, landingTip, "frozen candidate parent");
  assertAncestor(runGit, mainRepo, mergeBase, wkTip, "WK tip");
  return Object.freeze({
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
    repository,
    main_repo: mainRepo,
    canonical_wk_id: canonicalWkId,
    canonical_wk_digest: metadata.canonical_wk_digest,
    landing_ref: landingRef,
    landing_tip: landingTip,
    wk_ref: wkRef,
    wk_tip: wkTip,
    merge_base: mergeBase
  });
}

function assertFrozenShape(frozen) {
  if (!isPlainObject(frozen) || !Object.isFrozen(frozen) ||
      frozen.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION ||
      !isPlainObject(frozen.repository) || !Object.isFrozen(frozen.repository) ||
      typeof frozen.main_repo !== "string" || !path.isAbsolute(frozen.main_repo) ||
      !WK_RE.test(frozen.canonical_wk_id ?? "") || !DIGEST_RE.test(frozen.canonical_wk_digest ?? "") ||
      !LANDING_REF_RE.test(frozen.landing_ref ?? "") || !WK_REF_RE.test(frozen.wk_ref ?? "") ||
      !OID_RE.test(frozen.landing_tip ?? "") || !OID_RE.test(frozen.wk_tip ?? "") ||
      !OID_RE.test(frozen.merge_base ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "frozen candidate tuple is incomplete or untrusted");
  }
  return frozen;
}

function assertTerminalWkCandidateFactsUnmoved({
  frozen,
  requireLandingRefAtFrozenTip,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  assertFrozenShape(frozen);
  const observedRepository = resolveRepositoryIdentity(frozen.main_repo, runGit);
  const checks = [
    ["repository", observedRepository.digest, frozen.repository.digest],
    ["wk_tip", resolveRef(runGit, frozen.main_repo, frozen.wk_ref, "WK tip"), frozen.wk_tip]
  ];
  if (requireLandingRefAtFrozenTip) {
    checks.push([
      "landing_tip",
      resolveRef(runGit, frozen.main_repo, frozen.landing_ref, "landing tip"),
      frozen.landing_tip
    ]);
  }
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED, `frozen ${mismatch[0]} moved`, {
      field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
    });
  }
  return frozen;
}

export function assertTerminalWkCandidateInputsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return assertTerminalWkCandidateFactsUnmoved({
    frozen,
    requireLandingRefAtFrozenTip: true,
    runGit
  });
}

export function assertTerminalWkCandidatePublicationFactsUnmoved({
  frozen,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  return assertTerminalWkCandidateFactsUnmoved({
    frozen,
    requireLandingRefAtFrozenTip: false,
    runGit
  });
}

export function deriveTerminalCandidateCurrentRef({ canonicalWkId } = {}) {
  if (!WK_RE.test(canonicalWkId ?? "")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate ref input is invalid");
  }
  return `${CURRENT_CANDIDATE_REF_PREFIX}/${canonicalWkId}`;
}

export function readTerminalCandidateCurrentRef({
  mainRepo,
  canonicalWkId,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "current candidate lookup inputs are invalid");
  }
  const ref = deriveTerminalCandidateCurrentRef({ canonicalWkId });
  const observed = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], env: null });
  if (observed?.ok === true) return canonicalOid(String(observed.stdout ?? "").trim(), "current candidate");
  if (observed?.status === 1) return null;
  fail(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "current candidate ref could not be observed", {
    ref,
    status: observed?.status ?? null,
    stderr: observed?.stderr ?? observed?.error ?? null
  });
}

export function casTerminalCandidateCurrentRef({
  mainRepo,
  canonicalWkId,
  candidate,
  expectedOld,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  const candidateRef = deriveTerminalCandidateCurrentRef({ canonicalWkId });
  canonicalOid(candidate, "candidate");
  if (expectedOld !== null) canonicalOid(expectedOld, "expected current candidate");
  const advanced = runGit({
    repo: mainRepo,
    args: ["update-ref", candidateRef, candidate, expectedOld ?? ""],
    env: null
  });
  if (advanced?.ok === true) {
    return Object.freeze({
      state: expectedOld === null ? "created" : expectedOld === candidate ? "current" : "advanced",
      ref: candidateRef,
      candidate
    });
  }
  const current = readTerminalCandidateCurrentRef({ mainRepo, canonicalWkId, runGit });
  if (current === candidate) return Object.freeze({ state: "converged", ref: candidateRef, candidate });
  fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    "current candidate expected-old CAS lost to another identity", {
      ref: candidateRef,
      expected_old: expectedOld,
      proposed: candidate,
      actual: current
    });
}

function deterministicMessage(frozen) {
  return [
    `${frozen.canonical_wk_id}: terminal landing candidate`,
    "",
    `Landing: ${frozen.landing_tip}`,
    `WK: ${frozen.wk_tip}`,
    `Merge-base: ${frozen.merge_base}`,
    `Repository: ${frozen.repository.digest}`,
    `Contract: ${frozen.canonical_wk_digest}`,
    ""
  ].join("\n");
}

function deterministicCommitBytes({ frozen, tree }) {
  const timestamp = Math.floor(Date.parse(TERMINAL_WK_CANDIDATE_IDENTITY.date) / 1000);
  const identity = `${TERMINAL_WK_CANDIDATE_IDENTITY.name} <${TERMINAL_WK_CANDIDATE_IDENTITY.email}> ${timestamp} +0000`;
  return [
    `tree ${tree}`,
    `parent ${frozen.landing_tip}`,
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
  const firstLine = /^((?:WK-\d{4})): terminal landing candidate$/mu.exec(commitBytes);
  const fields = Object.fromEntries([
    ["landing_tip", /^Landing: ([0-9a-f]{40}|[0-9a-f]{64})$/gmu],
    ["wk_tip", /^WK: ([0-9a-f]{40}|[0-9a-f]{64})$/gmu],
    ["merge_base", /^Merge-base: ([0-9a-f]{40}|[0-9a-f]{64})$/gmu],
    ["repository_digest", /^Repository: (sha256:[0-9a-f]{64})$/gmu],
    ["canonical_wk_digest", /^Contract: (sha256:[0-9a-f]{64})$/gmu]
  ].map(([field, pattern]) => {
    const matches = [...commitBytes.matchAll(pattern)];
    return [field, matches.length === 1 ? matches[0][1] : null];
  }));
  if (firstLine === null || Object.values(fields).some((value) => value === null) ||
      !commitBytes.endsWith(`Contract: ${fields.canonical_wk_digest}\n`)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "candidate commit does not carry one exact immutable terminal metadata block");
  }
  return Object.freeze({ canonical_wk_id: firstLine[1], ...fields });
}

function deriveTerminalWkCandidateIdentityWithGuard({ frozen, runGit, assertFacts }) {
  assertFacts({ frozen, runGit });
  const merge = runGit({
    repo: frozen.main_repo,
    args: [
      "merge-tree", "--write-tree", "--no-messages",
      "--merge-base", frozen.merge_base,
      frozen.landing_tip,
      frozen.wk_tip
    ],
    env: null
  });
  if (!merge || merge.ok !== true) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CONFLICT, "complete WK change conflicts with the frozen landing tip", {
      status: merge?.status ?? null,
      stdout: String(merge?.stdout ?? "").slice(0, 8192),
      stderr: String(merge?.stderr ?? merge?.error ?? "").slice(0, 8192)
    });
  }
  const tree = canonicalOid(String(merge.stdout ?? "").split(/\r?\n/u)[0], "candidate tree");
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
    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
    ...frozen,
    candidate,
    candidate_tree: tree,
    candidate_parent: frozen.landing_tip,
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
    "commit-tree", identity.candidate_tree, "-p", frozen.landing_tip, "-m", deterministicMessage(frozen)
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
  if (parentLine.length !== 2 || parentLine[0] !== candidate || parentLine[1] !== frozen.landing_tip ||
      observedTree !== identity.candidate_tree) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "candidate does not have the exact tree and sole landing parent", {
      candidate,
      parents: parentLine.slice(1),
      expected_parent: frozen.landing_tip,
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
    runGit
  });
  assertTerminalWkCandidateInputsUnmoved({ frozen, runGit });
  return Object.freeze({
    ...derived,
    candidate_ref_state: refState.state
  });
}

export function verifyTerminalWkCandidateObjectBinding({ binding, runGit = defaultTerminalCandidateRunGit } = {}) {
  if (!isPlainObject(binding) || !Object.isFrozen(binding) ||
      binding.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION ||
      !OID_RE.test(binding.candidate ?? "") || !OID_RE.test(binding.candidate_tree ?? "") ||
      binding.candidate_parent !== binding.landing_tip ||
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
  if (parentLine.length !== 2 || parentLine[1] !== binding.landing_tip) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, "candidate parent binding moved or disagrees", {
      expected: binding.landing_tip,
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
