

import path from "node:path";
import { computeWorkRecordSourceDigest } from "../../../wiki-core/src/lib/work-record-schema.mjs";
import {
  authenticateControlledContractGenerationStateAtCommit
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import { assertControlledContractGenerationState } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import {
  readTerminalWkCandidateMetadata,
  resolveTerminalWkCandidateBaseRef
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateVersionRef,
  deriveRecoveredTerminalWkCandidateIdentity,
  defaultTerminalCandidateRunGit,
  freezeHistoricalTerminalWkCandidateInputs,
  freezeObservedTerminalWkCandidateInputs,
  freezeRecoveredTerminalWkCandidateInputs,
  observeExactDirectCommitRef,
  readExactWkRecordBlobObservation,
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError,
  verifyHistoricalTerminalWkCandidateVersion,
  verifyTerminalWkCandidateObjectBinding
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { exactWkBoundContract } from "./dispatch-terminal-review-contract.mjs";

export function terminalCandidateState({ worktreeRoot, wkId, binding, materialization, dependencyProof,
  contract, reviewUnit }) {
  return Object.freeze({
    binding,
    materialization,
    dependency_proof: dependencyProof,
    review_unit: reviewUnit,
    canonical_targets: contract.targets,
    canonical_validation_bindings: contract.validation_bindings,
    validation_runtime_root: path.join(worktreeRoot, ".terminal-validation", wkId, binding.candidate),
    version_decision: binding.version_decision
  });
}

export async function authenticateExistingTerminalCandidate({
  mainRepo, wkId, candidate, generationAuthentication, runGit = defaultTerminalCandidateRunGit
}) {

  const contract = await exactWkBoundContract({
    recordId: wkId,
    mainRepo,
    wkSha: candidate,
    runGit
  });
  const { deterministic, frozen, verified } = await authenticateTerminalCandidateObject({
    mainRepo, wkId, candidate, initiative: contract.initiative, runGit,
    freeze: (recovered) => freezeRecoveredTerminalWkCandidateInputs({
      ...recovered, generationAuthentication
    }),
    verify: async (derived) => {
      const binding = Object.freeze({
        ...derived,
        candidate_ref_state: derived.candidate_ref_state === "derived"
          ? "recovered"
          : derived.candidate_ref_state
      });
      await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
      return binding;
    }
  });
  return Object.freeze({ deterministic, contract, frozen, binding: verified });
}

async function authenticateTerminalCandidateObject({
  mainRepo, wkId, candidate, initiative, runGit, freeze, verify
}) {
  const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });

  const recoveredWkRef = `refs/heads/wk/${initiative}/${wkId}`;
  const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  const recoveredBaseRef = resolveTerminalWkCandidateBaseRef({
    mainRepo,
    wkRef: recoveredWkRef,
    base: metadata.base
  });
  const frozen = await freeze({
    mainRepo,
    baseRef: recoveredBaseRef,
    wkRef: recoveredWkRef,
    canonicalWkId: wkId,
    candidate,
    runGit
  }, metadata);
  const derived = await deriveRecoveredTerminalWkCandidateIdentity({
    frozen,
    runGit
  });
  if (derived.candidate !== candidate || derived.candidate_ref !== currentRef) {
    return { deterministic: false, frozen, verified: null };
  }
  return { deterministic: true, frozen, verified: await verify(derived) };
}

function failHistoricalTerminalCandidate(code, message, detail) {
  throw new TerminalWkCandidateError(message, { code, detail });
}

function readOnlyTerminalCandidateRequest(input, selector) {
  const fields = ["mainRepo", "wkId", selector, "runGit"];
  const unsupported = input === null || typeof input !== "object" || Array.isArray(input)
    ? null
    : Reflect.ownKeys(input).filter((key) => typeof key !== "string" || !fields.includes(key));
  if (unsupported === null || unsupported.length > 0) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      `read-only candidate authentication accepts only a repository, a WK and one ${selector}`, {
        fields: (unsupported ?? []).map(String).sort()
      });
  }
  const { mainRepo, wkId, runGit = defaultTerminalCandidateRunGit } = input;
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      path.resolve(mainRepo) !== mainRepo || typeof runGit !== "function") {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "read-only candidate authentication requires the coordinator-resolved repository", null);
  }
  return { mainRepo, wkId, runGit, selected: input[selector] };
}

async function authenticateReadOnlyTerminalCandidate({
  mainRepo, wkId, candidate, selection, runGit, freeze
}) {
  const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  if (metadata.canonical_wk_id !== wkId) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "selected candidate belongs to another WK", {
        ...selection, candidate, expected_wk: wkId, actual_wk: metadata.canonical_wk_id
      });
  }
  const observedRecord = await readExactWkRecordBlobObservation({
    mainRepo,
    wkTip: candidate,
    canonicalWkId: wkId,
    runGit,
    objectFormat: candidate.length === 64 ? "sha256" : "sha1"
  });
  if (observedRecord.state !== "present") {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "selected candidate holds no canonical WK record", {
        ...selection, candidate, path: observedRecord.path
      });
  }
  let record;
  try {
    record = JSON.parse(observedRecord.content);
  } catch (error) {
    throw new TerminalWkCandidateError(
      "selected candidate holds an unparseable WK record", {
        code: TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
        detail: { ...selection, candidate, path: observedRecord.path, oid: observedRecord.oid },
        cause: error
      });
  }
  if (record?.id !== wkId || !/^IN-\d{4}$/u.test(record?.initiative ?? "")) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "selected candidate record identity disagrees", {
        ...selection, candidate, path: observedRecord.path, expected_wk: wkId,
        actual_wk: typeof record?.id === "string" ? record.id : null
      });
  }
  const recordDigest = computeWorkRecordSourceDigest(record);
  if (recordDigest !== metadata.canonical_wk_digest) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "selected candidate record disagrees with its recorded contract digest", {
        ...selection, candidate, path: observedRecord.path,
        expected: metadata.canonical_wk_digest, actual: recordDigest
      });
  }
  const { deterministic, frozen, verified } = await authenticateTerminalCandidateObject({
    mainRepo, wkId, candidate, initiative: record.initiative, runGit,
    freeze: async (recovered, candidateMetadata) => freeze({
      ...recovered,

      generationAuthentication: assertControlledContractGenerationState(
        await authenticateControlledContractGenerationStateAtCommit({
          repoRoot: mainRepo, wkId, commit: candidateMetadata.wk_tip, deps: { runGit }
        }), {
          repository: mainRepo,
          wkId,
          wkTipSha: candidateMetadata.wk_tip
        })
    }),
    verify: (derived) => verifyHistoricalTerminalWkCandidateVersion({ binding: derived, runGit })
  });
  if (!deterministic) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID,
      "selected candidate is not the deterministic candidate of its own tuple", {
        ...selection, candidate, base: frozen.base, wk_tip: frozen.wk_tip
      });
  }
  return verified;
}

export async function authenticateHistoricalTerminalCandidate(input = {}) {
  const { mainRepo, wkId, runGit, selected: versionIdentity } =
    readOnlyTerminalCandidateRequest(input, "versionIdentity");
  const versionRef = deriveTerminalCandidateVersionRef({ canonicalWkId: wkId, versionIdentity });
  const selection = { version_ref: versionRef, version_identity: versionIdentity };
  const candidate = await observeExactDirectCommitRef({
    mainRepo, ref: versionRef, runGit, subject: "immutable candidate version ref"
  });
  if (candidate === null) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
      "selected immutable candidate version ref is absent", selection);
  }
  return authenticateReadOnlyTerminalCandidate({
    mainRepo, wkId, candidate, selection, runGit,
    freeze: (recovered) => freezeHistoricalTerminalWkCandidateInputs({
      ...recovered, versionIdentity
    })
  });
}

export async function authenticateObservedTerminalCandidateVersion(input = {}) {
  const { mainRepo, wkId, runGit, selected: candidate } =
    readOnlyTerminalCandidateRequest(input, "candidate");
  if (typeof candidate !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidate) ||
      /^0+$/u.test(candidate)) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT,
      "observed candidate authentication requires one exact full nonzero commit identity", null);
  }
  const currentRef = deriveTerminalCandidateCurrentRef({ canonicalWkId: wkId });
  const observed = await observeExactDirectCommitRef({
    mainRepo, ref: currentRef, runGit, subject: "current candidate ref"
  });
  if (observed !== candidate) {
    failHistoricalTerminalCandidate(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
      observed === null
        ? "current candidate ref is absent"
        : "current candidate ref does not name the expected candidate", {
        ref: currentRef,
        ref_disagreements: [{ ref: currentRef, expected: candidate, actual: observed }]
      });
  }
  return authenticateReadOnlyTerminalCandidate({
    mainRepo, wkId, candidate, selection: { current_ref: currentRef }, runGit,
    freeze: (recovered) => freezeObservedTerminalWkCandidateInputs(recovered)
  });
}
