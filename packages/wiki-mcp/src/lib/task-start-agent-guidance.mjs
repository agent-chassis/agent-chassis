

import { contractAssessmentCall } from "./task-assess-contract-surface.mjs";
import { isDeepStrictEqual } from 'node:util';

export async function servedGuidanceRead(call, requestContracts, { unavailableCode = "readiness_guidance_full_contract_rejected" } = {}) {
  try {
    const contract = requestContracts?.contractFor?.(call.tool);
    if (!contract) return { limitation: { code: unavailableCode, tool: call.tool } };
    return await contract.acceptsArguments(call.arguments) !== true
      ? { limitation: { code: "readiness_guidance_full_contract_rejected", tool: call.tool } } : { call };
  } catch (error) {
    return { limitation: { code: "readiness_guidance_validation_failed", tool: call.tool,
      cause: { code: error.code ?? null, message: error.message } } };
  }
}

export async function servedUnitAssessment(unit, requestContracts) {
  const call = { kind: "guidance", recommended: true, ...contractAssessmentCall({ unit }),
    information: "Assess this unit's saved specification and acceptance gaps, affected identities and supported corrections. Read-only; no execution or readiness change." };
  const limit = (code, cause) => ({ limitation: { code, tool: call.tool, ...(cause === undefined ? {} : { cause }) } });
  try {
    const contract = requestContracts?.contractFor?.(call.tool);
    if (!contract) return limit("contract_assessment_consumer_unavailable");
    return await contract.acceptsArguments(call.arguments) === true ? { call }
      : limit("contract_assessment_full_contract_rejected");
  } catch (error) {
    return limit("contract_assessment_validation_failed", { code: error.code ?? null, message: error.message });
  }
}

export function controlledAcceptanceRecoveryCall(failure) {
  const call = failure?.owner_call;
  if (["workspace_read_wiki", "workspace_assess_contract"].includes(call?.tool)) return call;
  return null;
}

export async function servedControlledAcceptanceRecovery(failure, requestContracts) {
  const call = controlledAcceptanceRecoveryCall(failure);
  if (call === null) return { limitation: { code: "controlled_acceptance_navigation_unavailable",
    owner: failure?.responsible_owner ?? null, correction_unit: failure?.correction_unit ?? null } };
  if (call.tool === "workspace_assess_contract" && Object.keys(call.arguments).length === 1) {
    return servedUnitAssessment(call.arguments.unit, requestContracts);
  }
  return servedGuidanceRead({ kind: "guidance", recommended: true, ...call,
    information: failure.explanation ?? "Read the assessment owner's selected correction subject; reading changes no readiness." },
  requestContracts, { unavailableCode: "controlled_acceptance_navigation_consumer_unavailable" });
}

export function servedControlledAcceptanceFailure(failure, served) {
  return { ...failure, owner_call: served?.call === undefined ? null
    : { tool: served.call.tool, arguments: structuredClone(served.call.arguments) } };
}

export function projectControlledFailureFacts(value, failure) {
  if (Array.isArray(value)) return value.map(row => projectControlledFailureFacts(row, failure));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, member]) => {
    if (key === 'controlled_acceptance_failure') {
      if (member === null || typeof member !== 'object') return [[key, member]];

      if (isDeepStrictEqual({ ...member, owner_call: failure.owner_call }, failure)) return [];
      return [[key, { ...member, owner_call: null }]];
    }
    return [[key, projectControlledFailureFacts(member, failure)]];
  }));
}
