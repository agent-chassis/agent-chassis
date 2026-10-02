import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  controlledContractGenerationDigest,
  resolveControlledContractAttachmentGeneration,
  validateControlledContractAttachmentGenerationDescriptors
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  assertAuthenticatedControlledContractGeneration,
  assertResolvedControlledContractGenerationsEqual,
  authenticatedControlledContractGenerationsEqual,
  constructAuthenticatedControlledContractGeneration
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import { createControlledContractGenerationTreeOperations } from
  "./controlled-contract-generation-tree.mjs";

const WK_ID_PATTERN = /^WK-[0-9]{4}$/;
const INITIATIVE_PATTERN = /^IN-[0-9]{4}$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GIT_INERT_CONFIG = Object.freeze([
  "-c", "core.autocrlf=false",
  "-c", "core.eol=lf",
  "-c", "core.symlinks=true",
  "-c", "core.hooksPath=",
  "-c", "core.fsmonitor="
]);

const STRUCTURAL_DIFF_ARGS = Object.freeze([
  "--no-replace-objects",
  ...GIT_INERT_CONFIG,
  "diff-tree",
  "--no-commit-id",
  "--raw",
  "-r",
  "-z",
  "--no-renames",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-abbrev"
]);

const CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_RECEIPT_VERSION =
  "controlled-contract-generation-persistence-receipt.v1";
const RECEIPT_FIELDS = Object.freeze([
  "schema_version", "record_id", "initiative", "ref", "record_source_digest",
  "bound_tip", "final_tip", "disposition", "invocation", "generation"
]);
const RECEIPT_INVOCATION_FIELDS = Object.freeze([
  "commit_created", "commit", "ref_write_succeeded"
]);
const RECEIPT_GENERATION_FIELDS = Object.freeze(["count", "digest", "descriptors"]);
const RECEIPT_GENERATION_DESCRIPTOR_FIELDS = Object.freeze(["path", "content_digest"]);
const RECEIPT_DISPOSITIONS = Object.freeze(["created", "observed"]);
const GENERATION_BINDING_FIELDS = Object.freeze([
  "schema_version", "repository", "record_id", "record_source_digest",
  "initiative", "output_branch", "ref", "wk_tip_sha", "generation_count",
  "generation_digest", "descriptors", "resolved_generation", "git_dir"
]);

const COMMITTER = Object.freeze({
  name: "agent-launch controlled-contract persistence",
  email: "controlled-contract-persistence@agent-launch.local"
});

export const CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES = Object.freeze({
  INVALID_INPUT: "agent_launch.controlled_contract_generation.invalid_input.v1",
  BINDING_INVALID: "agent_launch.controlled_contract_generation.binding_invalid.v1",
  SOURCE_CHANGED: "agent_launch.controlled_contract_generation.source_changed.v1",
  LIFECYCLE_MISMATCH: "agent_launch.controlled_contract_generation.lifecycle_mismatch.v1",
  REF_UNRESOLVABLE: "agent_launch.controlled_contract_generation.ref_unresolvable.v1",
  STORED_GENERATION_INVALID: "agent_launch.controlled_contract_generation.stored_generation_invalid.v1",
  GIT_FAILED: "agent_launch.controlled_contract_generation.git_failed.v1",
  STRUCTURAL_DIFF_INVALID: "agent_launch.controlled_contract_generation.structural_diff_invalid.v1",
  W_AUTHENTICATION_FAILED: "agent_launch.controlled_contract_generation.w_authentication_failed.v1",
  CAS_CONFLICT: "agent_launch.controlled_contract_generation.cas_conflict.v1",
  INDETERMINATE: "agent_launch.controlled_contract_generation.indeterminate.v1"
});

export class ControlledContractGenerationPersistenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractGenerationPersistenceError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractGenerationPersistenceError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INVALID_INPUT,
      `${label} must be one plain object`);
  }
  const allowedSet = new Set(allowed);
  const extra = Reflect.ownKeys(value).filter((key) =>
    typeof key !== "string" || !allowedSet.has(key));
  if (extra.length > 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INVALID_INPUT,
      `${label} contains unsupported authority fields`, {
        fields: extra.map(String).sort()
      });
  }
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function allowedGitEnvironment() {
  const names = [
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "SYSTEMROOT", "WINDIR",
    "TMPDIR", "TMP", "TEMP"
  ];
  return Object.fromEntries(names.filter((name) =>
    typeof process.env[name] === "string").map((name) => [name, process.env[name]]));
}

export function defaultControlledContractGenerationRunGit({
  repo = null,
  gitDir = null,
  workTree = null,
  args,
  stdin = null,
  indexFile = null
}) {
  const argv = [];
  if (typeof repo === "string" && repo.length > 0) argv.push("-C", repo);
  if (typeof gitDir === "string" && gitDir.length > 0) argv.push(`--git-dir=${gitDir}`);
  if (typeof workTree === "string" && workTree.length > 0) argv.push(`--work-tree=${workTree}`);
  argv.push(...args);
  const env = allowedGitEnvironment();
  if (typeof indexFile === "string" && indexFile.length > 0) {
    env.GIT_INDEX_FILE = indexFile;
  }
  const result = spawnSync("git", argv, {
    cwd: typeof workTree === "string" && workTree.length > 0 ? workTree : undefined,
    input: stdin,
    env,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return Object.freeze({
      ok: false,
      status: result.status ?? null,
      error: result.error?.code ?? null
    });
  }
  return Object.freeze({ ok: true, stdout: result.stdout ?? Buffer.alloc(0) });
}

function stdoutBytes(result) {
  if (Buffer.isBuffer(result?.stdout)) return result.stdout;
  if (typeof result?.stdout === "string") return Buffer.from(result.stdout, "utf8");
  return Buffer.alloc(0);
}

function stdoutText(result) {
  return stdoutBytes(result).toString("utf8");
}

function runGitOrFail(runGit, context, args, message, {
  stdin = null,
  code = CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.GIT_FAILED
} = {}) {
  const result = runGit({
    repo: context.repo ?? null,
    gitDir: context.gitDir ?? null,
    workTree: context.workTree ?? null,
    indexFile: context.indexFile ?? null,
    args,
    stdin
  });
  if (result?.ok !== true) {
    fail(code, message, { status: result?.status ?? null, error: result?.error ?? null });
  }
  return result;
}

async function runGitOrFailAsync(runGit, context, args, message, {
  stdin = null,
  code = CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.GIT_FAILED
} = {}) {
  const result = await runGit({
    repo: context.repo ?? null,
    gitDir: context.gitDir ?? null,
    workTree: context.workTree ?? null,
    indexFile: context.indexFile ?? null,
    args,
    stdin
  });
  if (result?.ok !== true) {
    fail(code, message, { status: result?.status ?? null, error: result?.error ?? null });
  }
  return result;
}

function assertOid(value, label) {
  if (typeof value !== "string" || !OID_PATTERN.test(value) || /^0+$/.test(value)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      `${label} is not a canonical nonzero object identity`);
  }
  return value;
}

async function resolveGitDirectoryAsync(runGit, repo) {
  const result = await runGitOrFailAsync(runGit, { repo },
    ["rev-parse", "--absolute-git-dir"],
    "repository Git directory could not be resolved");
  const gitDir = stdoutText(result).trim();
  if (!path.isAbsolute(gitDir)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "resolved Git directory is not absolute");
  }
  try {
    return realpathSync(gitDir);
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "resolved Git directory is unavailable", { cause_code: error?.code ?? null });
  }
}

function resolveRefTip(runGit, gitDir, ref, {
  code = CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.GIT_FAILED
} = {}) {
  const result = runGit({
    gitDir,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]
  });
  if (result?.ok !== true) {
    const confirmedAbsent = result?.status === 1 && result?.error == null;
    const failureCode = confirmedAbsent
      ? CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE
      : code;
    const details = failureCode === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE
      ? {
          prerequisite: {
            kind: "persistent_wk_lifecycle_ref",
            ref,
            status: "unresolvable"
          },
          recovery_route: "establish_persistent_wk_lifecycle_ref",
          recovery_actor: "operator",
          recovery_route_kind: "operator_lifecycle_action",
          recovery_route_callable: false
        }
      : {};
    fail(failureCode, confirmedAbsent
      ? "persistent WK ref is absent or unresolvable"
      : "persistent WK ref could not be resolved", details);
  }
  return assertOid(stdoutText(result).trim(), "persistent WK ref tip");
}

async function resolveRefTipAsync(runGit, repo, gitDir, ref, {
  code = CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.GIT_FAILED
} = {}) {
  const result = await runGit({
    repo,
    gitDir,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]
  });
  if (result?.ok !== true) {
    const confirmedAbsent = result?.status === 1 && result?.error == null;
    const failureCode = confirmedAbsent
      ? CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE
      : code;
    const details = failureCode === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.REF_UNRESOLVABLE
      ? {
          prerequisite: {
            kind: "persistent_wk_lifecycle_ref",
            ref,
            status: "unresolvable"
          },
          recovery_route: "establish_persistent_wk_lifecycle_ref",
          recovery_actor: "operator",
          recovery_route_kind: "operator_lifecycle_action",
          recovery_route_callable: false
        }
      : {};
    fail(failureCode, confirmedAbsent
      ? "persistent WK ref is absent or unresolvable"
      : "persistent WK ref could not be resolved", details);
  }
  return assertOid(stdoutText(result).trim(), "persistent WK ref tip");
}

function cloneDescriptors(descriptors) {
  return descriptors.map((descriptor) => ({ ...structuredClone(descriptor) }));
}

function generationMatches(left, right) {
  if (left.length !== right.length) return false;
  return left.every((descriptor, index) =>
    descriptor.path === right[index].path &&
    descriptor.content_digest === right[index].content_digest &&
    descriptor.bytes_base64 === right[index].bytes_base64);
}

function assertGenerationEnvelope(generation, wkId) {
  if (!isPlainObject(generation) ||
      generation.schema_version !== "controlled-contract-resolved-generation.v1" ||
      generation.record_id !== wkId ||
      !Number.isInteger(generation.count) || generation.count < 1 ||
      generation.count !== generation.descriptors?.length ||
      typeof generation.generation_digest !== "string" ||
      !DIGEST_PATTERN.test(generation.generation_digest) ||
      !(generation.manifest_selection === null ||
        (Array.isArray(generation.manifest_selection) &&
         generation.manifest_selection.length > 0))) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "resolved generation envelope is malformed or identity-mismatched");
  }
}

export async function resolveControlledContractGenerationBinding(input = {}) {
  assertExactKeys(input, [
    "repoRoot", "wkId", "generation", "lifecycleBinding", "deps"
  ], "generation binding request");
  const { repoRoot, wkId, generation, lifecycleBinding = null, deps = {} } = input;
  if (typeof wkId !== "string" || !WK_ID_PATTERN.test(wkId) ||
      typeof repoRoot !== "string" || repoRoot.length === 0 ||
      !isPlainObject(deps)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INVALID_INPUT,
      "generation binding requires canonical repository and WK identity");
  }
  assertGenerationEnvelope(generation, wkId);
  await validateControlledContractAttachmentGenerationDescriptors({
    wkId,
    descriptors: generation.descriptors,
    generationDigest: generation.generation_digest
  });

  let repository;
  try {
    repository = realpathSync(path.resolve(repoRoot));
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical repository is unavailable", { cause_code: error?.code ?? null });
  }
  const recordPath = path.join(repository, "wiki", "work-records", `${wkId}.json`);
  let recordEntry;
  try {
    recordEntry = lstatSync(recordPath);
  } catch {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record is missing");
  }
  let resolvedRecordPath;
  try {
    resolvedRecordPath = realpathSync(recordPath);
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record identity is unavailable", { cause_code: error?.code ?? null });
  }
  if (!recordEntry.isFile() || recordEntry.isSymbolicLink() ||
      resolvedRecordPath !== recordPath) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record is not a confined regular file");
  }
  let recordBytes;
  try {
    recordBytes = readFileSync(recordPath);
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record could not be read", { cause_code: error?.code ?? null });
  }
  let record;
  try {
    record = JSON.parse(recordBytes.toString("utf8"));
  } catch {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record is malformed");
  }
  if (!isPlainObject(record) || record.id !== wkId ||
      typeof record.initiative !== "string" ||
      !INITIATIVE_PATTERN.test(record.initiative)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "canonical WK record identity or initiative assignment is invalid");
  }
  const outputBranch = `wk/${record.initiative}/${wkId}`;
  const ref = `refs/heads/${outputBranch}`;
  const runGit = deps.runGit ?? defaultControlledContractGenerationRunGit;
  const gitDir = await resolveGitDirectoryAsync(runGit, repository);
  const wkTipSha = await resolveRefTipAsync(runGit, repository, gitDir, ref);

  if (lifecycleBinding !== null) {
    if (!isPlainObject(lifecycleBinding) ||
        lifecycleBinding.record_id !== wkId ||
        lifecycleBinding.initiative !== record.initiative ||
        lifecycleBinding.output_branch !== outputBranch ||
        lifecycleBinding.wk_tip_sha !== wkTipSha) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.LIFECYCLE_MISMATCH,
        "launcher lifecycle binding does not match canonical WK state");
    }
  }
  let observedRecordBytes;
  try {
    observedRecordBytes = readFileSync(recordPath);
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "canonical WK record became unavailable during generation binding", {
        cause_code: error?.code ?? null
      });
  }
  if (!recordBytes.equals(observedRecordBytes)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "canonical WK record changed during generation binding");
  }

  return deepFreeze({
    schema_version: "controlled-contract-generation-binding.v1",
    repository,
    record_id: wkId,
    record_source_digest: sha256(recordBytes),
    initiative: record.initiative,
    output_branch: outputBranch,
    ref,
    wk_tip_sha: wkTipSha,
    generation_count: generation.count,
    generation_digest: generation.generation_digest,
    descriptors: cloneDescriptors(generation.descriptors),
    resolved_generation: generation,
    git_dir: gitDir
  });
}

const {
  authenticationObservationsFromTree,
  generationFromTree,
  manifestPathsFromTree,
  manifestPopulationMatches,
  parseStructuralDiff,
  recordObservationMatches,
  resolveBoundManifestArtifacts,
  resolveBoundRecordArtifact,
  resolveBoundRuntimePackageArtifacts,
  runtimePackageMatchesTree,
  selectedRuntimePackagesInHistory
} = createControlledContractGenerationTreeOperations({
  fail,
  codes: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES,
  runGitOrFail,
  runGitOrFailAsync,
  stdoutBytes,
  deepFreeze,
  isOwnedError: error => error instanceof ControlledContractGenerationPersistenceError,
  gitInertConfig: GIT_INERT_CONFIG
});

export async function authenticateControlledContractGenerationAtW(input = {}) {
  assertExactKeys(input, ["binding", "deps"],
    "controlled-contract generation W authentication request");
  const { binding, deps = {} } = input;
  if (!isPlainObject(binding) ||
      binding.schema_version !== "controlled-contract-generation-binding.v1" ||
      !isPlainObject(deps)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "generation W authentication requires one server-minted binding");
  }
  assertExactKeys(binding, GENERATION_BINDING_FIELDS,
    "controlled-contract generation binding");
  assertOid(binding.wk_tip_sha, "binding.wk_tip_sha");
  if (binding.ref !== `refs/heads/wk/${binding.initiative}/${binding.record_id}` ||
      binding.output_branch !== `wk/${binding.initiative}/${binding.record_id}`) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "generation W authentication binding identity is inconsistent");
  }

  const runGit = deps.runGit ?? defaultControlledContractGenerationRunGit;
  const liveTip = await resolveRefTipAsync(
    runGit, binding.repository, binding.git_dir, binding.ref, {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED
  });
  if (liveTip !== binding.wk_tip_sha) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "persistent WK ref moved while authenticating controlled-contract generation", {
        expected_tip: binding.wk_tip_sha,
        actual_tip: liveTip
      });
  }

  let current;
  try {
    current = await resolveControlledContractAttachmentGeneration({
      repoRoot: binding.repository,
      wkId: binding.record_id
    });
  } catch (error) {
    if (error instanceof ControlledContractGenerationPersistenceError) throw error;
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "current controlled-contract generation could not be resolved", {
        cause_code: error?.code ?? null
      });
  }
  try {
    if (current === null) throw new Error("current generation is absent");
    assertResolvedControlledContractGenerationsEqual({
      wkId: binding.record_id,
      expected: binding.resolved_generation,
      observed: current
    });
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "bound generation is not the current canonical controlled-contract generation", {
        cause_code: error?.code ?? null
      });
  }

  let observations;
  try {
    observations = await authenticationObservationsFromTree({
      runGit, binding, treeish: binding.wk_tip_sha
    });
  } catch (error) {
    if (error instanceof ControlledContractGenerationPersistenceError) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
        "persistent WK tree does not contain one complete controlled-contract authentication tuple", {
          cause_code: error.code
        });
    }
    throw error;
  }
  let authenticated;
  try {
    authenticated = await constructAuthenticatedControlledContractGeneration({
      repository: binding.repository,
      wkId: binding.record_id,
      wkTipSha: binding.wk_tip_sha,
      recordObservation: observations.recordObservation,
      resolvedGeneration: current,
      carrierObservations: observations.carrierObservations,
      manifestObservations: observations.manifestObservations
    });
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "persistent WK tree does not contain the exact authenticated controlled generation", {
        cause_code: error?.code ?? null
      });
  }
  let finalCurrent;
  try {
    finalCurrent = await resolveControlledContractAttachmentGeneration({
      repoRoot: binding.repository,
      wkId: binding.record_id
    });
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "current controlled-contract generation moved during exact-W authentication", {
        cause_code: error?.code ?? null
      });
  }
  try {
    if (finalCurrent === null) throw new Error("current generation is absent");
    assertResolvedControlledContractGenerationsEqual({
      wkId: binding.record_id,
      expected: current,
      observed: finalCurrent
    });
  } catch {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "current controlled-contract generation moved during exact-W authentication");
  }

  const finalTip = await resolveRefTipAsync(
    runGit, binding.repository, binding.git_dir, binding.ref, {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED
  });
  if (finalTip !== binding.wk_tip_sha) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "persistent WK ref moved after controlled-contract generation authentication", {
        expected_tip: binding.wk_tip_sha,
        actual_tip: finalTip
      });
  }
  return authenticated;
}

export async function authenticateCurrentControlledContractGenerationAtW(input = {}) {
  assertExactKeys(input, ["repoRoot", "wkId", "expectedWkTipSha", "expectedGeneration", "deps"],
    "current controlled-generation authority request");
  const { repoRoot, wkId, expectedWkTipSha, expectedGeneration, deps = {} } = input;
  if (typeof repoRoot !== "string" || repoRoot.length === 0 ||
      typeof wkId !== "string" || !WK_ID_PATTERN.test(wkId) ||
      typeof expectedWkTipSha !== "string" || !OID_PATTERN.test(expectedWkTipSha) ||
      !isPlainObject(deps)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INVALID_INPUT,
      "current generation authority requires canonical repository, WK, and exact-W identity");
  }
  const generation = await resolveControlledContractAttachmentGeneration({
    repoRoot,
    wkId
  });
  if (generation === null) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "current controlled-contract generation is absent");
  }
  const binding = await resolveControlledContractGenerationBinding({
    repoRoot,
    wkId,
    generation,
    lifecycleBinding: null,
    deps
  });
  if (binding.wk_tip_sha !== expectedWkTipSha) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "current exact-W identity differs from the authorized generation", {
        expected_tip: expectedWkTipSha,
        actual_tip: binding.wk_tip_sha
      });
  }
  const authenticated = await authenticateControlledContractGenerationAtW({
    binding,
    deps
  });
  assertAuthenticatedControlledContractGeneration(authenticated, {
    repository: binding.repository,
    wkId,
    wkTipSha: binding.wk_tip_sha,
    requireManifest: true
  });
  const expected = assertAuthenticatedControlledContractGeneration(expectedGeneration, {
    repository: binding.repository,
    wkId,
    wkTipSha: binding.wk_tip_sha,
    requireManifest: true
  });
  if (!authenticatedControlledContractGenerationsEqual(authenticated, expected)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED,
      "authorized generation differs from the exact current generation authenticated in W");
  }
  return deepFreeze({ binding, authenticated });
}

function structuralDiffPaths({ runGit, binding, before, after }) {
  const result = runGitOrFail(runGit, { gitDir: binding.git_dir }, [
    ...STRUCTURAL_DIFF_ARGS, before, after
  ], "complete parent-relative structural diff could not be enumerated", {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.STRUCTURAL_DIFF_INVALID
  });
  return parseStructuralDiff(stdoutBytes(result));
}

export function controlledContractGenerationPopulationPaths(binding) {
  const manifestArtifacts = resolveBoundManifestArtifacts(binding);
  return Object.freeze([...new Set([
    resolveBoundRecordArtifact(binding).path,
    ...binding.descriptors.map((descriptor) => descriptor.path),
    ...manifestArtifacts.map((artifact) => artifact.path),
    ...resolveBoundRuntimePackageArtifacts(binding, manifestArtifacts)
      .map((artifact) => artifact.path)
  ])].sort());
}

export function controlledContractStructuralDiffPaths({
  binding, before, after, gitDir = binding.git_dir, deps = {}
}) {
  return structuralDiffPaths({
    runGit: deps.runGit ?? defaultControlledContractGenerationRunGit,
    binding: { git_dir: gitDir }, before, after
  });
}

export function controlledContractRetainedGenerationPaths({ binding, since, landing, deps = {} }) {
  const runGit = deps.runGit ?? defaultControlledContractGenerationRunGit;
  assertOid(since, "retained generation history boundary");
  assertOid(landing, "retained generation landing commit");
  const selected = selectedRuntimePackagesInHistory({ runGit, binding, since });
  if (selected.size === 0) return Object.freeze([]);
  const listing = runGitOrFail(runGit, { gitDir: binding.git_dir }, [
    "--no-replace-objects", ...GIT_INERT_CONFIG, "--literal-pathspecs",
    "ls-tree", "-z", "--full-tree", landing, "--", ...selected.keys()
  ], "landing controlled-contract entries could not be enumerated", {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.STORED_GENERATION_INVALID
  });
  const carried = [];
  for (const record of stdoutBytes(listing).toString("utf8").split("\0").filter(Boolean)) {
    const match = /^([0-7]{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/u.exec(record);
    if (match !== null && selected.get(match[3])?.has(`${match[1]} ${match[2]}`)) carried.push(match[3]);
  }
  return Object.freeze(carried.sort());
}

function commitParents({ runGit, binding, commit }) {
  const result = runGitOrFail(runGit, { gitDir: binding.git_dir },
    ["--no-replace-objects", "rev-list", "-n", "1", "--parents", commit],
    "candidate winner ancestry could not be resolved", {
      code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
    });
  const parts = stdoutText(result).trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== commit) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "candidate winner ancestry is malformed");
  }
  return parts.slice(1);
}

function receipt(binding, {
  disposition,
  finalTip,
  invocationCommit = null,
  invocationRefWrite = false
}) {
  return deepFreeze({
    schema_version: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_RECEIPT_VERSION,
    record_id: binding.record_id,
    initiative: binding.initiative,
    ref: binding.ref,
    record_source_digest: binding.record_source_digest,
    bound_tip: binding.wk_tip_sha,
    final_tip: finalTip,
    disposition,
    invocation: {
      commit_created: invocationCommit !== null,
      commit: invocationCommit,
      ref_write_succeeded: invocationRefWrite
    },
    generation: {
      count: binding.generation_count,
      digest: binding.generation_digest,
      descriptors: binding.descriptors.map(({ path: carrierPath, content_digest }) => ({
        path: carrierPath,
        content_digest
      }))
    }
  });
}

export function admitVerifiedReceipt({ runGit, binding, receiptValue }) {
  assertExactKeys(receiptValue, RECEIPT_FIELDS, "persistence receipt");
  assertExactKeys(receiptValue.invocation, RECEIPT_INVOCATION_FIELDS,
    "persistence receipt invocation");
  assertExactKeys(receiptValue.generation, RECEIPT_GENERATION_FIELDS,
    "persistence receipt generation");
  if (receiptValue.schema_version !==
        CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_RECEIPT_VERSION ||
      receiptValue.record_id !== binding.record_id ||
      receiptValue.initiative !== binding.initiative ||
      receiptValue.ref !== binding.ref ||
      receiptValue.record_source_digest !== binding.record_source_digest ||
      receiptValue.bound_tip !== binding.wk_tip_sha ||
      !RECEIPT_DISPOSITIONS.includes(receiptValue.disposition)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persistence receipt identity does not match the bound generation");
  }
  assertOid(receiptValue.final_tip, "receipt final tip");

  const invocation = receiptValue.invocation;
  if (typeof invocation.commit_created !== "boolean" ||
      typeof invocation.ref_write_succeeded !== "boolean" ||
      (invocation.commit !== null &&
        (typeof invocation.commit !== "string" ||
         !OID_PATTERN.test(invocation.commit) || /^0+$/.test(invocation.commit))) ||
      invocation.commit_created !== (invocation.commit !== null) ||
      invocation.ref_write_succeeded !== (receiptValue.disposition === "created") ||
      (receiptValue.disposition === "created" &&
        invocation.commit !== receiptValue.final_tip)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persistence receipt invocation facts are inconsistent with its disposition");
  }
  const generation = receiptValue.generation;
  if (!Array.isArray(generation.descriptors) ||
      !Number.isInteger(generation.count) ||
      generation.count !== generation.descriptors.length ||
      generation.count !== binding.generation_count ||
      generation.digest !== binding.generation_digest ||
      generation.descriptors.length !== binding.descriptors.length) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persistence receipt generation identity does not match the bound generation");
  }

  for (const [index, descriptor] of generation.descriptors.entries()) {
    assertExactKeys(descriptor, RECEIPT_GENERATION_DESCRIPTOR_FIELDS,
      "persistence receipt generation descriptor");
    if (descriptor.path !== binding.descriptors[index].path ||
        descriptor.content_digest !== binding.descriptors[index].content_digest) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persistence receipt generation population does not match the bound generation",
        { index });
    }
  }
  const liveTip = resolveRefTip(runGit, binding.git_dir, binding.ref, {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
  });
  if (liveTip !== receiptValue.final_tip) {
    const reachable = runGit({
      gitDir: binding.git_dir,
      args: ["--no-replace-objects", "merge-base", "--is-ancestor",
        receiptValue.final_tip, liveTip]
    });
    if (reachable?.ok !== true) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persisted generation is not reachable from the authoritative persistent WK ref");
    }
  }
  for (const descriptor of binding.descriptors) {
    const resolved = runGit({
      gitDir: binding.git_dir,
      args: ["--no-replace-objects", "rev-parse", "--verify", "--quiet",
        `${receiptValue.final_tip}:${descriptor.path}`]
    });
    if (resolved?.ok !== true) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persisted controlled-contract path is absent from the authoritative ref",
        { basename: descriptor.basename });
    }
    const oid = assertOid(stdoutText(resolved).trim(), "persisted carrier blob");
    const blob = runGitOrFail(runGit, { gitDir: binding.git_dir },
      ["--no-replace-objects", "cat-file", "blob", oid],
      "persisted controlled-contract blob could not be read", {
        code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
      });
    const bytes = stdoutBytes(blob);
    if (sha256(bytes) !== descriptor.content_digest ||
        bytes.toString("base64") !== descriptor.bytes_base64) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persisted controlled-contract blob differs from the exact bound generation",
        { basename: descriptor.basename });
    }
  }
  const manifestArtifacts = resolveBoundManifestArtifacts(binding);
  for (const artifact of manifestArtifacts) {
    const resolved = runGit({
      gitDir: binding.git_dir,
      args: ["--no-replace-objects", "rev-parse", "--verify", "--quiet",
        `${receiptValue.final_tip}:${artifact.path}`]
    });
    if (resolved?.ok !== true) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persisted selected manifest is absent from the authoritative ref", {
          path: artifact.path
        });
    }
    const oid = assertOid(stdoutText(resolved).trim(), "persisted manifest blob");
    const blob = runGitOrFail(runGit, { gitDir: binding.git_dir },
      ["--no-replace-objects", "cat-file", "blob", oid],
      "persisted selected manifest blob could not be read", {
        code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
      });
    const bytes = stdoutBytes(blob);
    if (sha256(bytes) !== artifact.content_digest || !bytes.equals(artifact.bytes)) {
      fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
        "persisted selected manifest differs from its bound authentication fence", {
          path: artifact.path
      });
    }
  }
  const runtimePackageArtifacts = resolveBoundRuntimePackageArtifacts(
    binding, manifestArtifacts);
  if (!runtimePackageMatchesTree({
    runGit, binding, treeish: receiptValue.final_tip, artifacts: runtimePackageArtifacts
  })) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persisted controlled-contract runtime package is absent or differs from the exact bound generation");
  }
  const recordArtifact = resolveBoundRecordArtifact(binding);
  const recordResolved = runGit({
    gitDir: binding.git_dir,
    args: ["--no-replace-objects", "rev-parse", "--verify", "--quiet",
      `${receiptValue.final_tip}:${recordArtifact.path}`]
  });
  if (recordResolved?.ok !== true) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persisted canonical WK source is absent from the authoritative ref");
  }
  const recordOid = assertOid(stdoutText(recordResolved).trim(), "persisted WK source blob");
  const recordBlob = runGitOrFail(runGit, { gitDir: binding.git_dir },
    ["--no-replace-objects", "cat-file", "blob", recordOid],
    "persisted canonical WK source blob could not be read", {
      code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE
    });
  const recordBytes = stdoutBytes(recordBlob);
  if (sha256(recordBytes) !== recordArtifact.content_digest ||
      !recordBytes.equals(recordArtifact.bytes)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "persisted canonical WK source differs from its bound identity");
  }
  return receiptValue;
}

function reauthenticateBindingSource(binding) {
  let repository;
  let gitDir;
  let recordBytes;
  try {
    repository = realpathSync(binding.repository);
    gitDir = realpathSync(binding.git_dir);
    recordBytes = readFileSync(path.join(
      repository, "wiki", "work-records", `${binding.record_id}.json`
    ));
  } catch (error) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "bound repository or canonical WK source became unavailable", {
        cause_code: error?.code ?? null
      });
  }
  if (repository !== binding.repository || gitDir !== binding.git_dir ||
      sha256(recordBytes) !== binding.record_source_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "bound repository or canonical WK source identity changed");
  }
  let record;
  try {
    record = JSON.parse(recordBytes.toString("utf8"));
  } catch {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "canonical WK source became malformed");
  }
  if (!isPlainObject(record) || record.id !== binding.record_id ||
      record.initiative !== binding.initiative) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "canonical WK source identity or initiative changed");
  }
}

async function observeExactChild({
  runGit,
  binding,
  liveTip,
  prior,
  priorManifestPaths,
  manifestArtifacts,
  runtimePackageArtifacts,
  recordArtifact,
  invocationCommit = null
}) {
  const parents = commitParents({ runGit, binding, commit: liveTip });
  if (parents.length !== 1 || parents[0] !== binding.wk_tip_sha) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "live WK tip is not the exact sole-parent child of the bound tip");
  }
  const changedPaths = structuralDiffPaths({
    runGit, binding, before: binding.wk_tip_sha, after: liveTip
  });
  if (changedPaths.length === 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "empty-delta child cannot satisfy controlled-contract persistence");
  }
  const allowed = new Set([
    ...prior.descriptors.map((descriptor) => descriptor.path),
    ...binding.descriptors.map((descriptor) => descriptor.path),
    ...priorManifestPaths,
    ...manifestArtifacts.map((artifact) => artifact.path),
    ...runtimePackageArtifacts.map((artifact) => artifact.path),
    recordArtifact.path
  ]);
  if (changedPaths.some((changedPath) => !allowed.has(changedPath))) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "candidate winner changes a path outside the authenticated generation union");
  }
  const post = await generationFromTree({
    runGit, binding, treeish: liveTip, allowEmpty: false
  });
  if (!generationMatches(post.descriptors, binding.descriptors)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "candidate winner does not contain the exact current complete generation");
  }
  const observations = await authenticationObservationsFromTree({
    runGit, binding, treeish: liveTip
  });
  if (!manifestPopulationMatches(observations.manifestObservations, manifestArtifacts) ||
      !recordObservationMatches(observations.recordObservation, recordArtifact)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "candidate winner does not contain the exact authentication population");
  }
  if (!runtimePackageMatchesTree({
    runGit, binding, treeish: liveTip, artifacts: runtimePackageArtifacts
  })) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT,
      "candidate winner does not contain the exact reader runtime package");
  }
  return receipt(binding, {
    disposition: "observed",
    finalTip: liveTip,
    invocationCommit,
    invocationRefWrite: false
  });
}

function buildGenerationTree({
  runGit, binding, prior, priorManifestPaths, manifestArtifacts,
  runtimePackageArtifacts, recordArtifact
}) {
  const indexDir = mkdtempSync(path.join(tmpdir(), "controlled-contract-generation-index-"));
  const indexFile = path.join(indexDir, "index");
  const context = { gitDir: binding.git_dir, indexFile };
  try {
    runGitOrFail(runGit, context,
      [...GIT_INERT_CONFIG, "read-tree", binding.wk_tip_sha],
      "private generation index could not be seeded");
    const currentPaths = new Set(binding.descriptors.map((descriptor) => descriptor.path));
    for (const descriptor of prior.descriptors) {
      if (currentPaths.has(descriptor.path)) continue;
      runGitOrFail(runGit, context, [
        ...GIT_INERT_CONFIG, "update-index", "--force-remove", "--", descriptor.path
      ], "retired generation path could not be removed from the private index");
    }
    const currentManifestPaths = new Set(manifestArtifacts.map((artifact) => artifact.path));
    for (const manifestPath of priorManifestPaths) {
      if (currentManifestPaths.has(manifestPath)) continue;
      runGitOrFail(runGit, context, [
        ...GIT_INERT_CONFIG, "update-index", "--force-remove", "--", manifestPath
      ], "retired controlled-contract manifest could not be removed from the private index");
    }
    for (const descriptor of binding.descriptors) {
      const bytes = Buffer.from(descriptor.bytes_base64, "base64");
      const blob = runGitOrFail(runGit, context,
        [...GIT_INERT_CONFIG, "hash-object", "-w", "--stdin"],
        "current generation blob could not be materialized", { stdin: bytes });
      const oid = assertOid(stdoutText(blob).trim(), "generation blob");
      runGitOrFail(runGit, context, [
        ...GIT_INERT_CONFIG,
        "update-index", "--add", "--cacheinfo", `100644,${oid},${descriptor.path}`
      ], "current generation path could not be written to the private index");
    }
    for (const artifact of manifestArtifacts) {
      const blob = runGitOrFail(runGit, context,
        [...GIT_INERT_CONFIG, "hash-object", "-w", "--stdin"],
        "selected controlled-contract manifest blob could not be materialized", {
          stdin: artifact.bytes
        });
      const oid = assertOid(stdoutText(blob).trim(), "controlled-contract manifest blob");
      runGitOrFail(runGit, context, [
        ...GIT_INERT_CONFIG,
        "update-index", "--add", "--cacheinfo", `100644,${oid},${artifact.path}`
      ], "selected controlled-contract manifest could not be written to the private index");
    }
    for (const artifact of runtimePackageArtifacts) {
      const blob = runGitOrFail(runGit, context,
        [...GIT_INERT_CONFIG, "hash-object", "-w", "--stdin"],
        "controlled-contract runtime package blob could not be materialized", {
          stdin: artifact.bytes
        });
      const oid = assertOid(stdoutText(blob).trim(), "controlled-contract runtime package blob");
      runGitOrFail(runGit, context, [
        ...GIT_INERT_CONFIG,
        "update-index", "--add", "--cacheinfo", `100644,${oid},${artifact.path}`
      ], "controlled-contract runtime package path could not be written to the private index");
    }
    const recordBlob = runGitOrFail(runGit, context,
      [...GIT_INERT_CONFIG, "hash-object", "-w", "--stdin"],
      "canonical WK source blob could not be materialized", { stdin: recordArtifact.bytes });
    const recordOid = assertOid(stdoutText(recordBlob).trim(), "canonical WK source blob");
    runGitOrFail(runGit, context, [
      ...GIT_INERT_CONFIG,
      "update-index", "--add", "--cacheinfo", `100644,${recordOid},${recordArtifact.path}`
    ], "canonical WK source could not be written to the private index");
    const tree = runGitOrFail(runGit, context,
      [...GIT_INERT_CONFIG, "write-tree"],
      "complete generation tree could not be materialized");
    return assertOid(stdoutText(tree).trim(), "generation tree");
  } finally {
    try {
      rmSync(indexDir, { recursive: true, force: true });
    } catch {

    }
  }
}

export async function persistControlledContractGeneration(input = {}) {
  assertExactKeys(input, ["binding", "deps"], "generation persistence request");
  const { binding, deps = {} } = input;
  if (!isPlainObject(binding) ||
      binding.schema_version !== "controlled-contract-generation-binding.v1" ||
      !isPlainObject(deps)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "generation persistence requires one server-minted binding");
  }
  assertOid(binding.wk_tip_sha, "binding.wk_tip_sha");
  if (binding.ref !== `refs/heads/wk/${binding.initiative}/${binding.record_id}` ||
      binding.output_branch !== `wk/${binding.initiative}/${binding.record_id}` ||
      binding.generation_count !== binding.descriptors?.length ||
      controlledContractGenerationDigest({
        wkId: binding.record_id, descriptors: binding.descriptors
      }) !== binding.generation_digest) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.BINDING_INVALID,
      "generation persistence binding identity is inconsistent");
  }
  await validateControlledContractAttachmentGenerationDescriptors({
    wkId: binding.record_id,
    descriptors: binding.descriptors,
    generationDigest: binding.generation_digest
  });

  reauthenticateBindingSource(binding);

  const current = await resolveControlledContractAttachmentGeneration({
    repoRoot: binding.repository,
    wkId: binding.record_id
  });
  if (current === null || current.generation_digest !== binding.generation_digest ||
      !generationMatches(current.descriptors, binding.descriptors)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.SOURCE_CHANGED,
      "canonical controlled-contract generation changed after binding");
  }
  const manifestArtifacts = resolveBoundManifestArtifacts(binding);
  const runtimePackageArtifacts = resolveBoundRuntimePackageArtifacts(
    binding, manifestArtifacts);
  const recordArtifact = resolveBoundRecordArtifact(binding);

  const runGit = deps.runGit ?? defaultControlledContractGenerationRunGit;
  const liveTip = resolveRefTip(runGit, binding.git_dir, binding.ref);
  const prior = await generationFromTree({
    runGit, binding, treeish: binding.wk_tip_sha, allowEmpty: true
  });
  const priorManifestPaths = manifestPathsFromTree({
    runGit, binding, treeish: binding.wk_tip_sha
  });
  if (liveTip !== binding.wk_tip_sha) {
    return admitVerifiedReceipt({
      runGit, binding,
      receiptValue: await observeExactChild({
        runGit, binding, liveTip, prior, priorManifestPaths, manifestArtifacts,
        runtimePackageArtifacts, recordArtifact
      })
    });
  }
  const priorRecordEntry = runGitOrFail(runGit, {
    repo: binding.repository, gitDir: binding.git_dir
  }, [
    "--no-replace-objects", ...GIT_INERT_CONFIG,
    "ls-tree", "-z", "--full-tree", binding.wk_tip_sha, "--", recordArtifact.path
  ], "stored canonical WK record existence could not be observed");
  const priorObservations = stdoutBytes(priorRecordEntry).length === 0
    ? null
    : await authenticationObservationsFromTree({
        runGit, binding, treeish: binding.wk_tip_sha
      });
  if (generationMatches(prior.descriptors, binding.descriptors) &&
      priorObservations !== null &&
      manifestPopulationMatches(priorObservations.manifestObservations, manifestArtifacts) &&
      recordObservationMatches(priorObservations.recordObservation, recordArtifact) &&
      runtimePackageMatchesTree({
        runGit, binding, treeish: binding.wk_tip_sha, artifacts: runtimePackageArtifacts
      })) {
    return admitVerifiedReceipt({
      runGit, binding,
      receiptValue: receipt(binding, {
        disposition: "observed",
        finalTip: binding.wk_tip_sha
      })
    });
  }

  const tree = buildGenerationTree({
    runGit, binding, prior, priorManifestPaths, manifestArtifacts,
    runtimePackageArtifacts, recordArtifact
  });
  const changedPaths = structuralDiffPaths({
    runGit, binding, before: binding.wk_tip_sha, after: tree
  });
  if (changedPaths.length === 0) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "generation replacement unexpectedly produced an empty tree delta");
  }
  const allowed = new Set([
    ...prior.descriptors.map((descriptor) => descriptor.path),
    ...binding.descriptors.map((descriptor) => descriptor.path),
    ...priorManifestPaths,
    ...manifestArtifacts.map((artifact) => artifact.path),
    ...runtimePackageArtifacts.map((artifact) => artifact.path),
    recordArtifact.path
  ]);
  if (changedPaths.some((changedPath) => !allowed.has(changedPath))) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "generation replacement changes an unauthorized path");
  }
  const post = await generationFromTree({ runGit, binding, treeish: tree, allowEmpty: false });
  if (!generationMatches(post.descriptors, binding.descriptors)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "materialized tree does not contain the exact current generation");
  }
  const postObservations = await authenticationObservationsFromTree({
    runGit, binding, treeish: tree
  });
  if (!manifestPopulationMatches(postObservations.manifestObservations, manifestArtifacts) ||
      !recordObservationMatches(postObservations.recordObservation, recordArtifact)) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "materialized tree does not contain the exact authentication population");
  }
  if (!runtimePackageMatchesTree({
    runGit, binding, treeish: tree, artifacts: runtimePackageArtifacts
  })) {
    fail(CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.INDETERMINATE,
      "materialized tree does not contain the exact reader runtime package");
  }
  const commitResult = runGitOrFail(runGit, { gitDir: binding.git_dir }, [
    ...GIT_INERT_CONFIG,
    "-c", `user.name=${COMMITTER.name}`,
    "-c", `user.email=${COMMITTER.email}`,
    "commit-tree", tree,
    "-p", binding.wk_tip_sha,
    "-m", `chore(controlled-contract): persist ${binding.record_id} generation`
  ], "generation persistence commit could not be created");
  const commit = assertOid(stdoutText(commitResult).trim(), "generation commit");
  const cas = runGit({
    gitDir: binding.git_dir,
    args: ["update-ref", binding.ref, commit, binding.wk_tip_sha]
  });
  if (cas?.ok === true) {
    return admitVerifiedReceipt({
      runGit, binding,
      receiptValue: receipt(binding, {
        disposition: "created",
        finalTip: commit,
        invocationCommit: commit,
        invocationRefWrite: true
      })
    });
  }

  const winner = resolveRefTip(runGit, binding.git_dir, binding.ref, {
    code: CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.CAS_CONFLICT
  });
  return admitVerifiedReceipt({
    runGit, binding,
    receiptValue: await observeExactChild({
      runGit,
      binding,
      liveTip: winner,
      prior,
      priorManifestPaths,
      manifestArtifacts,
      runtimePackageArtifacts,
      recordArtifact,
      invocationCommit: commit
    })
  });
}

export const CONTROLLED_CONTRACT_STRUCTURAL_DIFF_ARGUMENTS = STRUCTURAL_DIFF_ARGS;
