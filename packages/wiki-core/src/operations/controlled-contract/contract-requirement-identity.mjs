import { createHash } from "node:crypto";

export function canonicalMaterial(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMaterial).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalMaterial(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function mint(prefix, subject, body) {
  const digest = createHash("sha256")
    .update(canonicalMaterial({ subject, body })).digest("hex").slice(0, 40);
  return `${prefix}-${digest}`;
}

export const controlledContractIdentityScope = (wkId, focus = null) =>
  canonicalMaterial({ wk_id: wkId, focus: focus ?? null });

export const emptyControlledContractContent = (schemaIdentity) => ({
  schema_version: schemaIdentity.schema_version, vocabulary_version: schemaIdentity.vocabulary_version,
  profile_id: schemaIdentity.profile_id, references: [], propositions: [], claims: [], relations: [],
  collections: [], residue: [], annotations: [], test_proof_version: schemaIdentity.test_proof_version,
  test_proofs: [] });

