import path from "node:path";

import {
  sanitizeWorkRecordDispatchOptions
} from "../lib/work-record-dispatch.mjs";
import { validateWorkRecordDispatch } from "./validate-dispatch.mjs";
import { createProspectiveWorkRecordStore } from "../lib/work-record-prospective-preflight-store.mjs";

export class ProspectiveWorkRecordDispatchUnitAddressMismatchError extends Error {
  constructor({ proposedRecordId, addressedRecordId }) {
    super(
      `Prospective dispatch unit address names record ${addressedRecordId}, ` +
      `but proposed_record.id is ${proposedRecordId}`
    );
    this.name = "ProspectiveWorkRecordDispatchUnitAddressMismatchError";
    this.code = "prospective_dispatch_unit_address_record_mismatch";
    this.proposed_record_id = proposedRecordId;
    this.addressed_record_id = addressedRecordId;
  }
}

const PROSPECTIVE_PREFLIGHT_OPTION_KEYS = Object.freeze([
  "dir",
  "proposed_record",
  "unit_address",
  "dispatch_role",
  "node_engine_admissibility",
  "now"
]);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function addressedRecordId(unitAddress) {
  if (typeof unitAddress !== "string") return null;
  const recordId = unitAddress.split("#", 1)[0];
  return /^WK-[0-9]{4}$/.test(recordId) ? recordId : null;
}

export async function preflightProspectiveWorkRecordDispatch(options = {}) {
  const source = sanitizeWorkRecordDispatchOptions(
    options,
    PROSPECTIVE_PREFLIGHT_OPTION_KEYS,
    "preflightProspectiveWorkRecordDispatch"
  );
  const dir = path.resolve(String(source.dir === undefined ? "." : source.dir));
  const proposedRecord = source.proposed_record;
  const hasValidRecordIdentity =
    isPlainObject(proposedRecord) &&
    typeof proposedRecord.id === "string" &&
    proposedRecord.id.length > 0;
  const resolvedUnitAddress =
    source.unit_address === undefined
      ? hasValidRecordIdentity
        ? proposedRecord.id
        : undefined
      : source.unit_address;

  if (source.unit_address !== undefined && hasValidRecordIdentity) {
    const addressedId = addressedRecordId(source.unit_address);
    if (addressedId !== null && addressedId !== proposedRecord.id) {
      throw new ProspectiveWorkRecordDispatchUnitAddressMismatchError({
        proposedRecordId: proposedRecord.id,
        addressedRecordId: addressedId
      });
    }
  }

  const recordStore = hasValidRecordIdentity
    ? createProspectiveWorkRecordStore({ dir, proposedRecord })
    : null;
  const readiness = await validateWorkRecordDispatch({
    dir,
    unitAddress: resolvedUnitAddress,
    dispatch_role: source.dispatch_role,
    node_engine_admissibility: source.node_engine_admissibility,
    now: source.now,
    recordStore
  });

  const bodyUnpersisted =
    readiness.record_id === null || readiness.record_id === proposedRecord?.id;

  return {
    ...readiness,
    preflight: {
      unit_address: resolvedUnitAddress || "",
      body_unpersisted: bodyUnpersisted
    }
  };
}
