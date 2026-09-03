import { createHash } from "node:crypto";

import { canonicalizeWorkRecordJson } from "@agent-chassis/wiki-core";

export const TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION =
  "agent_launch.terminal_review_contract_binding.v1";

export const TERMINAL_REVIEW_CONTRACT_BINDING_CODES = Object.freeze({
  MALFORMED: "agent_launch.terminal_review_contract_binding.malformed.v1",
  MISSING: "agent_launch.terminal_review_contract_binding.missing.v1",
  CONTRADICTORY: "agent_launch.terminal_review_contract_binding.contradictory.v1"
});

const WK_ID_PATTERN = /^WK-[0-9]{4}$/u;
const INITIATIVE_PATTERN = /^IN-[0-9]{4}$/u;
const SLICE_ID_PATTERN = /^SLICE-[0-9]{3}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BINDING_FIELDS = Object.freeze([
  "schema_version", "record_id", "initiative", "review_slice_id", "review_subject",
  "review_unit_contract"
]);
const CONSTRUCTION_FIELDS = Object.freeze([
  "recordId", "initiative", "reviewSliceId", "reviewSubject", "reviewUnitContract"
]);

const constructedBindings = new WeakSet();

export class TerminalReviewContractBindingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TerminalReviewContractBindingError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new TerminalReviewContractBindingError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected, subject) {
  if (!isPlainObject(value)) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      `${subject} must be one plain object`);
  }
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Reflect.ownKeys(value).filter((key) =>
    typeof key !== "string" || !expectedSet.has(key));
  if (missing.length > 0) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MISSING,
      `${subject} is missing required fields`, { fields: missing });
  }
  if (unexpected.length > 0) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      `${subject} contains unsupported fields`, {
        fields: unexpected.map(String).sort()
      });
  }
}

function normalizeBinding(value) {
  exactKeys(value, BINDING_FIELDS, "terminal-review contract binding");
  if (value.schema_version !== TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION ||
      !WK_ID_PATTERN.test(value.record_id ?? "") ||
      !INITIATIVE_PATTERN.test(value.initiative ?? "") ||
      !SLICE_ID_PATTERN.test(value.review_slice_id ?? "") ||
      value.review_subject !== `${value.record_id}#${value.review_slice_id}` ||
      typeof value.review_unit_contract !== "string" ||
      value.review_unit_contract.length === 0) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.CONTRADICTORY,
      "terminal-review contract binding fields do not form one exact review identity");
  }
  let reviewUnitContract;
  try {
    reviewUnitContract = JSON.parse(value.review_unit_contract);
  } catch {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      "terminal-review unit contract is not canonical JSON");
  }
  if (!isPlainObject(reviewUnitContract) ||
      canonicalizeWorkRecordJson(reviewUnitContract) !== value.review_unit_contract) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.CONTRADICTORY,
      "terminal-review unit contract is not its canonical serialization");
  }
  return deepFreeze({
    schema_version: TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
    record_id: value.record_id,
    initiative: value.initiative,
    review_slice_id: value.review_slice_id,
    review_subject: value.review_subject,
    review_unit_contract: value.review_unit_contract
  });
}

export function constructTerminalReviewContractBinding(input) {
  exactKeys(input, CONSTRUCTION_FIELDS, "terminal-review contract binding construction request");
  const binding = normalizeBinding({
    schema_version: TERMINAL_REVIEW_CONTRACT_BINDING_SCHEMA_VERSION,
    record_id: input.recordId,
    initiative: input.initiative,
    review_slice_id: input.reviewSliceId,
    review_subject: input.reviewSubject,
    review_unit_contract: structuredClone(input.reviewUnitContract)
  });
  constructedBindings.add(binding);
  return binding;
}

export function assertTerminalReviewContractBinding(value, { requireConstructed = false } = {}) {
  const normalized = normalizeBinding(value);
  if (requireConstructed && !constructedBindings.has(value)) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      "terminal-review contract binding was not constructed by its owner");
  }
  return requireConstructed ? value : normalized;
}

export function canonicalTerminalReviewContractBinding(binding) {
  return canonicalizeWorkRecordJson(assertTerminalReviewContractBinding(binding));
}

export function computeTerminalReviewContractBindingDigest(binding) {
  return `sha256:${createHash("sha256")
    .update(canonicalTerminalReviewContractBinding(binding))
    .digest("hex")}`;
}

export function terminalReviewContractBindingIdentity(binding) {
  const normalized = assertTerminalReviewContractBinding(binding);
  return Object.freeze({
    review_subject: normalized.review_subject,
    review_contract_digest: computeTerminalReviewContractBindingDigest(normalized)
  });
}

export function sameTerminalReviewContractBinding(left, right) {
  return canonicalTerminalReviewContractBinding(left) === canonicalTerminalReviewContractBinding(right);
}

export function terminalReviewContractBindingAddresses(binding, reviewSubject) {
  if (typeof reviewSubject !== "string") {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      "terminal-review subject identity is malformed");
  }
  return assertTerminalReviewContractBinding(binding).review_subject === reviewSubject;
}

export function compareTerminalReviewContractBindingIdentity(binding, {
  reviewSubject,
  reviewContractDigest
}) {
  if (typeof reviewSubject !== "string" || !DIGEST_PATTERN.test(reviewContractDigest ?? "")) {
    fail(TERMINAL_REVIEW_CONTRACT_BINDING_CODES.MALFORMED,
      "terminal-review candidate identity is malformed");
  }
  const identity = terminalReviewContractBindingIdentity(binding);
  const reason = identity.review_subject !== reviewSubject
    ? "review_subject_moved"
    : identity.review_contract_digest !== reviewContractDigest
      ? "review_contract_digest_moved"
      : null;
  return Object.freeze({ current: reason === null, reason });
}

export function terminalReviewContractBindingIsCurrent(binding, identity) {
  return compareTerminalReviewContractBindingIdentity(binding, identity).current;
}
