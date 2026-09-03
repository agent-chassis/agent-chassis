

import {
  CONTROLLED_CONTRACT_PATCH_LIMITS,
  ControlledContractToolError,
  assertControlledContractOperationInput,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  deriveCanonicalControlledContractAuthoringState,
  resolveControlledContractAuthoringContinuationMutation,
  updateControlledContractAuthoringProofGraphContinuation,
  validateControlledContractCarrierSetManifest,
  withCanonicalControlledContractSourceLease,
  writeControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import { CONTROLLED_CONTRACT_AUTHORING_REASONS } from
  "../../lib/controlled-contract-authoring-state.mjs";
import {
  reconcileControlledContractAuthoringProofGraphPublication
} from "../../lib/controlled-contract-authoring-continuations.mjs";
import { CARRIER_SET_SCHEMA_VERSION } from
  "../../lib/controlled-contract-carrier-set-publication.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import { throwAuthoringRefusal, throwProofGraphAuthoringFailure } from
  "./authoring-refusals.mjs";
import { controlledContractOperation } from "./refusal.mjs";

function proofGraphStateCall(input, continuation = input.continuation) {
  return Object.freeze({
    tool: "workspace_controlled_contract_authoring_state",
    arguments: Object.freeze({
      wk_id: input.wkId,
      ...(input.focus === undefined || input.focus === null
        ? {} : { focus: input.focus }),
      continuation
    })
  });
}

function proofGraphReceipt({ input, publication, proposalDigest, continuation }) {
  const receipt = {
    schema_version: "controlled-contract-proof-graph-publication.v1",
    publication: Object.freeze({
      schema_version: publication.schema_version,
      profile: "canonical_authoring",
      wk_id: input.wkId,
      focus: input.focus ?? null,
      generation: publication.generation,
      manifest_digest: publication.manifest_digest,
      manifest_content_digest: publication.manifest_content_digest,
      carrier_count: publication.carrier_count,
      proposal_digest: proposalDigest,
      written: publication.written,
      no_op: publication.no_op === true
    }),
    next_call: proofGraphStateCall(input, continuation)
  };
  const byteLength = Buffer.byteLength(JSON.stringify(receipt), "utf8");
  if (byteLength > CONTROLLED_CONTRACT_PATCH_LIMITS.receipt_bytes) {
    throw new ControlledContractToolError("controlled_contract_receipt_too_large",
      "proof-graph publication receipt exceeds 8,192 UTF-8 bytes", {
        byte_length: byteLength
      });
  }
  return Object.freeze(receipt);
}

export async function continueControlledContractProofGraphOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "continuation"
    ]);
    const mutation = await resolveControlledContractAuthoringContinuationMutation({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      continuation: input.continuation
    });
    const reconciled = await reconcileControlledContractAuthoringProofGraphPublication({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      identity: input.continuation,
      canonicalSet: mutation.canonicalSet
    });
    if (reconciled !== null) {
      return proofGraphReceipt({
        input,
        proposalDigest: reconciled.proof_graph.proposal_digest,
        publication: { ...reconciled.proof_graph.publication,
          written: false, no_op: true },
        continuation: reconciled.identity
      });
    }
    if (mutation.refused) throwAuthoringRefusal(mutation.refused);
    if (mutation.mode === "proof_graph_replay") {
      const stored = mutation.continuationRecord.proof_graph.publication;
      return proofGraphReceipt({
        input,
        proposalDigest: mutation.continuationRecord.proof_graph.proposal_digest,
        publication: { ...stored, written: false, no_op: true },
        continuation: mutation.continuationRecord.identity
      });
    }
    if (mutation.mode !== "proof_graph") {
      throwProofGraphAuthoringFailure({
        input,
        reasonCode: CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationStale,
        details: { expected_stage: "proof_graph_required" }
      });
    }
    const proposal = mutation.proposal;
    try {
      return await withCanonicalControlledContractSourceLease({
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        focus: input.focus ?? null,
        continuation: mutation.continuationRecord.identity,
        canonicalSet: mutation.canonicalSet
      }, async (source) => {
        const fenced = await resolveControlledContractAuthoringContinuationMutation({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          continuation: mutation.continuationRecord.identity,
          canonicalSet: source.canonical_set
        });
        if (fenced.refused) throwAuthoringRefusal(fenced.refused);
        const pkg = await loadControlledContractPackage();
        let composed;
        try {

          composed = await pkg.composeProofGraphCarrierSet({
            proposal,
            expected_sources:
              source.continuation_record.proof_graph.expected_sources,
            sources: source.sources
          });
        } catch (error) {
          const allowed = new Set([
            CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphProposalIncomplete,
            CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphCrossCarrierIdentityConflict,
            CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphBoundExceeded
          ]);
          throwProofGraphAuthoringFailure({
            input,
            reasonCode: allowed.has(error?.code)
              ? error.code
              : CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
            details: { cause_code: error?.code ?? null, ...(error?.details ?? {}) }
          });
        }
        if (composed.status !== "composed") {
          const pointers = composed.unresolved_pointers.map(({ pointer }) => pointer).sort();
          const incomplete = await updateControlledContractAuthoringProofGraphContinuation({
            repoRoot: input.repoRoot,
            wkId: input.wkId,
            focus: input.focus ?? null,
            identity: mutation.continuationRecord.identity,
            changes: {
            status: "incomplete",
            unresolved_pointers: pointers,
            missing_graph_identities: [...new Set(composed.unresolved_pointers
              .map(({ carrier_kind: kind }) => kind).filter(Boolean))].sort()
            }
          });
          throwProofGraphAuthoringFailure({
            input,
            reasonCode: CONTROLLED_CONTRACT_AUTHORING_REASONS.proofGraphProposalIncomplete,
            continuation: incomplete.identity,
            details: {
              unresolved_pointer_count: pointers.length,
              unresolved_pointers: pointers
            }
          });
        }
        const canonicalMembers = structuredClone(source.canonical_members);
        for (const carrier of composed.carriers) {
          canonicalMembers[source.target_by_kind[carrier.carrier_kind]] = carrier.content;
        }
        if (composed.carriers.some(({ changed }) => changed)) {
          delete canonicalMembers[controlledContractCarrierFilename({
            wkId: input.wkId,
            focus: input.focus ?? null,
            carrierKind: "proof_plan"
          })];
        }
        const memberDigests = Object.fromEntries(Object.entries(canonicalMembers)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([basename, content]) => [basename, controlledContractContentDigest(content)]));
        const contractName = controlledContractCarrierFilename({
          wkId: input.wkId,
          focus: input.focus ?? null,
          carrierKind: "contract"
        });
        const publishing = await updateControlledContractAuthoringProofGraphContinuation({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          identity: mutation.continuationRecord.identity,
          changes: {
            status: "publishing",
            result_contract_content_digest: memberDigests[contractName],
            result_member_digests: memberDigests,
            publication_schema_version: CARRIER_SET_SCHEMA_VERSION
          }
        });
        const publication = await writeControlledContractCarrierSet({
          repoRoot: input.repoRoot,
          repository: source.record.repo,
          wkId: input.wkId,
          focus: input.focus ?? null,
          profile: "canonical_authoring",
          expected_manifest_digest: source.manifest_content_digest,
          sourceLease: source.lease,
          canonical_members: canonicalMembers
        });
        const accepted = await validateControlledContractCarrierSetManifest({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          repository: source.record.repo,
          profile: "canonical_authoring"
        });
        if (accepted.generation !== publication.generation ||
            accepted.manifest_digest !== publication.manifest_digest) {
          throwProofGraphAuthoringFailure({
            input,
            reasonCode: CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
            details: { carrier_kind: "canonical_generation" }
          });
        }
        const published = await updateControlledContractAuthoringProofGraphContinuation({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          identity: publishing.identity,
          changes: {
          status: "published",
          unresolved_pointers: [],
          missing_graph_identities: [],
          result_contract_content_digest: memberDigests[contractName],
          result_manifest_content_digest: publication.manifest_content_digest,
          result_member_digests: memberDigests,
          publication
          }
        });

        await deriveCanonicalControlledContractAuthoringState({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          continuation: published.identity
        });
        return proofGraphReceipt({
          input, publication, proposalDigest: mutation.proposalDigest,
          continuation: published.identity
        });
      });
    } catch (error) {
      if (error?.details?.replacement_call ||
          error?.code === "controlled_contract_receipt_too_large") throw error;
      const stale = typeof error?.code === "string" &&
        error.code.startsWith("controlled_contract_source_lease_");
      throwProofGraphAuthoringFailure({
        input,
        reasonCode: stale
          ? CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationStale
          : CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
        details: { cause_code: error?.code ?? null, ...(error?.details ?? {}) }
      });
    }
  });
}
