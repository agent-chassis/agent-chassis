import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_SCHEMA } from "../../legacy/versions/controlled-contract-general-v033.mjs";
import { NATIVE_CONTRACT_SCHEMA } from "../../../lib/native-contract-carrier.mjs";
import { NATIVE_CONTRACT_SCHEMA_V034 } from
  "../lib/native-contract-carrier-v034.mjs";
import {
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
  VERIFICATION_PROFILE_RESULT_SCHEMA,
  VERIFICATION_PROFILE_SCHEMA
} from "../../../lib/verification-profile.mjs";
import {
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V034,
  VERIFICATION_PROFILE_SCHEMA_V034
} from "../../../lib/verification-profile-v034.mjs";
import {
  COVERAGE_WITNESS_INDEX_SCHEMA,
  PROOF_PACK_ADEQUACY_RUN_SCHEMA,
  PROOF_PACK_ADEQUACY_SCHEMA
} from "../../support/proof-pack-adequacy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputs = [
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-proof-pack-coverage-witness-index.experimental.v0.1.schema.json"
    ),
    schema: COVERAGE_WITNESS_INDEX_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-general.experimental.v0.33.schema.json"
    ),
    schema: BASE_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-acceptance-contract.experimental.v0.1.schema.json"
    ),
    schema: NATIVE_CONTRACT_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-acceptance-contract.experimental.v0.2.schema.json"
    ),
    schema: NATIVE_CONTRACT_SCHEMA_V034
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile.experimental.v0.1.schema.json"
    ),
    schema: VERIFICATION_PROFILE_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile-input.experimental.v0.1.schema.json"
    ),
    schema: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile-result.experimental.v0.1.schema.json"
    ),
    schema: VERIFICATION_PROFILE_RESULT_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile.experimental.v0.2.schema.json"
    ),
    schema: VERIFICATION_PROFILE_SCHEMA_V034
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile-input.experimental.v0.2.schema.json"
    ),
    schema: VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-verification-profile-result.experimental.v0.2.schema.json"
    ),
    schema: VERIFICATION_PROFILE_RESULT_SCHEMA_V034
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-proof-pack-adequacy.experimental.v0.1.schema.json"
    ),
    schema: PROOF_PACK_ADEQUACY_SCHEMA
  },
  {
    path: path.join(
      scriptDirectory,
      "../schema/controlled-contract-proof-pack-adequacy-run.experimental.v0.1.schema.json"
    ),
    schema: PROOF_PACK_ADEQUACY_RUN_SCHEMA
  }
];

for (const output of outputs) {
  await writeFile(output.path, `${JSON.stringify(output.schema, null, 2)}\n`, "utf8");
  process.stdout.write(`${output.path}\n`);
}
