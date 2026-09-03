

import { createHash } from "node:crypto";
import path from "node:path";

import {
  ControlledContractToolError,
  assertControlledContractCarrierExpectedDigest,
  classifyControlledContractCarrierBasename,
  controlledContractCarrierFilename,
  controlledContractPackCarrierFilename,
  inspectCarrierFile,
  normalizeControlledContractIdentity,
  normalizeControlledContractPackIdentity,
  resolveCanonicalControlledContractCarrierSet,
  resolveControlledContractRepository,
  resolveControlledContractTestProofRuntimeBindings,
  withCanonicalControlledContractSourceLease,
  writeControlledContractCarrierSet
} from "./controlled-contract-tools.mjs";
import { withCanonicalWorkRecordReadLease } from "../operations/work-records-store-io.mjs";

const CONTROLLED_CONTRACT_MODULE_SPECIFIER = "@agent-chassis/controlled-contract";
const V = (name) => `wiki-core-common-proof-capture${name}.v1`;
export const COMMON_PROOF_CAPTURE_SCHEMA_VERSION = V("");
export const COMMON_PROOF_CAPTURE_SELECTION_SCHEMA_VERSION = V("-selection");
export const COMMON_PROOF_CAPTURE_OBSERVATION_SCHEMA_VERSION = V("-store-observation");
export const COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION = V("-receipt-identity");

export const COMMON_PROOF_CAPTURE_STORES = Object.freeze(
  { repository: "repository_carrier_store", launcher: "launcher_receipt_store" });

export const COMMON_PROOF_CAPTURE_FAMILIES = Object.freeze(Object.fromEntries([
  ["behavioral_preservation", "launcher"],
  ["declared_boundary_consistency", "repository"],
  ["integration_prefix_safety", "repository"],
  ["test_verification_validity", "launcher"],
  ["write_confinement", "launcher"]
].map(([family, evidenceStore]) => [family, Object.freeze({
  family,
  evidence_store: evidenceStore,
  launcher_derived: evidenceStore === "launcher",
  persists_canonical_carrier: evidenceStore === "repository"
})])));

export const COMMON_PROOF_CAPTURE_FAMILY_IDS =
  Object.freeze(Object.keys(COMMON_PROOF_CAPTURE_FAMILIES));
const familyIdsWhere = (predicate) =>
  Object.freeze(COMMON_PROOF_CAPTURE_FAMILY_IDS.filter(
    (id) => predicate(COMMON_PROOF_CAPTURE_FAMILIES[id])));

export const COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS =
  familyIdsWhere(({ evidence_store: store }) => store === "repository");
export const COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS =
  familyIdsWhere(({ evidence_store: store }) => store === "launcher");

export const COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON = "launcher_receipt_read_only";

export const COMMON_PROOF_CAPTURE_LIFECYCLE_STATES =
  Object.freeze(["read_only_join", "persisted", "resolved"]);

export const COMMON_PROOF_CAPTURE_CURRENTNESS_RESULTS =
  Object.freeze(["absent", "current", "moved", "unverifiable"]);

export const COMMON_PROOF_CAPTURE_REFUSAL_CODES = Object.freeze(Object.fromEntries([
  "BEHAVIORAL_PAIR_INCOMPLETE", "CANONICAL_POPULATION_INCOMPLETE", "CANONICAL_SOURCE_PRE_STABLE",
  "CARRIER_STATE_CONTRADICTORY", "CONTAINMENT_FAILED", "DEPENDENCIES_UNTRUSTED",
  "FAMILY_UNSUPPORTED", "IDENTITY_MISMATCH", "LAUNCHER_PROJECTION_INCOMPLETE",
  "LAUNCHER_CAPABILITY_FAILED", "LAUNCHER_RESOLVER_UNAVAILABLE", "MECHANISM_UNAVAILABLE",
  "PACKAGE_CAPABILITY_MISSING",
  "PACKAGE_MAPPER_REFUSED", "PROFILE_INCOMPATIBLE", "RECEIPT_CORRUPT",
  "RECEIPT_ABSENT", "RECEIPT_CONFLICT", "RECEIPT_IDENTITY_MISMATCH",
  "RECEIPT_LAYOUT_UNSUPPORTED", "RECEIPT_OVER_BOUND", "RECEIPT_SELECTOR_MISMATCH",
  "RECEIPT_STALE", "RECEIPT_UNAUTHENTICATED", "RECEIPT_UNAVAILABLE",
  "BEHAVIORAL_GROUP_INCOMPLETE", "REPORT_BYTES_MISMATCH", "SELECTION_UNTRUSTED",
  "TEST_PROOF_POPULATION_INCOMPLETE", "UNIT_UNRESOLVED"
].map((name) => [name, `common_proof_capture_${name.toLowerCase()}`])));

const CODES = COMMON_PROOF_CAPTURE_REFUSAL_CODES;
const UNIT_ADDRESS_PATTERN = /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, details);
}
const digestUtf8 = (text) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

const TRUSTED_SELECTIONS = new WeakSet();
const TRUSTED_DEPENDENCIES = new WeakSet();

export function createCommonProofCaptureSelection({
  repositoryAlias, repoRoot, wkId, unitAddress, focus = null, family,
  profileId, profileVersion, verificationId = null
}) {
  for (const [field, value] of [["alias", repositoryAlias], ["root", repoRoot]]) {
    if (typeof value !== "string" || value.length === 0) fail(CODES.IDENTITY_MISMATCH,
      `a canonical selection requires one server-resolved repository ${field}`); }
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof unitAddress !== "string" || !UNIT_ADDRESS_PATTERN.test(unitAddress) ||
      (unitAddress !== wkId && !unitAddress.startsWith(`${wkId}#`))) fail(
    CODES.UNIT_UNRESOLVED, "unit must be one same-WK canonical unit address",
    { unit: String(unitAddress) });
  if (verificationId !== null &&
      (typeof verificationId !== "string" || verificationId.length === 0)) fail(
    CODES.IDENTITY_MISMATCH,
    "verification_id must be null or one nonempty canonical claim identity");
  if (!Object.hasOwn(COMMON_PROOF_CAPTURE_FAMILIES, family)) fail(
    CODES.FAMILY_UNSUPPORTED,
    "family must be one of the five supported common proof-capture families",
    { family: String(family), supported: [...COMMON_PROOF_CAPTURE_FAMILY_IDS] });
  const profile = normalizeControlledContractPackIdentity({ profileId, profileVersion });
  const selection = Object.freeze({
    schema_version: COMMON_PROOF_CAPTURE_SELECTION_SCHEMA_VERSION,
    repository_alias: repositoryAlias, repoRoot, wkId, unitAddress, focus: focus ?? null,
    family, verificationId, profileId: profile.profileId, profileVersion: profile.profileVersion
  });
  TRUSTED_SELECTIONS.add(selection);
  return selection;
}

export function createCommonProofCaptureDependencies({
  resolveLauncherReceipt = null,
  loadPackageCapabilities = defaultPackageCapabilityLoader,
  now = () => new Date()
} = {}) {
  if (resolveLauncherReceipt !== null && typeof resolveLauncherReceipt !== "function") fail(
    CODES.DEPENDENCIES_UNTRUSTED,
    "the launcher receipt resolver must be null or one host-provided function");
  if (typeof loadPackageCapabilities !== "function" || typeof now !== "function") fail(
    CODES.DEPENDENCIES_UNTRUSTED, "private capture dependencies must be functions");
  const dependencies =
    Object.freeze({ resolveLauncherReceipt, loadPackageCapabilities, now });
  TRUSTED_DEPENDENCIES.add(dependencies);
  return dependencies;
}

const defaultPackageCapabilityLoader = () =>
  import(CONTROLLED_CONTRACT_MODULE_SPECIFIER);

export function commonProofCaptureObservation({
  store, sourceIdentity, sourceDigest, observedAt, lifecycleState, currentness,
  currentnessDetail = {}
}) {
  const nonempty = (value) => typeof value === "string" && value.length > 0;
  for (const [ok, subject, detail] of [
    [Object.values(COMMON_PROOF_CAPTURE_STORES).includes(store), "name one supported store",
      { store: String(store) }],
    [nonempty(sourceIdentity), "bind one authoritative source identity", {}],
    [sourceDigest === null || nonempty(sourceDigest), "carry a null or nonempty digest", {}],
    [nonempty(observedAt), "bind its own observation time", {}],
    [COMMON_PROOF_CAPTURE_LIFECYCLE_STATES.includes(lifecycleState),
      "name one supported lifecycle state", { lifecycle_state: String(lifecycleState) }],
    [COMMON_PROOF_CAPTURE_CURRENTNESS_RESULTS.includes(currentness),
      "name one supported currentness result", { currentness: String(currentness) }]
  ]) {
    if (!ok) fail(CODES.IDENTITY_MISMATCH, `a store observation must ${subject}`,
      { store: String(store), ...detail });
  }
  return Object.freeze({
    schema_version: COMMON_PROOF_CAPTURE_OBSERVATION_SCHEMA_VERSION,
    store, source_identity: sourceIdentity, source_digest: sourceDigest,
    observed_at: observedAt, lifecycle_state: lifecycleState, currentness,
    currentness_detail: Object.freeze(structuredClone(currentnessDetail)),
    cross_store_transaction: false, simultaneous_currentness_claimed: false
  });
}

const FAMILY_REQUIRED_CAPABILITIES = Object.freeze({
  integration_prefix_safety: Object.freeze([
    "buildIntegrationPrefixSourceMap", "buildProofAuthoringSkeleton",
    "compareIntegrationPrefixCaptureCompatibility", "loadAdmittedProofPack", "readProofPackCatalog",
    "validateAndResolveNativeContractV1", "validateStableTestProofContract"
  ]),
  declared_boundary_consistency: Object.freeze([
    "DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION", "DECLARED_BOUNDARY_PROFILE_ID",
    "DECLARED_BOUNDARY_PROFILE_VERSION", "mapDeclaredBoundaryCapture"
  ]),
  write_confinement: Object.freeze([
    "WRITE_CONFINEMENT_PROFILE_ID", "WRITE_CONFINEMENT_PROFILE_VERSION", "mapWriteConfinementCapture"
  ]),
  behavioral_preservation: Object.freeze([
    "BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION",
    "BEHAVIORAL_PRESERVATION_PROFILE_ID", "BEHAVIORAL_PRESERVATION_PROFILE_VERSION",
    "BEHAVIORAL_PRESERVATION_SIDES", "mapBehavioralPreservationCapture"
  ]),
  test_verification_validity: Object.freeze(["readProofPackCatalog"])
});

const TEST_VALIDITY_PROFILE_ID = "proof.verification.test-validity";

async function bindPackageCapabilities(family, dependencies) {
  let capabilities;
  try {
    capabilities = await dependencies.loadPackageCapabilities();
  } catch (error) {
    fail(CODES.MECHANISM_UNAVAILABLE,
      "the controlled-contract package surface could not be loaded",
      { cause_code: error?.code ?? null }); }
  if (!capabilities || typeof capabilities !== "object") fail(
    CODES.MECHANISM_UNAVAILABLE,
    "the controlled-contract package surface is not one module namespace");
  const missing = FAMILY_REQUIRED_CAPABILITIES[family]
    .filter((name) => capabilities[name] === undefined).sort();
  if (missing.length > 0) fail(CODES.PACKAGE_CAPABILITY_MISSING,
    "the installed controlled-contract package does not export a required owner",
    { family, missing_capabilities: missing });
  return capabilities;
}

function assertTrustedInputs(selection, dependencies) {
  if (!TRUSTED_SELECTIONS.has(selection)) fail(CODES.SELECTION_UNTRUSTED,
    "the shared resolver accepts only one server-minted canonical selection");
  if (!TRUSTED_DEPENDENCIES.has(dependencies)) fail(CODES.DEPENDENCIES_UNTRUSTED,
    "the shared resolver accepts only one server-minted private dependency set");
}

function resolveCanonicalUnit({ record, selection }) {
  if (!isPlainObject(record) || record.id !== selection.wkId) fail(
    CODES.IDENTITY_MISMATCH,
    "the canonical work record does not carry the selected WK identity",
    { wk_id: selection.wkId, record_id: record?.id ?? null });
  if (typeof record.repo !== "string" || record.repo.length === 0) fail(
    CODES.IDENTITY_MISMATCH,
    "the canonical work record binds no durable repository identity",
    { wk_id: selection.wkId });
  if ((record.focus ?? null) !== null && (record.focus ?? null) !== selection.focus) fail(
    CODES.IDENTITY_MISMATCH,
    "the canonical work record focus differs from the selected focus",
    { selected_focus: selection.focus, record_focus: record.focus ?? null });
  if (selection.unitAddress === selection.wkId) return Object.freeze({
    kind: "work_record", address: selection.unitAddress,
    record_id: selection.wkId, slice_id: null });
  const sliceId = selection.unitAddress.slice(selection.wkId.length + 1);
  const slices = Array.isArray(record.slices) ? record.slices : [];
  if (!slices.some((slice) => isPlainObject(slice) && slice.id === sliceId)) fail(
    CODES.UNIT_UNRESOLVED,
    "the selected unit does not exist on the canonical work record",
    { unit: selection.unitAddress });
  return Object.freeze({
    kind: "slice", address: selection.unitAddress,
    record_id: selection.wkId, slice_id: sliceId
  });
}

function resolveUnitUnderRecordLease(selection) {
  return withCanonicalWorkRecordReadLease(
    { dir: selection.repoRoot, id: selection.wkId },
    async ({ record }) => ({ unit: resolveCanonicalUnit({ record, selection }),
      record: structuredClone(record) }));
}

function repositoryStoreIdentity(canonicalSet) {
  if (!isPlainObject(canonicalSet) || typeof canonicalSet.source !== "string") fail(
    CODES.CARRIER_STATE_CONTRADICTORY,
    "the canonical carrier set did not resolve one source");
  return canonicalSet.source === "legacy_root"
    ? `legacy_root:${canonicalSet.wk_id}:${canonicalSet.focus ?? ""}`
    : `generation:${canonicalSet.generation}`;
}

function assertLeasedPopulationUnmoved({ selection, before, sourceDigests }) {
  const sameWkMember = ([basename, digest]) => {
    if (digest === null) return false;
    const classified = classifyControlledContractCarrierBasename(
      { wkId: selection.wkId, basename });
    return classified.member === true && classified.focus === selection.focus;
  };
  const leased = Object.fromEntries(Object.entries(sourceDigests).filter(sameWkMember));
  const initial = Object.fromEntries(before.members.map(
    ({ filename, content_digest: digest }) => [filename, digest]));
  const moved = [...new Set([...Object.keys(initial), ...Object.keys(leased)])]
    .filter((basename) => initial[basename] !== leased[basename]).sort();
  if (moved.length > 0) fail(CODES.CARRIER_STATE_CONTRADICTORY,
    "the canonical carrier population moved between the initial observation and the lease",
    { wk_id: selection.wkId, moved_basenames: moved,
      initial_member_count: before.members.length,
      leased_member_count: Object.keys(leased).length });
}

async function readLauncherProjection({
  selection, dependencies, unit, artifact, side = null
}) {
  if (dependencies.resolveLauncherReceipt === null) fail(
    CODES.LAUNCHER_RESOLVER_UNAVAILABLE,
    "the launcher receipt resolver is not bound in this runtime",
    { family: selection.family, required_prerequisite: "launcher_receipt_resolver" });
  const receiptIdentity = Object.freeze({
    schema_version: COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION,
    repository_alias: selection.repository_alias, wk_id: selection.wkId,
    unit_address: unit.address, focus: selection.focus, family: selection.family,
    artifact, side, profile_id: selection.profileId,
    profile_version: selection.profileVersion, verification_id: selection.verificationId
  });
  let projection;
  try {
    projection = await dependencies.resolveLauncherReceipt(receiptIdentity);
  } catch (error) {
    const translated = Object.freeze({
      common_proof_receipt_absent: CODES.RECEIPT_ABSENT,
      common_proof_receipt_unavailable: CODES.RECEIPT_UNAVAILABLE,
      common_proof_receipt_conflict: CODES.RECEIPT_CONFLICT,
      common_proof_receipt_stale: CODES.RECEIPT_STALE,
      common_proof_receipt_corrupt: CODES.RECEIPT_CORRUPT,
      common_proof_receipt_layout_unsupported: CODES.RECEIPT_LAYOUT_UNSUPPORTED,
      common_proof_receipt_selector_invalid: CODES.RECEIPT_SELECTOR_MISMATCH,
      common_proof_receipt_selector_mismatch: CODES.RECEIPT_SELECTOR_MISMATCH,
      common_proof_receipt_family_unsupported: CODES.RECEIPT_SELECTOR_MISMATCH,
      common_proof_receipt_input_overflow: CODES.RECEIPT_OVER_BOUND,
      common_proof_receipt_population_overflow: CODES.RECEIPT_OVER_BOUND,
      common_proof_receipt_record_overflow: CODES.RECEIPT_OVER_BOUND,
      common_proof_receipt_return_overflow: CODES.RECEIPT_OVER_BOUND,
      common_proof_receipt_incomplete_behavioral_group: CODES.BEHAVIORAL_GROUP_INCOMPLETE,
      common_proof_receipt_capability_failed: CODES.LAUNCHER_CAPABILITY_FAILED,
      common_proof_resolver_capability_failed: CODES.LAUNCHER_CAPABILITY_FAILED,
      common_proof_resolver_capability_binding_failed: CODES.LAUNCHER_CAPABILITY_FAILED,
      common_proof_resolver_capability_over_bound: CODES.LAUNCHER_CAPABILITY_FAILED
    })[error?.code];
    if (translated === undefined) throw error;
    fail(translated,
      "the launcher receipt resolver refused the server-resolved receipt identity",
      { family: selection.family });
  }
  if (projection === null || projection === undefined) fail(CODES.RECEIPT_ABSENT,
    "no launcher receipt exists for the server-resolved receipt identity",
    { family: selection.family, unit: unit.address });
  if (!isPlainObject(projection)) fail(CODES.RECEIPT_CORRUPT,
    "the launcher receipt resolver returned a non-object projection",
    { family: selection.family });
  return { projection };
}

function repositoryObservation({
  dependencies, observedBefore, sourceIdentity, sourceDigest, lifecycleState, detail = {}
}) {
  return commonProofCaptureObservation({
    store: COMMON_PROOF_CAPTURE_STORES.repository, sourceIdentity, sourceDigest,
    observedAt: dependencies.now().toISOString(), lifecycleState, currentness: "current",
    currentnessDetail: { ...detail, observed_before: observedBefore }
  });
}

function publishedRepositoryObservation({
  dependencies, publication, observedBefore, before, detail = {}
}) {
  return repositoryObservation({
    dependencies, observedBefore, lifecycleState: "persisted",
    sourceIdentity: `generation:${publication.generation}`,
    sourceDigest: publication.manifest_content_digest,
    detail: { ...detail, prior_source_identity: repositoryStoreIdentity(before),
      written: publication.written === true, no_op: publication.no_op === true }
  });
}

async function readOnlyRepositoryObservation({
  selection, dependencies, observedBefore, sourceIdentity = null, sourceDigest = null,
  detail = {}
}) {
  let [identity, digest] = [sourceIdentity, sourceDigest];
  if (identity === null) {
    const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: selection.repoRoot, wkId: selection.wkId, focus: selection.focus });
    identity = repositoryStoreIdentity(canonicalSet);
    digest = canonicalSet.manifest_content_digest ?? null;
  }
  return repositoryObservation({ dependencies, observedBefore, sourceIdentity: identity,
    sourceDigest: digest, lifecycleState: "resolved",
    detail: { ...detail, store_mutated: false } });
}

function launcherDerivedResult({
  unit, record = null, repositoryObservation, receiptObservation, capture, mapped = null
}) {
  return {
    unit,
    record,
    persisted: false,
    written: false,
    observations: [repositoryObservation, receiptObservation],
    mapping: mapped === null ? null : Object.freeze({
      schema_version: mapped.schema_version ?? null,
      profile_id: mapped.profile_id ?? null,
      profile_version: mapped.profile_version ?? null,
      evaluation_input: structuredClone(mapped.evaluation_input),
      references: structuredClone(mapped.references ?? null),
      durable: false, persisted: false
    }),
    capture: Object.freeze({ ...capture, persisted: false,
      persistence_skipped_reason: COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON })
  };
}

function launcherObservation({ dependencies, sourceIdentity, sourceDigest, detail = {} }) {
  return commonProofCaptureObservation({
    store: COMMON_PROOF_CAPTURE_STORES.launcher, sourceIdentity, sourceDigest,
    observedAt: dependencies.now().toISOString(), lifecycleState: "read_only_join",
    currentness: "current", currentnessDetail: { ...detail, store_mutated: false } });
}

function assertAuthenticatedLauncherEnvelope({ projection, requiredAuthority, digestField }) {
  if (projection.refusal !== null && projection.refusal !== undefined) fail(
    CODES.RECEIPT_UNAVAILABLE,
    "the launcher owner returned a typed refusal instead of a projection",
    { launcher_refusal_code: projection.refusal?.code ?? null });
  const digest = projection[digestField];
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) fail(
    CODES.RECEIPT_UNAUTHENTICATED,
    "the launcher projection carries no exact authenticated digest",
    { digest_field: digestField });
  if (requiredAuthority !== null && projection.authority !== requiredAuthority) fail(
    CODES.RECEIPT_UNAUTHENTICATED,
    "the launcher projection does not carry its owner's authority marker",
    { expected_authority: requiredAuthority, observed_authority: projection.authority ?? null });
}

function assertReceiptSelectorIdentity({ selection, unit, observed }) {
  if (observed.wk_id !== selection.wkId || observed.unit_address !== unit.address) fail(
    CODES.RECEIPT_IDENTITY_MISMATCH,
    "the launcher receipt binds another WK or unit identity", {
      selected_wk_id: selection.wkId,
      selected_unit: unit.address,
      receipt_wk_id: observed.wk_id ?? null,
      receipt_unit: observed.unit_address ?? null
    });
}

const familyProfile = (capabilities, prefix) => Object.freeze({
  profileId: capabilities[`${prefix}_PROFILE_ID`],
  profileVersion: capabilities[`${prefix}_PROFILE_VERSION`]
});

function assertSelectedProfile(selection, { profileId, profileVersion }) {
  if (selection.profileId !== profileId || selection.profileVersion !== profileVersion) fail(
    CODES.PROFILE_INCOMPATIBLE,
    "the selected profile identity is not the one this family's owner is written for", {
      family: selection.family,
      selected_profile_id: selection.profileId,
      selected_profile_version: selection.profileVersion,
      owner_profile_id: profileId,
      owner_profile_version: profileVersion
    });
  return { profileId, profileVersion };
}

async function callPackageMapper(invoke, family) {
  let result;
  try { result = await invoke(); } catch (error) {
    fail(CODES.PACKAGE_MAPPER_REFUSED,
      "the package capture mapper threw for the authenticated capture",
      { family, cause_code: error?.code ?? null }); }
  if (!isPlainObject(result) || result.mapped !== true ||
      !isPlainObject(result.evaluation_input)) fail(CODES.PACKAGE_MAPPER_REFUSED,
    "the package capture mapper refused the authenticated capture",
    { family, refusal_code: result?.refusal?.code ?? null,
      refusal_reason: result?.refusal?.reason ?? null });
  return result;
}

async function publishCanonicalCarrierSet({
  selection, dependencies, profile, evaluationInput
}) {
  const descriptor = COMMON_PROOF_CAPTURE_FAMILIES[selection.family];
  if (descriptor?.evidence_store !== "repository") fail(CODES.FAMILY_UNSUPPORTED,
    "only a repository-derived family may publish into the canonical carrier store",
    { family: selection.family, evidence_store: descriptor?.evidence_store ?? null,
      repository_derived_families: [...COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS] });
  const { repoRoot, wkId, focus } = selection;
  const before = await resolveCanonicalControlledContractCarrierSet({ repoRoot, wkId, focus });
  const targetFilename = controlledContractPackCarrierFilename({
    wkId, focus, profileId: profile.profileId, profileVersion: profile.profileVersion });
  const expectedContentDigest =
    before.members_by_basename[targetFilename]?.content_digest ?? null;
  const observedBefore = dependencies.now().toISOString();
  return withCanonicalControlledContractSourceLease({
    repoRoot, wkId, focus,
    mutation: { carrierKind: "evaluation_input", pack: profile, preferPack: true }
  }, async (source) => {
    if (source.target_filename !== targetFilename) fail(CODES.CARRIER_STATE_CONTRADICTORY,
      "the canonical carrier owner resolved a different target basename",
      { expected: targetFilename, actual: source.target_filename });
    await assertControlledContractCarrierExpectedDigest({
      repoRoot, wkId, focus, carrierKind: "evaluation_input", pack: profile,
      preferPack: true, expectedContentDigest, canonicalSet: source.canonical_set
    });
    const canonicalMembers = structuredClone(source.canonical_members);
    canonicalMembers[targetFilename] = structuredClone(evaluationInput);
    const publication = await writeControlledContractCarrierSet({
      repoRoot, repository: source.record.repo, wkId, focus,
      profile: "canonical_authoring", expected_manifest_digest: source.manifest_content_digest,
      sourceLease: source.lease, canonical_members: canonicalMembers
    });
    return {
      record: structuredClone(source.record), publication, target_filename: targetFilename,
      observation: publishedRepositoryObservation({
        dependencies, publication, observedBefore, before,
        detail: { expected_content_digest: expectedContentDigest,
          target_filename: targetFilename }
      })
    };
  });
}

const STABLE_CONTRACT_SCHEMA_VERSION = "controlled-acceptance-contract.v1";

async function admitCurrentIntegrationPrefixProfile({ selection, capabilities }) {
  const owned = async (label, invoke) => {
    try { return await invoke(); } catch (error) {
      return fail(CODES.MECHANISM_UNAVAILABLE, `the ${label} owner could not be run`,
        { cause_code: error?.code ?? null }); }
  };
  const comparison = await owned("integration-prefix compatibility",
    () => capabilities.compareIntegrationPrefixCaptureCompatibility());
  if (comparison?.outcome !== "lossless_with_migration") fail(CODES.PROFILE_INCOMPATIBLE,
    "the integration-prefix capture profiles are not losslessly bound",
    { outcome: comparison?.outcome ?? null, error_code: comparison?.error?.code ?? null });
  if (comparison.migration?.complete !== true) fail(CODES.PROFILE_INCOMPATIBLE,
    "the integration-prefix migration population is not complete", {
      migration_total: comparison.migration?.total ?? null,
      migration_complete: comparison.migration?.complete ?? null
    });
  const target = comparison.target_profile;
  const source = comparison.source_profile;

  if (selection.profileId !== target?.profile_id ||
      selection.profileVersion !== target?.profile_version) fail(CODES.PROFILE_INCOMPATIBLE,
    "integration-prefix capture runs only against the current target profile", {
      selected_profile_id: selection.profileId,
      selected_profile_version: selection.profileVersion,
      target_profile_id: target?.profile_id ?? null,
      target_profile_version: target?.profile_version ?? null,
      historical_profile_version: source?.profile_version ?? null,
      selected_historical_profile: selection.profileId === source?.profile_id &&
        selection.profileVersion === source?.profile_version
    });
  const catalog = await owned("admitted proof-pack catalog",
    () => capabilities.readProofPackCatalog());
  const entry = (catalog?.packs ?? []).find(
    ({ profile_id: profileId }) => profileId === target.profile_id);
  if (entry?.profile_version !== target.profile_version) fail(CODES.PROFILE_INCOMPATIBLE,
    "the current catalog does not admit the target integration-prefix profile",
    { target_profile_version: target.profile_version,
      catalog_profile_version: entry?.profile_version ?? null });
  const admitted = await owned("admitted proof-pack",
    () => capabilities.loadAdmittedProofPack(target.profile_id));
  if (admitted?.profile?.profile_id !== target.profile_id ||
      admitted?.profile?.profile_version !== target.profile_version) fail(
    CODES.PROFILE_INCOMPATIBLE,
    "the admitted proof-pack snapshot does not carry the target profile identity",
    { target_profile_version: target.profile_version,
      admitted_profile_version: admitted?.profile?.profile_version ?? null });
  return Object.freeze({
    targetProfile: Object.freeze({
      profileId: target.profile_id, profileVersion: target.profile_version }),
    historicalProfileVersion: source?.profile_version ?? null,
    comparisonDigest: comparison.canonical_result_digest ?? null
  });
}

function assertCurrentStableAuthoringSource({ wkId, contract, relatedContracts, capabilities }) {
  if (contract?.schema_version !== STABLE_CONTRACT_SCHEMA_VERSION) fail(
    CODES.CANONICAL_SOURCE_PRE_STABLE,
    "integration-prefix capture requires an already-stable canonical contract",
    { wk_id: wkId, contract_schema_version: contract?.schema_version ?? null,
      required_schema_version: STABLE_CONTRACT_SCHEMA_VERSION });
  const validation = capabilities.validateStableTestProofContract(contract);
  if (validation?.valid !== true) fail(CODES.CANONICAL_SOURCE_PRE_STABLE,
    "the canonical contract is not a valid stable-v1 carrier",
    { wk_id: wkId, diagnostics: structuredClone(validation?.diagnostics ?? []) });
  const required = (contract.claims ?? []).filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution").map(({ claim_id: id }) => id);
  const bound = new Set((contract.test_proofs ?? []).map(
    ({ verification_claim_id: id }) => id));
  const missing = required.filter((id) => !bound.has(id)).sort();
  if (missing.length > 0) fail(CODES.TEST_PROOF_POPULATION_INCOMPLETE,
    "the canonical contract does not bind a test proof for every test-execution claim",
    { wk_id: wkId, required_count: required.length, missing_verification_ids: missing });

  const compatible = relatedContracts.filter(({ content }) =>
    content?.schema_version === STABLE_CONTRACT_SCHEMA_VERSION &&
    capabilities.validateAndResolveNativeContractV1(content).schema_valid === true);
  if (compatible.length === 0) fail(CODES.CANONICAL_POPULATION_INCOMPLETE,
    "no canonical related contract is compatible with the current stable authoring route",
    { wk_id: wkId, related_contract_count: relatedContracts.length,
      related_schema_versions: [...new Set(relatedContracts.map(
        ({ content }) => content?.schema_version ?? null))].sort() });
  return compatible.map(({ content }) => content);
}

async function resolveIntegrationPrefixCapture({ selection, dependencies, capabilities }) {
  const admitted = await admitCurrentIntegrationPrefixProfile({ selection, capabilities });
  const { repoRoot, wkId, focus } = selection;
  const before = await resolveCanonicalControlledContractCarrierSet({ repoRoot, wkId, focus });
  const contractFilename = controlledContractCarrierFilename({
    wkId, focus, carrierKind: "contract"
  });
  const expectedContractDigest =
    before.members_by_basename[contractFilename]?.content_digest ?? null;
  const observedBefore = dependencies.now().toISOString();

  return withCanonicalControlledContractSourceLease({ repoRoot, wkId, focus },
    async (source) => {
      const unit = resolveCanonicalUnit({ record: source.record, selection });

      await assertControlledContractCarrierExpectedDigest({
        repoRoot, wkId, focus, carrierKind: "contract",
        expectedContentDigest: expectedContractDigest });

      assertLeasedPopulationUnmoved(
        { selection, before, sourceDigests: source.source_digests });
      const mappingContracts = assertCurrentStableAuthoringSource({ wkId,
        contract: source.contract, relatedContracts: source.related_contracts, capabilities });

      let authored;
      try {
        authored = await capabilities.buildProofAuthoringSkeleton({
          canonicalRecord: source.record, contract: source.contract, mappingContracts,
          slices: source.record.slices ?? [], proofPlanRequest: source.proof_plan_request,
          evaluationInputs: source.evaluation_inputs, focus
        });
      } catch (error) {
        fail(CODES.PACKAGE_MAPPER_REFUSED,
          "the integration-prefix authoring owner refused the canonical population",
          { cause_code: error?.code ?? null, ...(error?.details ?? {}) });
      }

      if (authored.identity?.profile_id !== admitted.targetProfile.profileId ||
          authored.identity?.profile_version !== admitted.targetProfile.profileVersion) fail(
        CODES.PROFILE_INCOMPATIBLE,
        "the authoring owner produced a generation for another profile identity",
        { expected_profile_version: admitted.targetProfile.profileVersion,
          authored_profile_version: authored.identity?.profile_version ?? null });
      const named = (k) => controlledContractCarrierFilename({ wkId, focus, carrierKind: k });

      const canonicalMembers = {
        ...structuredClone(Object.fromEntries(before.members.map(
          ({ filename, content }) => [filename, content]))),
        ...structuredClone(authored.evaluation_inputs),
        [contractFilename]: structuredClone(authored.contract),
        [named("proof_plan_request")]: structuredClone(authored.proof_plan_request),
        [named("proof_plan")]: structuredClone(authored.proof_plan)
      };
      const expectedManifestDigest = source.source_digests["canonical-generation-manifest"];
      const publication = await writeControlledContractCarrierSet({
        repoRoot, repository: authored.identity.repository, wkId, focus,
        profile: "canonical_authoring",
        expected_manifest_digest: expectedManifestDigest, sourceLease: source.lease,
        canonical_members: canonicalMembers
      });
      const selectedPack = (authored.proof_plan_request?.selected_packs ?? [])
        .find(({ profile_id: id }) => id === admitted.targetProfile.profileId);
      return {
        unit,
        record: structuredClone(source.record),
        persisted: true,
        written: publication.written === true,
        observations: [publishedRepositoryObservation({
          dependencies, publication, observedBefore, before,
          detail: { expected_content_digest: expectedContractDigest,
            expected_manifest_digest: expectedManifestDigest }
        })],
        capture: Object.freeze({
          profile_id: admitted.targetProfile.profileId,
          profile_version: admitted.targetProfile.profileVersion,
          published_profile_id: selectedPack?.profile_id ?? null,
          published_profile_version: selectedPack?.profile_version ?? null,
          historical_profile_version: admitted.historicalProfileVersion,
          compatibility_result_digest: admitted.comparisonDigest,
          contract_schema_version: authored.contract?.schema_version ?? null,
          contract_digest: authored.digests?.contract ?? null,
          evaluation_input_path: selectedPack?.evaluation_input_path ?? null,
          source_map_schema_version: authored.source_map?.schema_version ?? null,
          integration_unit_count: authored.integration_units?.integration_units?.length ?? 0,
          execution_path_count: authored.execution_paths?.execution_paths?.length ?? 0,
          branches: [...(authored.branches ?? [])],

          artifact_member_basenames: (authored.artifact_members ?? [])
            .map(({ filename }) => filename).sort(),
          carrier_count: publication.carrier_count, generation: publication.generation,
          persisted: true })
      };
    });
}

const DECLARED_BOUNDARY_SLOTS = Object.freeze([
  ["policy", "declared-boundary-policy.json"],
  ["observation", "declared-boundary-observations.json"],
  ["subjects", "declared-boundary-subjects.json"]
].map(([slot, suffix]) => Object.freeze({ slot, suffix })));
const DECLARED_BOUNDARY_REPORT_SUFFIX = "declared-boundary-report.json";

const declaredBoundaryBasename = ({ wkId, focus, suffix }) =>
  focus === null ? `${wkId}.${suffix}` : `${wkId}-${focus}.${suffix}`;

async function readDeclaredBoundarySlots({ selection }) {
  const { contracts: directory } = await resolveControlledContractRepository(selection.repoRoot);
  const slots = {};
  const missing = [];
  for (const { slot, suffix } of DECLARED_BOUNDARY_SLOTS) {
    const basename = declaredBoundaryBasename({
      wkId: selection.wkId, focus: selection.focus, suffix });

    const inspected = await inspectCarrierFile(path.join(directory, basename), { required: false });
    if (inspected === null) missing.push(basename);
    else slots[slot] = { basename, bytes: inspected.bytes };
  }
  if (missing.length > 0) fail(CODES.CANONICAL_POPULATION_INCOMPLETE,
    "the canonical same-WK generation does not carry every declared-boundary slot",
    { missing_basenames: missing.sort() });
  return slots;
}

async function resolveDeclaredBoundaryCapture({
  selection, dependencies, capabilities, publish
}) {
  const profile = assertSelectedProfile(selection, familyProfile(capabilities, "DECLARED_BOUNDARY"));

  const { unit } = await resolveUnitUnderRecordLease(selection);
  const slots = await readDeclaredBoundarySlots({ selection });

  const artifactSource = (b) => Object.freeze({ kind: "artifact_file", relative_path: b });
  const capture = {
    schema_version: capabilities.DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
    policy: { bytes: slots.policy.bytes, source: artifactSource(slots.policy.basename) },
    observation: {
      record_id: `${unit.address}/boundary-observation-record`,
      bytes: slots.observation.bytes, source: artifactSource(slots.observation.basename)
    },
    subjects: { bytes: slots.subjects.bytes, source: artifactSource(slots.subjects.basename) },
    report: { source: artifactSource(declaredBoundaryBasename({
      wkId: selection.wkId, focus: selection.focus, suffix: DECLARED_BOUNDARY_REPORT_SUFFIX })) }
  };
  const mapped = await callPackageMapper(
    () => capabilities.mapDeclaredBoundaryCapture({ capture }), "declared_boundary");
  const persisted = await publish({
    selection, dependencies, profile, evaluationInput: mapped.evaluation_input });
  return {
    unit, record: persisted.record, persisted: true,
    written: persisted.publication.written === true,
    observations: [persisted.observation],
    capture: Object.freeze({
      profile_id: profile.profileId, profile_version: profile.profileVersion,
      observation_record_id: mapped.source.observation_record_id,
      source_set_sha256: mapped.source.source_set_sha256,
      report_bytes_sha256: mapped.source.report_bytes_sha256,
      declared_limit_count: mapped.source.declared_limit_count,
      measured_subject_count: mapped.source.measured_subject_count,
      boundary_case_count: mapped.source.boundary_case_count,
      target_filename: persisted.target_filename,
      generation: persisted.publication.generation, persisted: true })
  };
}

async function resolveWriteConfinementCapture({ selection, dependencies, capabilities }) {
  const profile = assertSelectedProfile(selection, familyProfile(capabilities, "WRITE_CONFINEMENT"));
  const { unit, record } = await resolveUnitUnderRecordLease(selection);
  const observedBefore = dependencies.now().toISOString();
  const { projection } = await readLauncherProjection({
    selection, dependencies, unit, artifact: "write_confinement_evidence_projection"
  });
  assertAuthenticatedLauncherEnvelope({ projection,
    requiredAuthority: "authenticated_observation_only", digestField: "evidence_digest" });
  const evidence = projection.evidence;
  if (!isPlainObject(evidence)) fail(CODES.LAUNCHER_PROJECTION_INCOMPLETE,
    "the launcher write-confinement projection carries no evidence body");

  assertReceiptSelectorIdentity({ selection, unit,
    observed: { wk_id: evidence.record_id, unit_address: evidence.unit_address } });

  if (evidence.contained !== true) fail(CODES.CONTAINMENT_FAILED,
    "the authenticated launcher evidence reports a delivery outside the frozen write scope",
    { unit: unit.address,
      outside_write_scope_path_count: evidence.outside_write_scope_path_count ?? null });

  const mapped = await callPackageMapper(
    () => capabilities.mapWriteConfinementCapture({ projection }), "write_confinement");
  const receiptIdentity =
    `write_confinement_evidence:${evidence.run_id}:${evidence.attempt}`;
  return launcherDerivedResult({
    unit, record, mapped,
    repositoryObservation: await readOnlyRepositoryObservation({
      selection, dependencies, observedBefore }),
    receiptObservation: launcherObservation({
      dependencies, sourceIdentity: receiptIdentity,
      sourceDigest: projection.evidence_digest,
      detail: { unit_address: evidence.unit_address, base_commit: evidence.base_commit,
        delivery_commit: evidence.delivery_commit }
    }),
    capture: {
      profile_id: profile.profileId, profile_version: profile.profileVersion,
      run_id: mapped.source.run_id, attempt: mapped.source.attempt,
      unit_address: mapped.source.unit_address, receipt_identity: receiptIdentity,
      evidence_digest: mapped.source.evidence_digest, contained: true }
  });
}

async function resolveBehavioralPreservationCapture({
  selection, dependencies, capabilities
}) {
  const profile = assertSelectedProfile(selection, familyProfile(capabilities, "BEHAVIORAL_PRESERVATION"));
  const { unit, record } = await resolveUnitUnderRecordLease(selection);
  const observedBefore = dependencies.now().toISOString();
  const { projection } = await readLauncherProjection({
    selection, dependencies, unit, artifact: "behavioral_preservation_pair_receipt"
  });
  if (!projection.pair_id || !projection.body_digest ||
      typeof projection.body_bytes !== "string") fail(CODES.RECEIPT_CORRUPT,
    "the launcher pair receipt does not carry its own identity and body");
  if (projection.advisory !== true) fail(CODES.RECEIPT_UNAUTHENTICATED,
    "the launcher pair receipt does not carry its owner's advisory authority marker");
  const pairEvidence = projection.pair_evidence;
  if (!isPlainObject(pairEvidence) || !Array.isArray(pairEvidence.sides) ||
      !isPlainObject(pairEvidence.shared_invariants)) fail(
    CODES.BEHAVIORAL_PAIR_INCOMPLETE,
    "the launcher pair receipt carries no ordered-pair evidence body");

  const observedBodyDigest = digestUtf8(projection.body_bytes);
  if (projection.body_digest !== observedBodyDigest) fail(CODES.REPORT_BYTES_MISMATCH,
    "the launcher pair receipt body does not reproduce its own digest",
    { declared_body_digest: projection.body_digest,
      observed_body_digest: observedBodyDigest });
  assertReceiptSelectorIdentity({ selection, unit,
    observed: { wk_id: pairEvidence.shared_invariants.wk_id,
      unit_address: pairEvidence.shared_invariants.selected_unit } });

  const capture = {
    schema_version: capabilities.BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
    pair: { pair_id: projection.pair_id, pair_digest: projection.body_digest } };
  for (const position of capabilities.BEHAVIORAL_PRESERVATION_SIDES) {
    const binding = pairEvidence.sides.find((entry) => entry?.position === position);
    if (!isPlainObject(binding) || typeof binding.evidence_id !== "string" ||
        typeof binding.evidence_digest !== "string") fail(
      CODES.BEHAVIORAL_PAIR_INCOMPLETE,
      "the launcher ordered pair is missing a side the owner declares",
      { missing_side: position });
    capture[position] = await readBehavioralPreservationSide({
      selection, dependencies, unit, position, binding });
  }

  const mapped = await callPackageMapper(
    () => capabilities.mapBehavioralPreservationCapture({ capture }), "behavioral_preservation");
  return launcherDerivedResult({
    unit, record, mapped,
    repositoryObservation: await readOnlyRepositoryObservation({
      selection, dependencies, observedBefore }),
    receiptObservation: launcherObservation({
      dependencies, sourceIdentity: `behavioral_preservation_pair:${projection.pair_id}`,
      sourceDigest: projection.body_digest,
      detail: { produced_at: projection.produced_at ?? null,
        member_count: mapped.source.member_count }
    }),
    capture: {
      profile_id: profile.profileId, profile_version: profile.profileVersion,
      pair_id: mapped.source.pair_id, pair_digest: mapped.source.pair_digest,
      receipt_identity: `behavioral_preservation_pair:${projection.pair_id}`,
      member_count: mapped.source.member_count,
      selected_observable_id: mapped.source.selected_observable_id }
  });
}

async function readBehavioralPreservationSide({
  selection, dependencies, unit, position, binding
}) {
  const { projection } = await readLauncherProjection({ selection, dependencies, unit,
    side: position, artifact: "behavioral_preservation_observable_report" });
  if (typeof projection.report_bytes !== "string" || !projection.report_digest ||
      typeof projection.relative_path !== "string") fail(
    CODES.LAUNCHER_PROJECTION_INCOMPLETE,
    "the launcher observable-report projection is missing its bytes, digest, or path",
    { side: position });
  if (projection.evidence_id !== binding.evidence_id ||
      projection.evidence_digest !== binding.evidence_digest) fail(
    CODES.RECEIPT_IDENTITY_MISMATCH,
    "the launcher observable report is bound to another side's evidence identity",
    { side: position, pair_evidence_id: binding.evidence_id,
      report_evidence_id: projection.evidence_id ?? null });
  const observed = digestUtf8(projection.report_bytes);
  if (observed !== projection.report_digest) fail(CODES.REPORT_BYTES_MISMATCH,
    "the launcher observable-report bytes do not reproduce their own digest",
    { side: position, declared_digest: projection.report_digest, observed_digest: observed });
  let report;
  try { report = JSON.parse(projection.report_bytes); } catch (error) {
    fail(CODES.RECEIPT_CORRUPT,
      "the launcher observable-report bytes are not one parseable document",
      { side: position, cause: error?.message ?? null }); }
  return { evidence_id: binding.evidence_id, evidence_digest: binding.evidence_digest,
    source: { kind: "artifact_file", relative_path: projection.relative_path }, report };
}

async function resolveTestValidityProfile({ selection, capabilities }) {
  let catalog;
  try {
    catalog = await capabilities.readProofPackCatalog();
  } catch (error) {
    fail(CODES.MECHANISM_UNAVAILABLE,
      "the admitted proof-pack catalog owner could not be read",
      { cause_code: error?.code ?? null });
  }
  const entry = (catalog?.packs ?? []).find(
    ({ profile_id: profileId }) => profileId === TEST_VALIDITY_PROFILE_ID);
  if (entry === undefined) fail(CODES.MECHANISM_UNAVAILABLE,
    "the admitted proof-pack catalog does not admit the test-validity profile",
    { profile_id: TEST_VALIDITY_PROFILE_ID });
  return assertSelectedProfile(selection, {
    profileId: entry.profile_id, profileVersion: entry.profile_version
  });
}

async function resolveTestValidityCapture({ selection, dependencies, capabilities }) {
  const profile = await resolveTestValidityProfile({ selection, capabilities });
  if (selection.verificationId === null) fail(CODES.IDENTITY_MISMATCH,
    "test-verification validity requires one canonical verification identity");
  const { unit, record } = await resolveUnitUnderRecordLease(selection);
  const observedBefore = dependencies.now().toISOString();

  let bindings;
  try {
    bindings = await resolveControlledContractTestProofRuntimeBindings({
      repoRoot: selection.repoRoot, wkId: selection.wkId, focus: selection.focus,
      verificationIds: [selection.verificationId]
    });
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    fail(CODES.CANONICAL_POPULATION_INCOMPLETE,
      "the canonical test-proof binding owner could not resolve the selection",
      { cause_code: error?.code ?? null });
  }

  const { projection } = await readLauncherProjection({
    selection, dependencies, unit, artifact: "test_proof_runtime_evidence_receipt"
  });
  assertAuthenticatedLauncherEnvelope({
    projection, requiredAuthority: null, digestField: "evidence_digest"
  });
  const identity = projection.evidence_identity;
  const binding = projection.contract_binding;
  if (!isPlainObject(identity) || !isPlainObject(binding)) fail(
    CODES.LAUNCHER_PROJECTION_INCOMPLETE,
    "the launcher test-proof receipt carries no evidence identity or contract binding");
  assertReceiptSelectorIdentity({ selection, unit,
    observed: { wk_id: identity.wk_id, unit_address: identity.selected_unit } });
  if (identity.verification_id !== selection.verificationId) fail(
    CODES.RECEIPT_IDENTITY_MISMATCH,
    "the launcher test-proof receipt binds another verification identity",
    { selected_verification_id: selection.verificationId,
      receipt_verification_id: identity.verification_id ?? null });

  const tuple = Object.freeze({
    controlled_contract_generation: bindings.controlled_contract_generation,
    contract_digest: bindings.contract_digest,
    contract_schema_version: bindings.contract_schema_version
  });
  const observedTuple = Object.freeze({
    controlled_contract_generation: identity.controlled_contract_generation ?? null,
    contract_digest: binding.contract_digest ?? null,
    contract_schema_version: binding.contract_schema_version ?? null });
  const divergent = Object.keys(tuple).filter((k) => tuple[k] !== observedTuple[k]).sort();
  if (divergent.length > 0) fail(CODES.RECEIPT_STALE,
    "the launcher test-proof receipt no longer matches the canonical stable-v1 tuple",
    { divergent_fields: divergent, canonical: tuple, observed: observedTuple });

  return launcherDerivedResult({
    unit, record, mapped: null,
    repositoryObservation: await readOnlyRepositoryObservation({
      selection, dependencies, observedBefore,
      sourceIdentity: `generation:${bindings.controlled_contract_generation}`,
      sourceDigest: bindings.content_digest,
      detail: { carrier_filename: bindings.filename,
        generation_carrier_count: bindings.controlled_contract_generation_carrier_count }
    }),
    receiptObservation: launcherObservation({
      dependencies, sourceIdentity: `test_proof_evidence:${identity.evidence_id}`,
      sourceDigest: projection.evidence_digest,
      detail: { run_id: identity.run_id, attempt: identity.attempt,
        execution_status: projection.execution_result?.status ?? null }
    }),
    capture: {
      profile_id: profile.profileId, profile_version: profile.profileVersion,
      verification_id: selection.verificationId,
      matched_binding_count: bindings.matched_count,
      receipt_identity: `test_proof_evidence:${identity.evidence_id}`,
      evidence_digest: projection.evidence_digest, stable_v1_tuple: tuple,
      inventory_change_count: projection.inventory_change_count ?? null,
      execution_status: projection.execution_result?.status ?? null }
  });
}

const REPOSITORY_FAMILY_RESOLVERS = Object.freeze({
  declared_boundary_consistency: resolveDeclaredBoundaryCapture,
  integration_prefix_safety: resolveIntegrationPrefixCapture
});
const LAUNCHER_FAMILY_RESOLVERS = Object.freeze({
  behavioral_preservation: resolveBehavioralPreservationCapture,
  test_verification_validity: resolveTestValidityCapture,
  write_confinement: resolveWriteConfinementCapture
});

for (const [registry, expected] of [
  [REPOSITORY_FAMILY_RESOLVERS, COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS],
  [LAUNCHER_FAMILY_RESOLVERS, COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS]
]) {
  const wired = Object.keys(registry).sort().join(",");
  if (wired !== [...expected].sort().join(",")) throw new Error(
    `common proof-capture dispatch does not match its family model: ${wired}`);
}

export async function resolveAndPersistCommonProofCapture({ selection, dependencies }) {
  assertTrustedInputs(selection, dependencies);
  const capabilities = await bindPackageCapabilities(selection.family, dependencies);

  const store = await resolveControlledContractRepository(selection.repoRoot);
  const descriptor = COMMON_PROOF_CAPTURE_FAMILIES[selection.family];
  const resolved = descriptor.launcher_derived
    ? await LAUNCHER_FAMILY_RESOLVERS[selection.family]({
      selection, dependencies, capabilities })
    : await REPOSITORY_FAMILY_RESOLVERS[selection.family]({
      selection, dependencies, capabilities, publish: publishCanonicalCarrierSet });
  if (descriptor.launcher_derived && resolved.persisted !== false) fail(
    CODES.FAMILY_UNSUPPORTED, "a launcher-derived capture reported repository persistence",
    { family: selection.family });
  return Object.freeze({
    schema_version: COMMON_PROOF_CAPTURE_SCHEMA_VERSION,
    repository_alias: selection.repository_alias, repository: resolved.record?.repo ?? null,
    wk_id: selection.wkId, unit: resolved.unit.address, unit_kind: resolved.unit.kind,
    focus: selection.focus, family: selection.family,
    evidence_store: descriptor.evidence_store, launcher_derived: descriptor.launcher_derived,
    capture: resolved.capture,

    mapping: resolved.mapping ?? null,

    persisted: resolved.persisted === true, repository_store_mutated: resolved.written === true,
    store_observations: Object.freeze(resolved.observations),

    cross_store_transaction: false, simultaneous_currentness_claimed: false,
    launcher_store_mutated: false, canonical_store_root: store.contracts,
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true, authority_effect: "none"
  });
}
