import { loadAdmittedProofPack } from "./admitted-proof-packs.mjs";
import { PROOF_INTENT_ARTIFACT } from "./proof-intent-selection.mjs";
import { canonicalValue, compareCodeUnits } from
  "./deterministic-projection-primitives.mjs";

class ProofPlanCompilerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofPlanCompilerError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function packKey(value) {
  return `${value.profile_id}@${value.profile_version}`;
}

function packIdentity(value) {
  return { profile_id: value.profile_id, profile_version: value.profile_version };
}

async function loadSelectedPacks(selectedPacks) {
  const keys = selectedPacks.map(packKey);
  if (new Set(keys).size !== keys.length) throw new ProofPlanCompilerError(
    "proof_plan_request_duplicate_pack",
    "the proof-plan request selects the same exact pack more than once"
  );
  const loaded = [];
  for (const selected of [...selectedPacks].sort((left, right) =>
    compareCodeUnits(packKey(left), packKey(right)))) {
    let pack;
    try {
      pack = await loadAdmittedProofPack(selected.profile_id);
    } catch (error) {
      throw new ProofPlanCompilerError(
        "proof_plan_request_pack_unadmitted",
        "a selected proof pack is not admitted by this package",
        { pack: packIdentity(selected), cause_code: error.code ?? null }
      );
    }
    if (pack.profile.profile_version !== selected.profile_version) {
      throw new ProofPlanCompilerError(
        "proof_plan_request_pack_version_stale",
        "a selected proof-pack version is not the admitted package-owned version",
        {
          pack: packIdentity(selected),
          admitted_version: pack.profile.profile_version
        }
      );
    }
    loaded.push({ selected, pack });
  }
  return loaded;
}

function assignIntents(requestedIntents, loaded) {
  const intentById = new Map(PROOF_INTENT_ARTIFACT.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  const assignments = new Map(loaded.map(({ selected }) => [packKey(selected), []]));
  const diagnostics = [];
  for (const intentId of requestedIntents) {
    const capable = intentById.get(intentId)?.capable_packs ?? [];
    const selected = loaded.filter(({ selected: candidate }) =>
      capable.some((identity) => packKey(identity) === packKey(candidate))
    );
    if (selected.length === 0) diagnostics.push({
      code: "proof_plan_request_intent_unassigned",
      intent_id: intentId,
      selected_candidate_count: 0
    });
    else if (selected.length > 1) diagnostics.push({
      code: "proof_plan_request_intent_ambiguous",
      intent_id: intentId,
      selected_candidate_count: selected.length,
      selected_packs: selected.map(({ selected: value }) => packIdentity(value))
        .sort((left, right) => compareCodeUnits(packKey(left), packKey(right)))
    });
    else assignments.get(packKey(selected[0].selected)).push(intentId);
  }
  for (const { selected } of loaded) if (assignments.get(packKey(selected)).length === 0) {
    diagnostics.push({
      code: "proof_plan_request_pack_unassigned",
      pack: packIdentity(selected)
    });
  }
  if (diagnostics.length > 0) throw new ProofPlanCompilerError(
    "proof_plan_request_selection_incomplete",
    "the exact selected packs do not provide one unambiguous assignment for every requested controlled intent",
    { diagnostics: canonicalValue(diagnostics) }
  );
  return assignments;
}

export { ProofPlanCompilerError, packKey, packIdentity, loadSelectedPacks,
  assignIntents };
