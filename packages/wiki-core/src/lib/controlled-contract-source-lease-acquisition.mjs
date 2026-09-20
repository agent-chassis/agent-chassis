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
  resolveControlledContractRepository,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";
import { sameJsonValue } from "./controlled-contract-authoring-continuations.mjs";
import { resolveManifestControlledContractCarrierFilename } from
  "./controlled-contract-carrier-set-evaluation.mjs";
import {
  acquireCarrierLock,
  activateControlledContractSourceLease,
  canonicalEvaluationBasenames,
  releaseCarrierLock,
  sourceLeaseFailure
} from "./controlled-contract-source-lease-primitives.mjs";
import { withContinuationControlledContractSourceLease } from
  "./controlled-contract-source-lease-continuation.mjs";

export async function withCanonicalControlledContractSourceLeaseImpl({
  repoRoot, wkId, focus = null, maximumDurationMs = 60_000,
  continuation = null, mutation = null, canonicalSet = null, draftObligation = null
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
  if (draftObligation !== null && (!isPlainObject(draftObligation) ||
      Object.keys(draftObligation).some(key =>
        !["selectedUnit", "expectedContentDigest"].includes(key)) ||
      !Object.hasOwn(draftObligation, "selectedUnit") ||
      !Object.hasOwn(draftObligation, "expectedContentDigest") ||
      (draftObligation.expectedContentDigest !== null &&
        !/^sha256:[0-9a-f]{64}$/u.test(draftObligation.expectedContentDigest)) ||
      continuation !== null || mutation !== null || canonicalSet !== null)) {
    sourceLeaseFailure("input_invalid", "draft obligation acquisition requires one closed source identity");
  }
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
    if (draftObligation !== null) {

      const { resolveProofAuthoringSource } = await import(
        "../operations/controlled-contract/proof-authoring-source.mjs");
      const { assertObligationCoverageSourcePathIntegrity } = await import(
        "../operations/controlled-contract/acceptance-coverage-facts.mjs");
      const identity = { repoRoot: store.repository, wkId, focus,
        selectedUnit: draftObligation.selectedUnit };
      const { file } = await assertObligationCoverageSourcePathIntegrity(identity);
      const locked = await lockCarrier(file, publicationOwner);
      let active = true;
      const expiresAt = Date.now() + maximumDurationMs;
      const assertDraftLease = () => {
        if (!active || Date.now() >= expiresAt) sourceLeaseFailure("expired",
          "draft obligation publication requires a live source lease");
        return assertCanonicalWorkRecordReadLease(recordLease, {
          dir: store.repository, id: wkId
        });
      };
      try {
        assertDraftLease();
        const underLock = await resolveProofAuthoringSource(identity);
        if ((underLock.source?.content_digest ?? null) !== draftObligation.expectedContentDigest) {
          sourceLeaseFailure("source_stale", "draft obligation source changed before lease acquisition", {
            changed: false, phase: "lease", limb: "mechanical_failure"
          });
        }

        return await callback(Object.freeze({ record,
          record_source_digest: recordDigest, publication_owner: publicationOwner,
          draft_source_identity: underLock.prospectiveIdentity, assertDraftLease }));
      } finally {
        active = false;
        await releaseCarrierLock(locked);
      }
    }
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
        for (const obligationSource of mutation.obligationSources ?? (mutation.obligationSource === undefined ? [] : [mutation.obligationSource])) {
          const { assertObligationCoverageSourcePathIntegrity } = await import('../operations/controlled-contract/acceptance-coverage-facts.mjs');
          const { file } = await assertObligationCoverageSourcePathIntegrity({ repoRoot: store.repository, wkId, focus,
            selectedUnit: obligationSource.selectedUnit });
          locks.push(await lockCarrier(file, publicationOwner));
        }
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
            record_lease: recordLease,
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
      return await withContinuationControlledContractSourceLease({
        store, wkId, focus, maximumDurationMs, continuation, canonicalSet,
        record, recordLease, recordDigest, publicationOwner, lockCarrier,
        resolveCanonicalControlledContractCarrierSet
      }, callback);
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
