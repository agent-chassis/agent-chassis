

import {
  isControlledContractGenerationNotPersisted,
  persistControlledContractGeneration,
  resolveControlledContractGenerationBinding
} from "@agent-chassis/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import {
  authorityGitArgs,
  classifyAncestryObservation,
  mintGitFailure,
  TERMINAL_WK_CANDIDATE_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-ref-publication.mjs";
import { resolveControlledContractSavedAuthoringSources } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { resolveControlledContractAttachmentGeneration } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  deriveTerminalCandidateDurableRefs,
  observeExactDirectCommitRef,
  readTerminalWkCandidateMetadata
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export const isControlledGenerationNotPersisted = isControlledContractGenerationNotPersisted;

export async function synchronizeControlledContractGeneration({ mainRepo, wkId, deps = {} }) {
  const generation = await resolveControlledContractAttachmentGeneration({ repoRoot: mainRepo, wkId });
  const population = generation ??
    await resolveControlledContractSavedAuthoringSources({ repoRoot: mainRepo, wkId });
  if (population === null) return null;
  const binding = await resolveControlledContractGenerationBinding({
    repoRoot: mainRepo, wkId, generation: population, lifecycleBinding: null, deps
  });
  const receipt = await persistControlledContractGeneration({ binding, deps });

  const effect = receipt.invocation.ref_write_succeeded === true ? "persisted" : "existing";
  const tips = { wk_ref: receipt.ref, previous_wk_tip: receipt.bound_tip, wk_tip: receipt.final_tip };
  return Object.freeze(generation === null
    ? { authoring_sources: effect, ...tips, authoring_sources_digest: receipt.generation.digest }
    : { generation: effect, ...tips, generation_digest: receipt.generation.digest });
}

export async function selectedCandidateAdmitsLaterWkTip({
  mainRepo, wkId, initiative, candidate, runGit
}) {
  const metadata = await readTerminalWkCandidateMetadata({ mainRepo, candidate, runGit });
  if (metadata.canonical_wk_id !== wkId) return false;
  const { wk_ref: wkRef, fork_ref: forkRef } =
    deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId: wkId });
  const fork = await observeExactDirectCommitRef({
    mainRepo, ref: forkRef, runGit, subject: "durable WK fork ref"
  });
  if (fork === null || fork !== metadata.base) return false;
  const wkTip = await observeExactDirectCommitRef({ mainRepo, ref: wkRef, runGit, subject: "durable WK ref" });
  if (wkTip === null) return false;
  if (wkTip === metadata.wk_tip) return true;
  const args = authorityGitArgs(["merge-base", "--is-ancestor", metadata.wk_tip, wkTip]);
  const result = await runGit({ repo: mainRepo, args, env: null });
  const observed = classifyAncestryObservation(result);
  if (observed === "failed") {
    throw mintGitFailure(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
      "could not complete the ancestry comparison of the selected candidate's WK tip and the current WK tip",
      result, { args, ref: wkRef });
  }
  return observed === "ancestor";
}

const preparationAccounts = new WeakMap();

export function createTerminalCandidatePublicationAccount({ beforeFirstWrite = null } = {}) {
  const facts = { generation: null, candidate: null };
  let admitted = false;

  const project = () => facts.generation === null && facts.candidate === null ? null : Object.freeze({
    ...(facts.generation?.authoring_sources === "persisted" ? { authoring_sources: "persisted" }
      : { generation: facts.generation?.generation ?? "existing" }),
    ...(facts.generation === null ? {} : {
      wk_ref: facts.generation.wk_ref,
      previous_wk_tip: facts.generation.previous_wk_tip,
      wk_tip: facts.generation.wk_tip,
      ...(facts.generation.authoring_sources === "persisted"
        ? { authoring_sources_digest: facts.generation.authoring_sources_digest }
        : { generation_digest: facts.generation.generation_digest })
    }),

    ...(facts.candidate === null ? {} : {
      terminal_candidate: "replaced",
      previous_candidate: facts.candidate.previous,
      candidate: facts.candidate.candidate
    })
  });
  return Object.freeze({
    admitWrite: async () => {
      if (admitted) return;
      if (beforeFirstWrite !== null) await beforeFirstWrite();
      admitted = true;
    },

    recordGeneration: (synchronized) => {
      if (synchronized?.generation === "persisted" || synchronized?.authoring_sources === "persisted") {
        facts.generation = synchronized;
      }
    },
    recordReplacement: ({ previous, candidate }) => {
      facts.candidate = Object.freeze({ previous, candidate });
    },
    project,
    attach: (value) => {
      const account = project();
      if (account !== null && ((typeof value === "object" && value !== null) || typeof value === "function")) {
        preparationAccounts.set(value, account);
      }
      return account;
    }
  });
}

export function projectTerminalCandidatePublicationSynchronization(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return null;
  return preparationAccounts.get(error) ?? null;
}
