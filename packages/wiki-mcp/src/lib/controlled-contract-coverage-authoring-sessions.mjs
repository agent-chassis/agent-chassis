import { randomBytes } from "node:crypto";

import { ControlledContractToolError } from "@agent-chassis/wiki-core";
import { createControlledContractRefusal } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs";

const AUTHORING_SESSION_TTL_MS = 30 * 60 * 1000;
const AUTHORING_SESSION_CAPACITY = 32;
const ROW_SLOT_PREFIX = "ccrs_";

function refuse(code, message, details = {}) {
  throw createControlledContractRefusal(
    new ControlledContractToolError(code, message, {
      changed: false,
      ...details
    }),
    { operation: "controlled_contract_coverage_authoring_row_slot" }
  );
}

function bindingIdentity(binding) {
  return JSON.stringify(binding);
}

function publicSlot(session, ordinal) {
  const criterionIdentity = session.rows[ordinal].criterionIdentity;
  const ownerProducedRelationships = session.applicability.criterion_relationships
    .filter((relationship) => relationship.criterion_identity === criterionIdentity);
  return Object.freeze({
    row_slot_identity: session.slotIdentities[ordinal],
    ordinal: ordinal + 1,
    total: session.rows.length,
    criterion: Object.freeze({
      identity: session.rows[ordinal].criterionIdentity,
      text: session.rows[ordinal].criterionText
    }),
    required_authored_fields: Object.freeze([...session.requiredAuthoredFields]),
    applicability: Object.freeze({
      mode: session.applicability.mode,
      owner_produced_relationships: Object.freeze(structuredClone(
        ownerProducedRelationships
      )),
      caller_selects_mapping: session.applicability.caller_selects_mapping
    }),
    context_refs: Object.freeze([
      "shared_context.contract_nodes",
      "shared_context.proof_choices",
      "shared_context.field_contract"
    ])
  });
}

export function createControlledContractCoverageAuthoringSessions({
  now = () => Date.now(),
  randomBytesFn = randomBytes,
  ttlMs = AUTHORING_SESSION_TTL_MS,
  capacity = AUTHORING_SESSION_CAPACITY
} = {}) {
  const sessions = new Map();
  const slots = new Map();

  function drop(session) {
    sessions.delete(session.identity);
    for (const identity of session.slotIdentities) slots.delete(identity);
  }

  function evictExpired(timestamp) {
    for (const session of sessions.values()) {
      if (session.expiresAt <= timestamp) drop(session);
    }
  }

  function enforceCapacity(timestamp) {
    evictExpired(timestamp);
    while (sessions.size >= capacity) {
      const oldest = [...sessions.values()].sort((left, right) =>
        left.lastUsedAt - right.lastUsedAt || left.createdAt - right.createdAt
      )[0];
      drop(oldest);
    }
  }

  function opaqueIdentity() {
    let identity;
    do identity = `${ROW_SLOT_PREFIX}${randomBytesFn(32).toString("hex")}`;
    while (slots.has(identity));
    return identity;
  }

  function issue({ family, binding, criteria, requiredAuthoredFields, applicability }) {
    const timestamp = now();
    enforceCapacity(timestamp);
    if (!Array.isArray(criteria) || criteria.length === 0 ||
        criteria.some((criterion) => !criterion ||
          typeof criterion.identity !== "string" || criterion.identity.length === 0 ||
          typeof criterion.text !== "string" || criterion.text.length === 0)) {
      throw new Error("coverage authoring session requires current criterion identities and text");
    }
    if (applicability?.mode !== "shared_admitted_alternatives" ||
        !Array.isArray(applicability.criterion_relationships) ||
        applicability.criterion_relationships.some((relationship) =>
          !criteria.some(({ identity }) => identity === relationship?.criterion_identity)) ||
        applicability.inferred_relationship_count !== 0 ||
        applicability.caller_selects_mapping !== true) {
      throw new Error("coverage authoring session requires owner-produced applicability");
    }
    const identity = `ccas_${randomBytesFn(32).toString("hex")}`;
    const slotIdentities = criteria.map(() => opaqueIdentity());
    const session = {
      identity,
      family,
      binding: structuredClone(binding),
      bindingIdentity: bindingIdentity(binding),
      rows: criteria.map((criterion) => ({
        criterionIdentity: criterion.identity,
        criterionText: criterion.text
      })),
      requiredAuthoredFields: [...requiredAuthoredFields],
      applicability: structuredClone(applicability),
      slotIdentities,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      expiresAt: timestamp + ttlMs,
      consumed: false
    };
    sessions.set(identity, session);
    slotIdentities.forEach((slotIdentity, ordinal) => {
      slots.set(slotIdentity, { sessionIdentity: identity, ordinal });
    });
    return publicSlot(session, 0);
  }

  function resolve(rowSlotIdentity, { family, binding }) {
    const timestamp = now();
    const locator = slots.get(rowSlotIdentity);
    if (locator === undefined) refuse(
      "coverage_authoring_row_slot_invalid",
      "row-slot identity is unknown or forged"
    );
    const session = sessions.get(locator.sessionIdentity);
    if (session === undefined) refuse(
      "coverage_authoring_row_slot_unavailable",
      "row-slot authoring session is unavailable"
    );
    if (session.consumed) refuse(
      "coverage_authoring_row_slot_replayed",
      "row-slot authoring session has already been consumed"
    );
    if (session.expiresAt <= timestamp) {
      drop(session);
      refuse("coverage_authoring_row_slot_expired", "row-slot authoring session expired");
    }
    if (session.family !== family) refuse(
      "coverage_authoring_row_slot_family_mismatch",
      "row-slot identity belongs to a different coverage family"
    );
    const expected = session.binding;
    if (expected.unit !== binding.unit) refuse(
      "coverage_authoring_row_slot_unit_mismatch",
      "row-slot identity belongs to a different WK or selected slice"
    );
    if ((expected.focus ?? null) !== (binding.focus ?? null)) refuse(
      "coverage_authoring_row_slot_focus_mismatch",
      "row-slot identity belongs to a different controlled focus"
    );
    if (session.bindingIdentity !== bindingIdentity(binding)) refuse(
      "coverage_authoring_row_slot_stale",
      "row-slot identity is stale against the current semantic source",
      { source_mismatch: true }
    );
    session.lastUsedAt = timestamp;
    return Object.freeze({
      sessionIdentity: session.identity,
      ordinal: locator.ordinal,
      criterionIdentity: session.rows[locator.ordinal].criterionIdentity,
      publicSlot: publicSlot(session, locator.ordinal),
      nextSlot: locator.ordinal + 1 < session.rows.length
        ? publicSlot(session, locator.ordinal + 1) : null
    });
  }

  function resolvePage(rowSlotIdentity, context) {
    const selected = resolve(rowSlotIdentity, context);
    const session = sessions.get(selected.sessionIdentity);
    return Object.freeze({
      ...selected,
      remainingSlots: Object.freeze(session.rows.slice(selected.ordinal)
        .map((unused, offset) => publicSlot(session, selected.ordinal + offset)))
    });
  }

  function assertRequest(rowSlotIdentity, { family, unit, focus = null }) {
    const locator = slots.get(rowSlotIdentity);
    if (locator === undefined) refuse(
      "coverage_authoring_row_slot_invalid",
      "row-slot identity is unknown or forged"
    );
    const session = sessions.get(locator.sessionIdentity);
    if (session === undefined) refuse(
      "coverage_authoring_row_slot_unavailable",
      "row-slot authoring session is unavailable"
    );
    if (session.consumed) refuse(
      "coverage_authoring_row_slot_replayed",
      "row-slot authoring session has already been consumed"
    );
    if (session.expiresAt <= now()) {
      drop(session);
      refuse("coverage_authoring_row_slot_expired", "row-slot authoring session expired");
    }
    if (session.family !== family) refuse(
      "coverage_authoring_row_slot_family_mismatch",
      "row-slot identity belongs to a different coverage family"
    );
    if (session.binding.unit !== unit) refuse(
      "coverage_authoring_row_slot_unit_mismatch",
      "row-slot identity belongs to a different WK or selected slice"
    );
    if ((session.binding.focus ?? null) !== focus) refuse(
      "coverage_authoring_row_slot_focus_mismatch",
      "row-slot identity belongs to a different controlled focus"
    );
  }

  function resolveComplete(rowSlotIdentities, context) {
    if (!Array.isArray(rowSlotIdentities) || rowSlotIdentities.length === 0) refuse(
      "coverage_authoring_row_population_incomplete",
      "create requires one complete server-minted row-slot population"
    );
    const resolved = rowSlotIdentities.map((identity) => resolve(identity, context));
    const sessionIdentities = new Set(resolved.map(({ sessionIdentity }) => sessionIdentity));
    const ordinals = new Set(resolved.map(({ ordinal }) => ordinal));
    const session = sessions.get(resolved[0].sessionIdentity);
    if (sessionIdentities.size !== 1 || ordinals.size !== resolved.length ||
        resolved.length !== session.rows.length ||
        [...ordinals].some((ordinal) => ordinal < 0 || ordinal >= session.rows.length)) {
      refuse(
        "coverage_authoring_row_population_incomplete",
        "create requires every row slot from one authoring session exactly once",
        { total: session.rows.length, returned: ordinals.size,
          omitted: session.rows.length - ordinals.size }
      );
    }
    return Object.freeze(resolved);
  }

  function assertDistinct(resolvedRows) {
    if (new Set(resolvedRows.map(({ sessionIdentity, ordinal }) =>
      `${sessionIdentity}:${ordinal}`)).size !== resolvedRows.length) {
      refuse(
        "coverage_authoring_row_slot_replayed",
        "one mutation request cannot reuse an authoring row slot"
      );
    }
  }

  function consume(resolvedRows) {
    const session = sessions.get(resolvedRows[0]?.sessionIdentity);
    if (session !== undefined) session.consumed = true;
  }

  return Object.freeze({
    issue, assertRequest, resolve, resolvePage, resolveComplete, assertDistinct, consume
  });
}

export {
  AUTHORING_SESSION_CAPACITY,
  AUTHORING_SESSION_TTL_MS,
  ROW_SLOT_PREFIX
};
