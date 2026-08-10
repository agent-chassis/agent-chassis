import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import {
  canonicalDigest,
  normalizeContractForIdentity
} from "../lib/contract-assessment.mjs";
import { expectedPackSourceDigests } from "../lib/multi-pack-assessment.mjs";
import { PROOF_INTENT_DIGESTS } from "../lib/proof-intent-selection.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const sortedUnique = (values) => [...new Set(values)].sort();

async function buildProofPlanFixture({ contractPath, packs }) {
  const resolvedContract = path.resolve(contractPath);
  const contract = await readJson(resolvedContract);
  const entries = [];
  for (const request of packs) {
    const admitted = await loadAdmittedProofPack(request.profileId);
    const evaluationPath = path.resolve(request.evaluationInputPath);
    const evaluationInput = await readJson(evaluationPath);
    const intents = sortedUnique(request.requestedIntents);
    const exactBinding = request.captureRoot === undefined ? null : {
      capture_root: path.resolve(request.captureRoot),
      contract_path: path.relative(path.resolve(request.captureRoot), resolvedContract)
        .split(path.sep).join("/"),
      evaluation_input_path: path.relative(
        path.resolve(request.captureRoot), evaluationPath
      ).split(path.sep).join("/"),
      sources: structuredClone(request.exactBindingSources)
    };
    entries.push({
      profile_id: admitted.profile.profile_id,
      profile_version: admitted.profile.profile_version,
      requested_intents: intents,
      evaluation_input: { path: evaluationPath },
      exact_binding: exactBinding,
      source_digests: expectedPackSourceDigests(
        admitted, evaluationInput, request.exactBindingSources ?? null
      )
    });
  }
  return {
    schema_version: "controlled-contract-proof-plan.v1",
    requested_intents: sortedUnique(
      packs.flatMap(({ requestedIntents }) => requestedIntents)
    ),
    digests: {
      contract: canonicalDigest(normalizeContractForIdentity(contract)),
      catalog: PROOF_INTENT_DIGESTS.catalog,
      vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
      profiles: PROOF_INTENT_DIGESTS.profiles,
      intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
    },
    packs: entries
  };
}

export { buildProofPlanFixture };
