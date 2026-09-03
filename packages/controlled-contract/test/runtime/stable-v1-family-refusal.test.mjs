import assert from "node:assert/strict";
import test from "node:test";

import { validateStableV1Family } from
  "../../lib/stable-v1-family-validation.mjs";
import {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1
} from "../../lib/verification-profile-schema-v1.mjs";
import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";

const identityPayload = () => ({
  contract: { schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1, profile_id: PROFILE_ID_V1 },
  profile: { schema_version: PROFILE_SCHEMA_VERSION_V1,
    contract_schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1 },
  input: { input_version: EVALUATION_INPUT_VERSION_V1 },
  result: { result_version: RESULT_VERSION_V1 }
});

test("family gate refuses experimental, unknown, mixed, partial, and cross-version first", () => {
  const cases = [
    ["contract", "schema_version", "controlled-acceptance-contract.experimental.v0.2",
      "stable_family_experimental_substitution"],
    ["contract", "schema_version",
      "controlled-acceptance-contract.test-proof.experimental.v0.3",
      "stable_family_experimental_substitution"],
    ["contract", "profile_id", "acceptance-contract.standard.experimental.v0.3",
      "stable_family_experimental_substitution"],
    ["contract", "schema_version", "controlled-acceptance-contract.unknown",
      "stable_family_identity_unknown"],
    ["profile", "schema_version", "controlled-contract-verification-profile.unknown",
      "stable_family_identity_unknown"],
    ["input", "input_version", "controlled-contract-verification-profile-input.experimental.v0.2",
      "stable_family_experimental_substitution"],
    ["input", "input_version", "controlled-contract-verification-profile-input.unknown",
      "stable_family_identity_unknown"],
    ["result", "result_version",
      "controlled-contract-verification-profile-result.experimental.v0.3",
      "stable_family_experimental_substitution"],
    ["result", "result_version", "controlled-contract-verification-profile-result.unknown",
      "stable_family_identity_unknown"]
  ];
  for (const [surface, field, value, code] of cases) {
    const payload = identityPayload();
    payload[surface][field] = value;
    const result = validateStableV1Family(payload);
    assert.equal(result.valid, false);
    assert.equal(result.stage, "identity");
    assert.equal(result.diagnostics.diagnostics[0].code, code);
  }
  const partial = identityPayload();
  delete partial.contract.schema_version;
  assert.equal(validateStableV1Family(partial).stage, "identity");
});

test("caller flags and environment cannot select a legacy family", () => {
  const payload = identityPayload();
  payload.compatibility = true;
  payload.legacy_family = "v0.3";
  payload.contract.schema_version = "controlled-acceptance-contract.experimental.v0.3";
  assert.equal(validateStableV1Family(payload).valid, false);
});
