

import {
  CONTROLLED_CONTRACT_PATCH_LIMITS,
  ControlledContractToolError,
  assertControlledContractOperationInput,
  composeProofPlanRequestEvaluationInputPaths,
  controlledContractCarrierFilename,
  readControlledContractCarrierSetManifestDigest,
  readControlledContractCarrierFile,
  rememberControlledContractAuthoringContinuation,
  resolveCanonicalControlledContractCarrierSet,
  validateControlledContractCarrierSetManifest,
  withCanonicalControlledContractSourceLease,
  writeControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import { CONTROLLED_CONTRACT_AUTHORING_REASONS } from
  "../../lib/controlled-contract-authoring-state.mjs";
import { readCanonicalProofPlanRequest } from
  "../../lib/controlled-contract-carrier-set-tools.mjs";
import { sameJsonValue } from
  "../../lib/controlled-contract-authoring-continuations.mjs";
import { isPlainObject } from "../../lib/controlled-contract-tool-shared.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import { throwProofGraphAuthoringFailure } from "./authoring-refusals.mjs";
import { controlledContractOperation } from "./refusal.mjs";

function integrationPrefixAuthoringReceipt({ wkId, authored, publication, accepted }) {
  return {
    schema_version: "integration-prefix-capture-authoring-receipt-v1",
    status: "published",
    identity: authored.identity,
    generation: accepted.generation,
    manifest_digest: accepted.manifest_digest,
    manifest_content_digest: publication.manifest_content_digest,
    counts: authored.counts,
    digests: authored.digests,
    content_references: Object.freeze({
      manifest: `controlled-contract-carrier-set://${wkId}/${accepted.generation}/manifest`,
      contract: `controlled-contract-carrier-set://${wkId}/${accepted.generation}/contract`,
      evaluation_inputs:
        `controlled-contract-carrier-set://${wkId}/${accepted.generation}/evaluation-inputs`,
      proof_plan_request:
        `controlled-contract-carrier-set://${wkId}/${accepted.generation}/proof-plan-request`,
      proof_plan:
        `controlled-contract-carrier-set://${wkId}/${accepted.generation}/proof-plan`
    })
  };
}

function assertIntegrationPrefixReceiptBound(receipt) {
  const receiptBytes = Buffer.byteLength(JSON.stringify(receipt), "utf8");
  if (receiptBytes > CONTROLLED_CONTRACT_PATCH_LIMITS.receipt_bytes) {
    throw new ControlledContractToolError(
      "controlled_contract_receipt_too_large",
      "integration-prefix authoring receipt exceeds its bounded presentation limit",
      { byte_length: receiptBytes,
        maximum_bytes: CONTROLLED_CONTRACT_PATCH_LIMITS.receipt_bytes }
    );
  }
}

const PROOF_AUTHORING_ISSUANCE_REASONS = Object.freeze({
  intentsMissing: "controlled_contract_proposal_issuance_intents_missing",
  inputMissing: "controlled_contract_proposal_issuance_input_missing",
  inputMixed: "controlled_contract_proposal_issuance_input_mixed",
  draftPartial: "controlled_contract_proposal_draft_partial"
});

const PROOF_AUTHORING_DRAFT_FIELDS = Object.freeze(["carrier_operations"]);

function proofAuthoringSkeletonCall(input, extra = {}) {
  return Object.freeze({
    tool: "workspace_controlled_proof_authoring_skeleton",
    arguments: Object.freeze({
      wk_id: input.wkId,
      ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
      selected_pack: input.selectedPack,
      ...extra
    })
  });
}

function assertProofAuthoringIssuance(input) {
  const hasBindings = input.bindings !== undefined;
  const hasEvaluationInput = input.evaluationInput !== undefined;
  const hasDraft = input.proposalDraft !== undefined;
  if (hasBindings && hasEvaluationInput) throw new ControlledContractToolError(
    PROOF_AUTHORING_ISSUANCE_REASONS.inputMixed,
    "supply exactly one semantic input: bindings or evaluation_input",
    {
      pointer: "/",
      supplied_semantic_inputs: ["bindings", "evaluation_input"],
      expected_semantic_input_count: 1,
      replacement_call: proofAuthoringSkeletonCall(input, {
        requested_intents: input.requestedIntents ?? [],
        bindings: input.bindings,
        ...(hasDraft ? { proposal_draft: input.proposalDraft } : {})
      })
    }
  );
  if (!hasDraft) return;
  assertControlledContractOperationInput(input.proposalDraft,
    [...PROOF_AUTHORING_DRAFT_FIELDS]);
  const missing = PROOF_AUTHORING_DRAFT_FIELDS.filter(
    (field) => !Object.hasOwn(input.proposalDraft, field));
  if (missing.length > 0) throw new ControlledContractToolError(
    PROOF_AUTHORING_ISSUANCE_REASONS.draftPartial,
    "proposal_draft carries exactly carrier_operations",
    {
      pointer: "/proposal_draft",
      missing_pointers: missing.map((field) => `/proposal_draft/${field}`),
      required_fields: [...PROOF_AUTHORING_DRAFT_FIELDS],

      replacement_call: proofAuthoringSkeletonCall(input, {
        ...(input.requestedIntents === undefined
          ? {} : { requested_intents: input.requestedIntents }),
        ...(hasEvaluationInput
          ? { evaluation_input: input.evaluationInput }
          : { bindings: input.bindings ?? {} })
      })
    }
  );
  if (input.requestedIntents === undefined) throw new ControlledContractToolError(
    PROOF_AUTHORING_ISSUANCE_REASONS.intentsMissing,
    "proposal issuance accompanies the explicit requested intents",
    {
      pointer: "/requested_intents",
      replacement_call: Object.freeze({
        tool: "workspace_controlled_proof_intents_discover",
        arguments: Object.freeze({})
      })
    }
  );
  if (!hasBindings && !hasEvaluationInput) throw new ControlledContractToolError(
    PROOF_AUTHORING_ISSUANCE_REASONS.inputMissing,
    "proposal issuance accompanies exactly one of bindings or evaluation_input",
    {
      pointer: "/",
      expected_semantic_inputs: ["bindings", "evaluation_input"],
      expected_semantic_input_count: 1,
      replacement_call: proofAuthoringSkeletonCall(input, {
        requested_intents: input.requestedIntents,
        bindings: {},
        proposal_draft: input.proposalDraft
      })
    }
  );
}

function proofAuthoringSkeletonNextAction({ input, skeleton, record }) {
  if (record !== null) return Object.freeze({
    tool: "workspace_controlled_contract_authoring_state",
    arguments: Object.freeze({
      wk_id: input.wkId,
      ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
      continuation: record.identity
    })
  });
  const unresolvedRoles = skeleton.unresolved_required_roles.map(({ role }) => role);
  if (unresolvedRoles.length > 0 || skeleton.evaluation_input_diagnostics.length > 0) {
    return Object.freeze({
      tool: "workspace_controlled_proof_pack_bindings_inspect",
      arguments: Object.freeze({
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null
          ? {} : { focus: input.focus }),
        profile_id: skeleton.selected_pack.profile_id,
        profile_version: skeleton.selected_pack.profile_version,
        requested_intents: [...skeleton.requested_intents],
        ...(unresolvedRoles.length > 0
          ? { roles: [...new Set(unresolvedRoles)].slice(0, 64) } : {})
      })
    });
  }
  return Object.freeze({
    ...proofAuthoringSkeletonCall(input, {
      requested_intents: [...skeleton.requested_intents],
      ...(input.evaluationInput === undefined
        ? { bindings: input.bindings ?? {} }
        : { evaluation_input: input.evaluationInput })
    }),
    verification_bundles: structuredClone(skeleton.verification_bundles),
    evaluation_input_skeleton:
      structuredClone(skeleton.evaluation_input_skeleton),
    proof_plan_request: structuredClone(skeleton.proof_plan_request),
    author_semantics: Object.freeze([Object.freeze({
      pointer: "/proposal_draft",
      target_type: "controlled_proof_graph_proposal_draft",
      requirement:
        "supply carrier_operations to issue a server continuation; the exact source declaration is server-owned",
      required_fields: Object.freeze([...PROOF_AUTHORING_DRAFT_FIELDS])
    })])
  });
}

function canonicalExpectedSource({ canonicalSet, carrierKind, basename }) {
  const member = canonicalSet.members_by_basename[basename] ?? null;
  return Object.freeze({
    carrier_kind: carrierKind,
    presence: member === null ? "absent" : "present",
    expected_content_digest: member === null ? null : member.content_digest
  });
}

function deriveCanonicalSourceDeclaration({
  carrierKinds, canonicalSet, wkId, focus, selectedPack
}) {
  const basenames = {
    contract: controlledContractCarrierFilename({
      wkId, focus, carrierKind: "contract"
    }),
    evaluation_input: selectedPack.evaluation_input_path,
    proof_plan_request: controlledContractCarrierFilename({
      wkId, focus, carrierKind: "proof_plan_request"
    })
  };
  return carrierKinds.map((carrierKind) => canonicalExpectedSource({
    canonicalSet, carrierKind, basename: basenames[carrierKind]
  }));
}

const SERVER_KNOWN_PROPOSAL_TARGETS = Object.freeze([
  Object.freeze({
    carrierKind: "evaluation_input",
    target: "reference_bindings",
    resolve: (skeleton) => skeleton.evaluation_input?.reference_bindings
  }),
  Object.freeze({
    carrierKind: "evaluation_input",
    target: "number_bindings",
    resolve: (skeleton) => skeleton.evaluation_input?.number_bindings
  }),
  Object.freeze({
    carrierKind: "evaluation_input",
    target: "evaluation_stage",
    resolve: (skeleton) => skeleton.evaluation_input?.evaluation_stage
  }),
  Object.freeze({
    carrierKind: "proof_plan_request",
    target: "requested_intents",
    resolve: (skeleton) => skeleton.proof_plan_request?.requested_intents
  }),
  Object.freeze({
    carrierKind: "proof_plan_request",
    target: "selected_packs",

    resolve: (skeleton) => (skeleton.proof_plan_request?.selected_packs ?? []).find(
      (pack) => pack?.profile_id === skeleton.selected_pack.profile_id &&
        pack?.profile_version === skeleton.selected_pack.profile_version)
  })
]);

function serverKnownPopulation(known, skeleton) {
  const resolved = known.resolve(skeleton);
  if (resolved === undefined || resolved === null) return [];
  return Array.isArray(resolved) ? resolved.filter((value) => value !== undefined)
    : [resolved];
}

function serverKnownTargetIdentity({ pkg, carrierKind, target, value }) {
  return pkg.carrierValueId(target,
    pkg.CONTROLLED_CONTRACT_CARRIER_TARGETS[carrierKind][target], value);
}

function declaredTargetIdentity({ pkg, carrierKind, target, operation }) {

  if (pkg.CONTROLLED_CONTRACT_CARRIER_TARGETS[carrierKind][target] === "scalar") {
    return serverKnownTargetIdentity({ pkg, carrierKind, target, value: undefined });
  }
  if (operation.id !== undefined) return operation.id;
  if (operation.value === undefined) return null;
  return serverKnownTargetIdentity({ pkg, carrierKind, target, value: operation.value });
}

function serverKnownValueCompatible(declared, resolved) {
  if (!isPlainObject(resolved)) return sameJsonValue(declared, resolved);
  if (!isPlainObject(declared)) return false;
  return Object.keys(resolved).every((field) => Object.hasOwn(declared, field) &&
    sameJsonValue(declared[field], resolved[field]));
}

function declaredServerKnownValue({ pkg, carrierOperations, carrierKind, target, identity }) {
  let index = -1;
  let value;
  for (const [position, operation] of carrierOperations.entries()) {
    if (!isPlainObject(operation) || operation.kind !== "carrier_patch" ||
        operation.carrier_kind !== carrierKind || operation.target !== target) continue;
    if (declaredTargetIdentity({ pkg, carrierKind, target, operation }) !== identity) continue;
    index = position;
    value = operation.op === "remove" ? undefined : operation.value;
  }
  return { index, value };
}

function resolveServerKnownProposalOperations({ input, pkg, skeleton }) {
  const carrierOperations = input.proposalDraft.carrier_operations;
  if (!Array.isArray(carrierOperations)) return carrierOperations;
  const filled = [];
  for (const known of SERVER_KNOWN_PROPOSAL_TARGETS) {
    for (const resolved of serverKnownPopulation(known, skeleton)) {
      const identity = serverKnownTargetIdentity({
        pkg, carrierKind: known.carrierKind, target: known.target, value: resolved
      });
      const declared = declaredServerKnownValue({
        pkg, carrierOperations, carrierKind: known.carrierKind,
        target: known.target, identity
      });
      if (declared.index < 0) {
        filled.push({
          kind: "carrier_patch",
          carrier_kind: known.carrierKind,
          op: "upsert",
          target: known.target,
          value: structuredClone(resolved)
        });
        continue;
      }
      if (serverKnownValueCompatible(declared.value, resolved)) continue;
      throwProofGraphAuthoringFailure({
        input,
        reasonCode: CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
        details: {
          carrier_kind: known.carrierKind,
          pointer: `/proposal_draft/carrier_operations/${declared.index}`,
          target: known.target,
          target_identity: identity,
          declared_operation: carrierOperations[declared.index].op ?? null,
          declared_value: declared.value === undefined
            ? null : structuredClone(declared.value),
          resolved_value: structuredClone(resolved)
        }
      });
    }
  }
  return filled.length === 0 ? carrierOperations : [...carrierOperations, ...filled];
}

export async function buildProofAuthoringSkeletonOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "selectedPack", "requestedIntents",
      "bindings", "evaluationInput", "proposalDraft"
    ]);
    if (input.selectedPack === undefined) {
      if (input.requestedIntents !== undefined || input.bindings !== undefined ||
          input.evaluationInput !== undefined || input.proposalDraft !== undefined) {
        throw new ControlledContractToolError(
        "controlled_contract_request_field_forbidden",
        "canonical integration-prefix authoring accepts only server-resolved WK and focus identity"
        );
      }
      return withCanonicalControlledContractSourceLease({
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        focus: input.focus ?? null
      }, async (source) => {
        const pkg = await loadControlledContractPackage();
        const authored = await pkg.buildProofAuthoringSkeleton({
          canonicalRecord: source.record,
          contract: source.contract,
          mappingContracts: source.related_contracts.map(({ content }) => content),
          slices: source.record.slices,
          proofPlanRequest: source.proof_plan_request,
          evaluationInputs: source.evaluation_inputs,
          focus: input.focus ?? null
        });
        const expectedManifestDigest = await readControlledContractCarrierSetManifestDigest({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null
        });
        const profile = {
          profileId: authored.identity.profile_id,
          profileVersion: authored.identity.profile_version
        };
        assertIntegrationPrefixReceiptBound(integrationPrefixAuthoringReceipt({
          wkId: input.wkId,
          authored,
          publication: { manifest_content_digest: `sha256:${"0".repeat(64)}` },
          accepted: {
            generation: "0".repeat(64),
            manifest_digest: `sha256:${"0".repeat(64)}`
          }
        }));
        const publication = await writeControlledContractCarrierSet({
          repoRoot: input.repoRoot,
          repository: authored.identity.repository,
          wkId: input.wkId,
          focus: input.focus ?? null,
          profile,
          expected_manifest_digest: expectedManifestDigest,
          sourceLease: source.lease,
          carriers: {
            contract: authored.contract,
            evaluation_inputs: authored.evaluation_inputs,
            proof_plan_request: authored.proof_plan_request,
            proof_plan: authored.proof_plan
          },
          artifact_members: authored.artifact_members,
          integration: {
            dag: authored.dag,
            evaluation_inputs: authored.evaluation_inputs,
            request: authored.proof_plan_request,
            integration_units: authored.integration_units,
            source_map: authored.source_map,
            paths: authored.execution_paths,
            branches: authored.branches
          },
          bound_digests: {
            ...authored.digests,
            canonical_sources: source.source_digests
          }
        });
        const accepted = await validateControlledContractCarrierSetManifest({
          repoRoot: input.repoRoot,
          wkId: input.wkId,
          focus: input.focus ?? null,
          repository: authored.identity.repository,
          profile
        });
        const receipt = integrationPrefixAuthoringReceipt({
          wkId: input.wkId, authored, publication, accepted
        });
        assertIntegrationPrefixReceiptBound(receipt);
        return Object.freeze(receipt);
      });
    }
    assertProofAuthoringIssuance(input);
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null
    });
    const contract = await readControlledContractCarrierFile({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      carrierKind: "contract",
      canonicalSet
    });

    const requestedSelectedPackIdentity = {
      profile_id: input.selectedPack.profile_id,
      profile_version: input.selectedPack.profile_version
    };
    const persistedRequest = (await readCanonicalProofPlanRequest({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      canonicalSet
    })).content;
    const persistedPacks = Array.isArray(persistedRequest?.selected_packs)
      ? persistedRequest.selected_packs.filter(isPlainObject) : [];
    const composedPopulation = [
      ...persistedPacks.filter(({ profile_id: profileId,
        profile_version: profileVersion }) =>
        profileId !== requestedSelectedPackIdentity.profile_id ||
        profileVersion !== requestedSelectedPackIdentity.profile_version),
      input.selectedPack
    ];
    const composedPacks = (await composeProofPlanRequestEvaluationInputPaths({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      content: { selected_packs: composedPopulation },
      canonicalSet
    })).selected_packs;
    const selectedPack = composedPacks.find(({ profile_id: profileId,
      profile_version: profileVersion }) =>
      profileId === requestedSelectedPackIdentity.profile_id &&
      profileVersion === requestedSelectedPackIdentity.profile_version);
    if (selectedPack === undefined) {
      throw new Error("package composition omitted the requested selected-pack identity");
    }
    const pkg = await loadControlledContractPackage();
    const skeleton = await pkg.buildProofAuthoringSkeleton({
      contract: contract.content,
      selectedPack,
      requestedIntents: input.requestedIntents,
      focus: input.focus ?? null,
      ...(persistedRequest === null ? {} : {
        currentProofPlanRequest: {
          ...persistedRequest,
          selected_packs: composedPacks.filter(({ profile_id: profileId,
            profile_version: profileVersion }) =>
            profileId !== requestedSelectedPackIdentity.profile_id ||
            profileVersion !== requestedSelectedPackIdentity.profile_version)
        }
      }),
      ...(input.evaluationInput === undefined
        ? { bindings: input.bindings ?? {} }
        : { evaluationInput: input.evaluationInput })
    });
    let record = null;
    const reusable = skeleton.unresolved_required_roles.length === 0 &&
      skeleton.evaluation_input_diagnostics.length === 0;
    if (input.proposalDraft !== undefined && reusable) {

      const carrierOperations = resolveServerKnownProposalOperations({
        input, pkg, skeleton
      });
      const proposal = {
        schema_version: "controlled-proof-graph-proposal.v1",
        wk_id: input.wkId,
        focus: input.focus ?? null,
        contract_content_digest: contract.content_digest,
        selected_pack: {
          profile_id: skeleton.selected_pack.profile_id,
          profile_version: skeleton.selected_pack.profile_version
        },
        requested_intents: structuredClone(skeleton.requested_intents),
        skeleton_continuation: {
          continuation: structuredClone(skeleton.continuation),
          unresolved_required_roles:
            structuredClone(skeleton.unresolved_required_roles)
        },
        carrier_operations: structuredClone(carrierOperations)
      };

      record = await rememberControlledContractAuthoringContinuation({
        repoRoot: input.repoRoot,
        wkId: input.wkId, focus: input.focus ?? null, contract, skeleton,
        semanticBindings: input.evaluationInput ?? input.bindings,
        proposal,
        expectedSources: deriveCanonicalSourceDeclaration({
          carrierKinds: pkg.PROOF_GRAPH_CARRIER_KINDS,
          canonicalSet,
          wkId: input.wkId,
          focus: input.focus ?? null,

          selectedPack: skeleton.selected_pack
        })
      });
    }
    return Object.freeze({
      schema_version: skeleton.schema_version,
      selected_pack: skeleton.selected_pack,
      requested_intents: skeleton.requested_intents,
      focus: skeleton.focus,
      evaluation_input: skeleton.evaluation_input,
      proof_plan_request: skeleton.proof_plan_request,
      unresolved_required_roles: skeleton.unresolved_required_roles,
      evaluation_input_diagnostics: skeleton.evaluation_input_diagnostics,
      ...(record === null ? {} : { continuation: record.identity }),
      continuation_issued: record !== null,
      next_action: proofAuthoringSkeletonNextAction({ input, skeleton, record }),
      digests: skeleton.digests
    });
  });
}
