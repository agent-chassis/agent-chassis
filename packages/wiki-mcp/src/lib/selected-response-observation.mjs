import { projectFailureDiagnosis } from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

export async function describeRetainedObservation(binding, resolveCurrentObservationIdentity) {
  const retained = binding?.observation_identity ?? null;
  const observation = { kind: "retained_prior_observation", observation_identity: retained };
  if (typeof resolveCurrentObservationIdentity !== "function" || typeof retained !== "string") {
    return { ...observation, state: "unavailable", unavailable_reason: "observation_identity_unrecorded" };
  }
  try {
    const current = await resolveCurrentObservationIdentity(Object.freeze({ ...binding }));
    return { ...observation, state: current === retained ? "current" : "changed" };
  } catch (error) {

    return { ...observation, state: "unavailable",
      unavailable_reason: typeof error?.code === "string" ? error.code : "current_observation_identity_unreadable",
      diagnosis: projectFailureDiagnosis(error),
      ...(Number.isInteger(error?.code) ? { exit_code: error.code } : {}) };
  }
}
