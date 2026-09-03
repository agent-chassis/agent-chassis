import {
  CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS,
  CANONICAL_AUTHORING_PROFILE_ID,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  controlledContractCarrierFilename,
  digestBytes,
  canonicalJsonBytes
} from "./controlled-contract-tool-shared.mjs";
import {
  assertExpectedDigest
} from "./controlled-contract-source-lease-primitives.mjs";
import {
  resolveManifestControlledContractCarrierFilename
} from "./controlled-contract-carrier-set-evaluation.mjs";

export async function writeControlledContractCarrierFileInternalImpl({
  repoRoot,
  wkId,
  focus = null,
  carrierKind,
  content,
  expectedContentDigest,
  pack = null,
  preferPack = false,
  allowPackageProducedWrite = false,
  canonicalSet = null
}, dependencies) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS.includes(carrierKind) &&
      !(allowPackageProducedWrite === true && carrierKind === "proof_plan")) {
    fail(
      "controlled_contract_carrier_write_forbidden",
      "this carrier is package-produced and cannot be written through the canonical authoring route"
    );
  }
  if (!isPlainObject(content)) {
    fail("controlled_contract_carrier_content_invalid", "carrier content must be one JSON object");
  }
  const bytes = canonicalJsonBytes(content);
  assertExpectedDigest(expectedContentDigest);
  canonicalSet ??= await dependencies.resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  {
    const filename = resolveManifestControlledContractCarrierFilename({
      canonicalSet,
      wkId,
      focus,
      carrierKind,
      pack,
      preferPack
    });
    const actualDigest = canonicalSet.members_by_basename[filename]?.content_digest ?? null;
    if (actualDigest !== expectedContentDigest) fail(
      "controlled_contract_stale_content_digest", "canonical carrier content changed", {
        expected_content_digest: expectedContentDigest,
        actual_content_digest: actualDigest
      });
    const nextDigest = digestBytes(bytes);
    return dependencies.withCanonicalControlledContractSourceLease({
      repoRoot,
      wkId,
      focus,
      canonicalSet,
      mutation: { carrierKind, pack, preferPack }
    }, async (source) => {
      const leasedDigest = source.canonical_set.members_by_basename[
        source.target_filename]?.content_digest ?? null;
      if (leasedDigest !== expectedContentDigest) fail(
        "controlled_contract_stale_content_digest", "canonical carrier content changed", {
          expected_content_digest: expectedContentDigest,
          actual_content_digest: leasedDigest
        });
      const canonicalMembers = structuredClone(source.canonical_members);
      canonicalMembers[source.target_filename] = structuredClone(content);
      if (carrierKind !== "proof_plan" && actualDigest !== nextDigest) {
        delete canonicalMembers[controlledContractCarrierFilename({
          wkId, focus, carrierKind: "proof_plan"
        })];
      }
      const publication = await dependencies.writeControlledContractCarrierSet({
        repoRoot,
        repository: source.record.repo,
        wkId,
        focus,
        profile: CANONICAL_AUTHORING_PROFILE_ID,
        expected_manifest_digest: source.manifest_content_digest,
        sourceLease: source.lease,
        canonical_members: canonicalMembers
      });
      await dependencies.validateControlledContractCarrierSetManifest({
        repoRoot,
        wkId,
        focus,
        repository: source.record.repo,
        profile: CANONICAL_AUTHORING_PROFILE_ID
      });
      return Object.freeze({
        schema_version: "controlled-contract-canonical-carrier-write.v1",
        wk_id: wkId,
        focus: focus ?? null,
        carrier_kind: carrierKind,
        filename: source.target_filename,
        previous_content_digest: actualDigest,
        content_digest: nextDigest,
        written: publication.written,
        no_op: publication.no_op === true
      });
    });
  }
}

export async function writeControlledContractCarrierFileImpl(input, dependencies) {
  return writeControlledContractCarrierFileInternalImpl({
    ...input,
    allowPackageProducedWrite: false
  }, dependencies);
}
