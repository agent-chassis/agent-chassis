

import path from "node:path";

import {
  resolveCanonicalIntegratedSliceState
} from "./backend-integrated-scope-authority.mjs";
import { resolveFixedWkForkCommit } from "./slice-integration-authorization.mjs";
import {
  defaultTerminalCandidateRunGit,
  observeExactDirectCommitRef
} from "./terminal-wk-candidate.mjs";
import { withPrivateExactCommitCheckout } from "./terminal-review-materialization.mjs";
import {
  mintIntegratedSliceTestProofRuntimeAuthority
} from "./workspace-agent-test-proof-runtime-identity.mjs";

export const INTEGRATED_TEST_PROOF_RUNTIME_SCHEMA_VERSION =
  "workspace-agent-integrated-test-proof-runtime.v1";

export const INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES = Object.freeze({
  INPUT_FORBIDDEN: "agent_launch.integrated_test_proof.input_forbidden.v1",
  INPUT_INVALID: "agent_launch.integrated_test_proof.input_invalid.v1",
  WK_SUBJECT_UNSUPPORTED: "agent_launch.integrated_test_proof.wk_subject_unsupported.v1",
  LIFECYCLE_UNRESOLVED: "agent_launch.integrated_test_proof.lifecycle_unresolved.v1",
  REF_AUTHORITY_UNRESOLVED: "agent_launch.integrated_test_proof.ref_authority_unresolved.v1",
  IDENTITY_MOVED: "agent_launch.integrated_test_proof.identity_moved.v1",
  DELIVERY_NOT_IN_TIP: "agent_launch.integrated_test_proof.delivery_not_in_tip.v1"
});

export class IntegratedTestProofRuntimeError extends Error {
  constructor(code, message, detail = null, cause = null) {
    super(message);
    this.name = "IntegratedTestProofRuntimeError";
    this.code = code;
    this.detail = detail;
    if (cause != null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new IntegratedTestProofRuntimeError(code, message, detail, cause);
}

const EXACT_SLICE_UNIT_RE = /^(WK-[0-9]{4})#(SLICE-[0-9]{3})$/u;
const WK_UNIT_RE = /^WK-[0-9]{4}$/u;

const FORBIDDEN_INPUT_FAMILIES = Object.freeze({
  lifecycle: ["lifecycle", "lifecycleState", "lifecycle_state", "state", "integratedState",
    "parentStatus", "sliceStatus", "final", "corrective"],
  git: ["git", "gitDir", "ref", "wkRef", "wk_ref", "wkTip", "wk_tip", "fork", "forkRef",
    "base", "baseRef", "baseSha", "commit", "sha", "tree", "candidate", "candidateRef"],
  path: ["worktree", "worktreePath", "checkoutPath", "repoRoot", "workspaceDir", "cwd"],
  command: ["command", "commandId", "commandTarget", "target", "targets", "argv", "args"],
  environment: ["env", "environment", "HOME", "PATH", "XDG_CONFIG_HOME"],
  provider: ["provider", "providers", "providerId", "capability", "registry"],
  receipt: ["receipt", "receipts", "evidence", "runtimeEvidence", "inventory",
    "inventoryInput", "testId", "testIds"],
  witness: ["witness", "witnesses", "attestation", "provenance"],
  assessment: ["assessment", "assessmentIdentity", "runtimeTruth", "profileDiscrimination"],
  authority: ["authority", "proofAuthority", "managedAuthority", "trusted", "executor",
    "runValidation"]
});

const ALLOWED_INPUT_KEYS = Object.freeze(["mainRepo", "unit", "checkoutRoot", "runGit"]);

function assertClosedIntegratedInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_INVALID,
    "integrated test-proof runtime requires one closed input object");
  for (const [family, keys] of Object.entries(FORBIDDEN_INPUT_FAMILIES)) {
    const supplied = keys.filter((key) => Object.hasOwn(input, key)).sort();
    if (supplied.length > 0) fail(
      INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_FORBIDDEN,
      `caller-supplied ${family} input is forbidden on the integrated test-proof route`,
      { family, supplied });
  }
  const unsupported = Object.keys(input).filter(
    (key) => !ALLOWED_INPUT_KEYS.includes(key)).sort();
  if (unsupported.length > 0) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_FORBIDDEN,
    "caller-supplied input is forbidden on the integrated test-proof route",
    { family: "unsupported", supplied: unsupported });
}

function assertExactSliceUnit(unit) {
  const match = typeof unit === "string" ? unit.match(EXACT_SLICE_UNIT_RE) : null;
  if (match !== null) return Object.freeze({ record_id: match[1], slice_id: match[2] });
  if (typeof unit === "string" && WK_UNIT_RE.test(unit)) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.WK_SUBJECT_UNSUPPORTED,
    "post-integration runtime proof selects one exact integrated slice, never a whole WK",
    { unit });
  fail(INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_INVALID,
    "integrated test-proof unit must be one canonical exact implementation slice",
    { unit: typeof unit === "string" ? unit : null });
  return null;
}

function requireLauncherRunGit(runGit) {
  if (runGit !== undefined && runGit !== defaultTerminalCandidateRunGit) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_FORBIDDEN,
    "integrated proof authority requires the launcher-fixed Git implementation",
    { family: "git", supplied: ["runGit"] });
  return defaultTerminalCandidateRunGit;
}

async function observeWkTip({ runGit, mainRepo, wkRef }) {
  let tip = null;
  try {
    tip = await observeExactDirectCommitRef({
      mainRepo, ref: wkRef, runGit, subject: "durable WK ref"
    });
  } catch (error) {
    fail(INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.REF_AUTHORITY_UNRESOLVED,
      "the durable WK ref could not be observed as one exact direct commit",
      { wk_ref: wkRef }, error);
  }
  if (typeof tip !== "string" || !/^[a-f0-9]{40,64}$/u.test(tip)) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.REF_AUTHORITY_UNRESOLVED,
    "the durable WK ref does not name one exact direct commit", { wk_ref: wkRef });
  return tip;
}

async function assertDeliveryReachableFromTip({ runGit, mainRepo, state, wkRef, wkTip }) {
  const delivery = state.integrated_delivery_sha;
  if (typeof delivery !== "string" || !/^[a-f0-9]{40,64}$/u.test(delivery)) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.DELIVERY_NOT_IN_TIP,
    "the exact slice records no canonical integrated delivery commit to bind the tip to",
    { unit: `${state.record_id}#${state.slice_id}`, wk_ref: wkRef, wk_tip: wkTip,
      integrated_delivery_sha: null });
  const reachable = await runGit({
    repo: mainRepo, args: ["merge-base", "--is-ancestor", delivery, wkTip]
  });
  if (reachable?.ok !== true) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.DELIVERY_NOT_IN_TIP,
    "the exact slice's integrated delivery is not an ancestor of the durable WK tip",
    { unit: `${state.record_id}#${state.slice_id}`, wk_ref: wkRef, wk_tip: wkTip,
      integrated_delivery_sha: delivery });
}

export async function resolveIntegratedTestProofRuntimeLifecycle({ mainRepo, unit, runGit } = {}) {
  const git = requireLauncherRunGit(runGit);
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_INVALID,
    "integrated test-proof runtime requires the canonical repository path");
  assertExactSliceUnit(unit);
  let state;
  try {
    state = resolveCanonicalIntegratedSliceState(mainRepo, unit);
  } catch (error) {
    fail(INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.LIFECYCLE_UNRESOLVED,
      "the exact slice has no canonical integrated managed delivery", { unit }, error);
  }
  let fork;
  try {
    fork = await resolveFixedWkForkCommit({
      runGit: git, mainRepo, initiative: state.initiative, wkId: state.record_id
    });
  } catch (error) {
    fail(INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.REF_AUTHORITY_UNRESOLVED,
      "the launcher-owned fixed WK fork is not resolvable",
      { record_id: state.record_id, initiative: state.initiative }, error);
  }
  const wkRef = `refs/heads/wk/${state.initiative}/${state.record_id}`;
  const wkTip = await observeWkTip({ runGit: git, mainRepo, wkRef });
  await assertDeliveryReachableFromTip({ runGit: git, mainRepo, state, wkRef, wkTip });
  return Object.freeze({
    schema_version: INTEGRATED_TEST_PROOF_RUNTIME_SCHEMA_VERSION,
    main_repo: mainRepo,
    unit,
    state,
    fork_ref: fork.ref,
    fork: fork.sha,
    wk_ref: wkRef,
    wk_tip: wkTip
  });
}

export async function assertIntegratedTestProofRuntimeCurrent(authority, runGit = undefined) {
  const git = requireLauncherRunGit(runGit);
  if (authority?.kind !== "integrated_slice") fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_INVALID,
    "integrated identity re-verification requires the integrated proof authority");
  const tip = await observeWkTip({
    runGit: git, mainRepo: authority.main_repo, wkRef: authority.integrated_wk_ref
  });
  if (tip !== authority.integrated_wk_tip) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.IDENTITY_MOVED,
    "the durable WK ref moved during the integrated proof attempt",
    { wk_ref: authority.integrated_wk_ref, expected: authority.integrated_wk_tip,
      actual: tip });
  const head = await git({
    repo: authority.worktree_path, args: ["rev-parse", "--verify", "HEAD^{commit}"]
  });
  const observed = head?.ok === true ? String(head.stdout ?? "").trim() : null;
  if (observed !== authority.integrated_wk_tip) fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.IDENTITY_MOVED,
    "the private integrated checkout no longer names the authenticated exact tip",
    { expected: authority.integrated_wk_tip, actual: observed });
  return authority;
}

export async function mintIntegratedWkTestProofRuntimeAuthority(input, use) {
  assertClosedIntegratedInput(input ?? {});
  if (typeof use !== "function") fail(
    INTEGRATED_TEST_PROOF_RUNTIME_REFUSAL_CODES.INPUT_INVALID,
    "integrated proof authority is minted only for one bounded use");
  const { mainRepo, unit, checkoutRoot, runGit } = input;
  const git = requireLauncherRunGit(runGit);
  const lifecycle = await resolveIntegratedTestProofRuntimeLifecycle({ mainRepo, unit, runGit });
  return withPrivateExactCommitCheckout({
    mainRepo, commit: lifecycle.wk_tip, checkoutRoot, runGit: git
  }, async (checkout) => {
    const authority = mintIntegratedSliceTestProofRuntimeAuthority({
      integratedState: lifecycle.state,
      mainRepo,
      wkRef: lifecycle.wk_ref,
      wkTip: lifecycle.wk_tip,
      forkRef: lifecycle.fork_ref,
      fork: lifecycle.fork,
      checkout
    });
    await assertIntegratedTestProofRuntimeCurrent(authority, git);
    return await use({ authority, lifecycle, checkout });
  });
}
