import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  assertCanonicalWorkRecordReadLease,
  withCanonicalWorkRecordReadLease
} from "../operations/work-records-store-io.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_KINDS,
  isPlainObject,
  normalizeControlledContractIdentity,
  controlledContractCarrierFilename,
  classifyControlledContractCarrierBasename,
  digestBytes,
  canonicalJsonBytes,
  loadControlledContractPackage,
  resolveControlledContractRepository,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";
import {
  assertOneControlledContractSemanticOwner,
  getControlledContractAuthoringContinuation,
  sameJsonValue
} from "./controlled-contract-authoring-continuations.mjs";
import {
  authenticatedSelectedPackEvaluationBasename,
  resolveManifestControlledContractCarrierFilename
} from "./controlled-contract-carrier-set-evaluation.mjs";
import {
  acquireCarrierLock,
  activateControlledContractSourceLease,
  canonicalEvaluationBasenames,
  releaseCarrierLock,
  sourceLeaseFailure
} from "./controlled-contract-source-lease-primitives.mjs";

export async function withCanonicalControlledContractSourceLeaseImpl({
  repoRoot, wkId, focus = null, maximumDurationMs = 60_000,
  continuation = null, mutation = null, canonicalSet = null
}, callback, dependencies) {
  const {
    processStartIdentity,
    resolveCanonicalControlledContractCarrierSet
  } = dependencies;
  const lockCarrier = (file, owner) =>
    acquireCarrierLock(file, owner, { processStartIdentity });
  if (typeof callback !== "function") sourceLeaseFailure("input_invalid",
    "canonical source lease requires one callback");
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await resolveControlledContractRepository(repoRoot);
  const processStart = await processStartIdentity(process.pid).catch(() => null);
  if (processStart === null) sourceLeaseFailure("recovery_unavailable",
    "source lease cannot bind the current process start identity");
  const publicationOwner = Object.freeze({
    operationToken: randomUUID(), processStart
  });
  return withCanonicalWorkRecordReadLease({
    dir: store.repository, id: wkId, maximumDurationMs
  }, async ({ lease: recordLease, record, source_digest: recordDigest }) => {
    if (mutation !== null) {
      if (!isPlainObject(mutation) ||
          !CONTROLLED_CONTRACT_CARRIER_KINDS.includes(mutation.carrierKind)) {
        sourceLeaseFailure("input_invalid", "canonical mutation identity is invalid");
      }
      const before = canonicalSet ?? await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId, focus
      });
      const targetFilename = resolveManifestControlledContractCarrierFilename({
        canonicalSet: before,
        wkId,
        focus,
        carrierKind: mutation.carrierKind,
        pack: mutation.pack ?? null,
        preferPack: mutation.preferPack === true
      });
      const basenames = [...new Set([
        ...before.members.map(({ filename }) => filename), targetFilename
      ])].sort();
      const locks = [];
      try {
        for (const basename of basenames) {
          locks.push(await lockCarrier(
            path.join(store.contracts, basename), publicationOwner));
        }
        const underLock = await resolveCanonicalControlledContractCarrierSet({
          repoRoot: store.repository, wkId, focus
        });
        if (underLock.source !== before.source ||
            underLock.manifest_content_digest !== before.manifest_content_digest ||
            !sameJsonValue(underLock.members.map(({ filename, content_digest: digest }) =>
              [filename, digest]), before.members.map(
              ({ filename, content_digest: digest }) => [filename, digest]))) {
          sourceLeaseFailure("source_stale",
            "canonical mutation source population changed before ordered lease acquisition");
        }
        const canonicalMemberDigests = Object.fromEntries(basenames.map((basename) => [
          basename, underLock.members_by_basename[basename]?.content_digest ?? null
        ]));
        const snapshot = {
          canonical_set_source: underLock.source,
          manifest_content_digest: underLock.manifest_content_digest,
          canonical_member_digests: canonicalMemberDigests,
          source_digests: {
            "work-record": assertCanonicalWorkRecordReadLease(recordLease, {
              dir: store.repository, id: wkId
            }).source_digest,
            "canonical-generation-manifest": underLock.manifest_content_digest,
            ...canonicalMemberDigests
          }
        };
        const token = Object.freeze(Object.create(null));
        const state = {
          active: true,
          expiresAt: Date.now() + maximumDurationMs,
          focus: focus ?? null,
          recordLease,
          repository: record.repo,
          publicationOwner,
          snapshot,
          store,
          wkId
        };
        activateControlledContractSourceLease(token, state);
        try {
          return await callback(Object.freeze({
            lease: token,
            record,
            record_source_digest: recordDigest,
            canonical_set: underLock,
            canonical_members: deepFreezePlainData(Object.fromEntries(
              underLock.members.map((member) =>
                [member.filename, structuredClone(member.content)]))),
            target_filename: targetFilename,
            source_digests: Object.freeze(structuredClone(snapshot.source_digests)),
            manifest_content_digest: underLock.manifest_content_digest
          }));
        } finally {
          state.active = false;
        }
      } finally {
        for (const locked of locks.reverse()) await releaseCarrierLock(locked);
      }
    }
    if (continuation !== null) {
      const continuationRecord = await getControlledContractAuthoringContinuation({
        repoRoot: store.repository, identity: continuation
      });
      if (!continuationRecord?.proof_graph) sourceLeaseFailure(
        "source_invalid", "proof-graph leasing requires one bound closed proposal");

      try {
        assertOneControlledContractSemanticOwner(continuationRecord);
      } catch (error) {
        sourceLeaseFailure("source_invalid",
          "the continuation record no longer has one semantic owner",
          { cause_code: error?.code ?? null, field: error?.details?.field ?? null });
      }
      const proposal = continuationRecord.proof_graph.proposal;
      const selected = continuationRecord.skeleton.selected_pack;

      let evaluationBasename;
      try {
        evaluationBasename = authenticatedSelectedPackEvaluationBasename({
          wkId, focus, selectedPack: selected
        });
      } catch (error) {
        sourceLeaseFailure("source_invalid",
          "selected pack resolves a noncanonical evaluation basename",
          { cause_code: error?.code ?? null });
      }
      const targetByKind = {
        contract: controlledContractCarrierFilename({
          wkId, focus, carrierKind: "contract"
        }),
        evaluation_input: evaluationBasename,
        proof_plan_request: controlledContractCarrierFilename({
          wkId, focus, carrierKind: "proof_plan_request"
        })
      };
      const before = canonicalSet ?? await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId, focus
      });
      const basenames = [...new Set([
        ...before.members.map(({ filename }) => filename),
        ...Object.values(targetByKind)
      ])].sort();
      const locks = [];
      try {
        for (const basename of basenames) {
          locks.push(await lockCarrier(
            path.join(store.contracts, basename), publicationOwner));
        }
        const underLock = await resolveCanonicalControlledContractCarrierSet({
          repoRoot: store.repository, wkId, focus
        });
        if (underLock.source !== before.source ||
            underLock.manifest_content_digest !== before.manifest_content_digest ||
            !sameJsonValue(underLock.members.map(({ filename, content_digest: digest }) =>
              [filename, digest]), before.members.map(
              ({ filename, content_digest: digest }) => [filename, digest]))) {
          sourceLeaseFailure("source_stale",
            "canonical source population changed before ordered lease acquisition");
        }
        const expectationByKind = new Map(
          continuationRecord.proof_graph.expected_sources.map(
            (entry) => [entry.carrier_kind, entry])
        );
        const sources = {};
        for (const [kind, basename] of Object.entries(targetByKind)) {
          const member = underLock.members_by_basename[basename] ?? null;
          const expectation = expectationByKind.get(kind);
          const matches = expectation?.presence === "present"
            ? member?.content_digest === expectation.expected_content_digest
            : expectation?.presence === "absent" && member === null;
          if (!matches) sourceLeaseFailure("source_stale",
            "proof-graph source expectation changed before composition", {
              basename,
              expected_content_digest: expectation?.expected_content_digest ?? null,
              actual_content_digest: member?.content_digest ?? null
            });
          if (member) sources[kind] = structuredClone(member.content);
        }
        const pkg = await loadControlledContractPackage();
        if (pkg.PACKAGE_VERSION !== continuationRecord.package_generation) {
          sourceLeaseFailure("source_stale",
            "controlled-contract package generation changed after continuation issuance");
        }

        const storedRequest = continuationRecord.skeleton.proof_plan_request ?? null;
        const currentProofPlanRequest = sources.proof_plan_request === undefined
          ? null
          : {
            ...structuredClone(storedRequest ?? {}),
            selected_packs: (storedRequest?.selected_packs ?? []).filter(
              (pack) => pack?.profile_id !== selected.profile_id ||
                pack?.profile_version !== selected.profile_version
            ).map((pack) => structuredClone(pack))
          };
        let resolvedSkeleton;
        try {
          resolvedSkeleton = await pkg.continueProofAuthoring({
            contract: sources.contract,
            selectedPack: structuredClone(selected),
            requestedIntents: structuredClone(
              continuationRecord.skeleton.requested_intents),
            focus,
            evaluationInput: structuredClone(
              continuationRecord.skeleton.evaluation_input),
            continuation: structuredClone(continuationRecord.package_continuation),
            ...(currentProofPlanRequest === null
              ? {} : { currentProofPlanRequest })
          });
        } catch (error) {
          sourceLeaseFailure("source_stale",
            "server-held continuation no longer resolves against the package catalog", {
              cause_code: error?.code ?? null
            });
        }
        for (const field of ["contract_digest", "selected_pack", "requested_intents",
          "evaluation_input", "proof_plan_request", "unresolved_required_roles",
          "evaluation_input_diagnostics", "package_version"]) {
          if (!sameJsonValue(resolvedSkeleton[field],
            continuationRecord.skeleton[field])) sourceLeaseFailure("source_stale",
            "server-held proof-authoring skeleton changed", { field });
        }
        const proposalDigest = digestBytes(canonicalJsonBytes(
          pkg.projectProofGraphProposal(proposal)
        ));
        if (proposalDigest !== continuationRecord.proof_graph.proposal_digest) {
          sourceLeaseFailure("source_stale",
            "canonical proof-graph proposal digest changed");
        }
        const snapshot = {
          canonical_set_source: underLock.source,
          manifest_content_digest: underLock.manifest_content_digest,
          canonical_member_digests: Object.fromEntries(basenames.map((basename) => [
            basename,
            underLock.members_by_basename[basename]?.content_digest ?? null
          ])),
          source_digests: {
            "work-record": assertCanonicalWorkRecordReadLease(recordLease, {
              dir: store.repository, id: wkId
            }).source_digest,
            "canonical-generation-manifest": underLock.manifest_content_digest,
            ...Object.fromEntries(basenames.map((basename) => [
              basename,
              underLock.members_by_basename[basename]?.content_digest ?? null
            ]))
          },
          canonical_members: Object.fromEntries(underLock.members.map((member) =>
            [member.filename, structuredClone(member.content)])),
          sources,
          target_by_kind: targetByKind
        };
        const token = Object.freeze(Object.create(null));
        const state = {
          active: true,
          expiresAt: Date.now() + maximumDurationMs,
          focus: focus ?? null,
          recordLease,
          repository: record.repo,
          publicationOwner,
          snapshot,
          store,
          wkId
        };
        activateControlledContractSourceLease(token, state);
        try {
          return await callback(Object.freeze({
            lease: token,
            record,
            record_source_digest: recordDigest,
            continuation_record: continuationRecord,
            canonical_set: underLock,
            canonical_members: deepFreezePlainData(
              structuredClone(snapshot.canonical_members)),
            sources: deepFreezePlainData(structuredClone(sources)),
            source_digests: Object.freeze(structuredClone(snapshot.source_digests)),
            target_by_kind: Object.freeze(structuredClone(targetByKind)),
            manifest_content_digest: underLock.manifest_content_digest
          }));
        } finally {
          state.active = false;
        }
      } finally {
        for (const locked of locks.reverse()) await releaseCarrierLock(locked);
      }
    }
    const contractBasename = controlledContractCarrierFilename({
      wkId, focus, carrierKind: "contract"
    });
    const requestBasename = controlledContractCarrierFilename({
      wkId, focus, carrierKind: "proof_plan_request"
    });
    const primaryBefore = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: store.repository, wkId, focus
    });
    const requestContent = primaryBefore.members_by_basename[requestBasename]?.content;
    if (requestContent === undefined) sourceLeaseFailure("source_invalid",
      "canonical proof-plan request is absent");
    const evaluationBasenames = canonicalEvaluationBasenames({
      wkId, focus, request: requestContent
    });
    const relatedIds = [...new Set((record.related ?? []).filter((value) =>
      typeof value === "string" && /^WK-[0-9]{4}$/u.test(value)))].sort();
    const relatedContractBasenames = relatedIds.map((relatedWkId) => ({
      wkId: relatedWkId,
      basename: controlledContractCarrierFilename({
        wkId: relatedWkId, focus: null, carrierKind: "contract"
      })
    }));
    const relatedBefore = new Map();
    for (const relatedWkId of relatedIds) relatedBefore.set(relatedWkId,
      await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId: relatedWkId, focus: null
      }));
    const targetBasenames = new Set([
      contractBasename,
      requestBasename,
      ...evaluationBasenames
    ]);
    const basenames = [...new Set([
      ...targetBasenames,
      ...primaryBefore.members.map(({ filename }) => filename),
      ...relatedContractBasenames.map(({ basename }) => basename)
    ])].sort();
    const locks = [];
    try {
      for (const basename of basenames) {
        locks.push(await lockCarrier(
          path.join(store.contracts, basename), publicationOwner));
      }
      const underLock = await resolveCanonicalControlledContractCarrierSet({
        repoRoot: store.repository, wkId, focus
      });
      const fingerprint = (value) => [value.source, value.manifest_content_digest,
        value.members.map(({ filename, content_digest: digest }) => [filename, digest])];
      if (!sameJsonValue(fingerprint(underLock), fingerprint(primaryBefore))) {
        sourceLeaseFailure("source_stale",
          "canonical source population changed before ordered lease acquisition");
      }
      const relatedContracts = [];
      for (const entry of relatedContractBasenames) {
        const related = await resolveCanonicalControlledContractCarrierSet({
          repoRoot: store.repository, wkId: entry.wkId, focus: null
        });
        if (!sameJsonValue(fingerprint(related), fingerprint(relatedBefore.get(entry.wkId)))) {
          sourceLeaseFailure("source_stale",
            "related canonical source population changed before ordered lease acquisition");
        }
        const member = related.members_by_basename[entry.basename];
        if (member) relatedContracts.push({
          wk_id: entry.wkId, basename: entry.basename,
          content_digest: member.content_digest,
          content: structuredClone(member.content)
        });
      }
      const contractMember = underLock.members_by_basename[contractBasename];
      const requestMember = underLock.members_by_basename[requestBasename];
      if (!contractMember || !requestMember) sourceLeaseFailure("source_invalid",
        "canonical contract or proof-plan request is absent");
      const evaluationInputs = Object.fromEntries(evaluationBasenames.flatMap((basename) => {
        const member = underLock.members_by_basename[basename];
        return member ? [[basename, structuredClone(member.content)]] : [];
      }));
      const canonicalMemberDigests = Object.fromEntries(basenames.map((basename) => [
        basename, underLock.members_by_basename[basename]?.content_digest ??
          relatedContracts.find((entry) => entry.basename === basename)?.content_digest ?? null
      ]));
      const snapshot = {
        canonical_set_source: underLock.source,
        manifest_content_digest: underLock.manifest_content_digest,
        canonical_member_digests: Object.fromEntries(underLock.members.map((member) =>
          [member.filename, member.content_digest])),
        contract: structuredClone(contractMember.content),
        proof_plan_request: structuredClone(requestMember.content),
        evaluation_inputs: evaluationInputs,
        related_contracts: relatedContracts,
        source_digests: {
          "work-record": assertCanonicalWorkRecordReadLease(recordLease, {
            dir: store.repository, id: wkId
          }).source_digest,
          "canonical-generation-manifest": underLock.manifest_content_digest,
          ...canonicalMemberDigests
        }
      };
      const token = Object.freeze(Object.create(null));
      const state = {
        active: true,
        expiresAt: Date.now() + maximumDurationMs,
        focus: focus ?? null,
        recordLease,
        repository: record.repo,
        publicationOwner,
        snapshot,
        store,
        wkId
      };
      activateControlledContractSourceLease(token, state);
      try {
        return await callback(Object.freeze({
          lease: token,
          record,
          record_source_digest: recordDigest,
          contract: snapshot.contract,
          proof_plan_request: snapshot.proof_plan_request,
          evaluation_inputs: snapshot.evaluation_inputs,
          related_contracts: snapshot.related_contracts,
          source_digests: Object.freeze(structuredClone(snapshot.source_digests))
        }));
      } finally {
        state.active = false;
      }
    } finally {
      for (const locked of locks.reverse()) await releaseCarrierLock(locked);
    }
  });
}
