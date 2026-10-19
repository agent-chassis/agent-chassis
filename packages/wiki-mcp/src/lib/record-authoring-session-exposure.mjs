import { recordAuthoringAvailability } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";

export function sessionAuthoringSchema(schema, registeredTier) {
  if (recordAuthoringAvailability(registeredTier).compile_requirements) return schema;
  const view = structuredClone(schema);
  delete view.properties.requirements;
  const remove = view.properties.remove;
  if (remove?.properties) {
    delete remove.properties.requirements;
    delete remove.properties.requirement_rows;
  }
  return view;
}

export function sessionExceptionKinds(registeredTier, kinds) {
  return recordAuthoringAvailability(registeredTier).grammar_exception ? [...kinds]
    : kinds.filter(kind => kind !== "grammar");
}

export function sessionAuthoringDescription(registeredTier) {
  return recordAuthoringAvailability(registeredTier).compile_requirements
    ? "Author controlled requirements through the supported batch; reading guidance and saving execute no proof and establish no readiness. "
    : "Author user_requirements prose, criteria, validation, exact scopes and slices. Required controlled acceptance remains incomplete when compilation is unavailable; missing capability chooses no exemption and grants no proof credit. ";
}
