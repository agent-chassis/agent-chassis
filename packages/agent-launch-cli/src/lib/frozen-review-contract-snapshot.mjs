import { createHash } from "node:crypto";
import { FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS } from "./backend-constants.mjs";
import { isTrustedFrozenReviewContract } from "./backend-review-identity.mjs";

export const FROZEN_REVIEW_CONTRACT_SNAPSHOT_SCHEMA_VERSION =
  "frozen-review-contract-snapshot.v1";

function assertTrustedContract(contract) {
  if (!isTrustedFrozenReviewContract(contract)) {
    throw new TypeError("frozen review contract snapshot requires the backend-minted trusted contract");
  }
}

function canonicalContractJson(contract) {
  return JSON.stringify(Object.fromEntries(
    FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS.map((field) => [field, contract[field]])
  ));
}

export function serializeTrustedFrozenReviewContract(contract) {
  assertTrustedContract(contract);
  return new TextEncoder().encode(canonicalContractJson(contract));
}

export function digestFrozenReviewContractSnapshot(snapshotBytes) {
  if (!(snapshotBytes instanceof Uint8Array)) {
    throw new TypeError("frozen review contract snapshot bytes must be Uint8Array");
  }
  return `sha256:${createHash("sha256").update(snapshotBytes).digest("hex")}`;
}

export function createFrozenReviewContractSnapshot(contract) {
  const bytes = serializeTrustedFrozenReviewContract(contract);
  const digest = digestFrozenReviewContractSnapshot(bytes);
  return Object.freeze({
    schema_version: FROZEN_REVIEW_CONTRACT_SNAPSHOT_SCHEMA_VERSION,
    get bytes() {
      return bytes.slice();
    },
    byte_length: bytes.byteLength,
    digest,
    trusted_frozen_review_contract: contract
  });
}

export const createTrustedFrozenReviewContractSnapshot = createFrozenReviewContractSnapshot;
