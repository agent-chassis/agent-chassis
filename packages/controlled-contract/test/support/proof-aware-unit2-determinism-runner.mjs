import {
  constructProofAwarePlanningCarrier
} from "../../lib/proof-aware-unit2-construction.mjs";
import {
  createProofAwareUnit2Fixture
} from "./proof-aware-unit2-fixture.mjs";

const fixture = await createProofAwareUnit2Fixture();
try {
  const result = constructProofAwarePlanningCarrier(fixture.input);
  if (result.status !== "success") throw new Error(JSON.stringify(result.failure));
  process.stdout.write(JSON.stringify({
    anonymous_candidate_digest: result.anonymous_carrier.candidate_digest,
    construction_cycle_digest: result.input_binding.construction_cycle_digest
  }));
} finally {
  await fixture.cleanup();
}
