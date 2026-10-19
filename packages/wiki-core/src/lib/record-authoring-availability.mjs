import { TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE } from "./tool-discovery/gating.mjs";

export const RECORD_AUTHORING_OPERATION_UNAVAILABLE = "record_authoring_operation_unavailable";
export const RECORD_AUTHORING_REQUIREMENT_MEMBERS = Object.freeze([
  "requirements", "remove.requirements", "remove.requirement_rows"
]);

export function recordAuthoringAvailability(registeredTier) {
  const authorized = registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE;
  return Object.freeze({ compile_requirements: authorized, retire_requirements: authorized,
    grammar_exception: authorized });
}

export function recordAuthoringOperationDiagnostic(member, operation, path = `changes.${member}`) {
  return Object.freeze({ code: RECORD_AUTHORING_OPERATION_UNAVAILABLE, severity: "error", path,
    message: `${path}: ${operation} is unavailable in this serving session; nothing was changed`,
    details: { changed: false, member, operation, subject: path },
    correction: "This operation has no supported authored correction in this session. " +
      "Reading supported authoring information repairs no capability. Required meaning and applicability remain unchanged." });
}

export function requirementAuthoringAvailabilityDiagnostics(changes, registeredTier) {
  const availability = recordAuthoringAvailability(registeredTier);
  return RECORD_AUTHORING_REQUIREMENT_MEMBERS.filter(member =>
    member.split(".").reduce((value, key) => value?.[key], changes) !== undefined &&
    !availability[member === "requirements" ? "compile_requirements" : "retire_requirements"])
    .map(member => recordAuthoringOperationDiagnostic(member,
      member === "requirements" ? "compile_requirements" : "retire_requirements"));
}
