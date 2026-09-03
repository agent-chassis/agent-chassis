import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";

export const CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS = Object.freeze({
  index_list_bytes: 4_096,
  compact_summary_bytes: 8_192,
  detail_census_bytes: 16_384,
  page_items: 64
});

export function controlledContractPrettyJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

export function controlledContractAssessmentSummaryAllowance(adapterFields) {
  if (adapterFields === null || typeof adapterFields !== "object" ||
      Array.isArray(adapterFields)) {
    throw new ControlledContractToolError(
      "controlled_contract_semantic_projection_invalid",
      "assessment adapter fields are invalid for final-envelope budgeting",
      { changed: false, caller_correctable: false }
    );
  }
  const marker = { assessment_summary_marker: null };
  const adapterBytes = controlledContractPrettyJsonBytes({ ...adapterFields, ...marker }) -
    controlledContractPrettyJsonBytes(marker);
  const allowance = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes -
    adapterBytes;
  if (!Number.isInteger(allowance) || allowance <= 0) {
    throw new ControlledContractToolError(
      "controlled_contract_semantic_projection_invalid",
      "assessment adapter fields leave no final-envelope summary allowance",
      { changed: false, caller_correctable: false, adapter_bytes: adapterBytes,
        maximum_bytes: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes }
    );
  }
  return allowance;
}

export function assertControlledContractSemanticProjectionBound(
  value,
  maximumBytes,
  details = {}
) {
  const byteLength = controlledContractPrettyJsonBytes(value);
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0 || byteLength > maximumBytes) {
    throw new ControlledContractToolError(
      "controlled_contract_semantic_projection_invalid",
      "controlled-contract semantic projection cannot satisfy its declared byte bound",
      {
        changed: false,
        caller_correctable: false,
        byte_length: byteLength,
        maximum_bytes: maximumBytes,
        ...structuredClone(details)
      }
    );
  }
  return value;
}
