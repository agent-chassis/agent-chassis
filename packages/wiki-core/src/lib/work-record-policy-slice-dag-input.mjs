import { projectNodeEnginePolicySliceDagRequest } from "./node-engine-policy-slice-dag-wire.mjs";

const LOCAL_SLICE_ADDRESS = /^SLICE-\d{3}$/u;
const QUALIFIED_SLICE_ADDRESS = /^WK-\d{4}#SLICE-\d{3}$/u;

function projectDependencyAddress(recordId, dependency) {
  if (LOCAL_SLICE_ADDRESS.test(dependency)) return `${recordId}#${dependency}`;
  if (QUALIFIED_SLICE_ADDRESS.test(dependency) && dependency.startsWith(`${recordId}#`)) {
    return dependency;
  }
  throw new TypeError(`policy-slice-dag dependency address is invalid: ${dependency}`);
}

export function projectCanonicalWorkRecordPolicySliceDagRequest(
  record,
  { source_digest, organization_policy, organization_policy_digest } = {},
) {
  return projectNodeEnginePolicySliceDagRequest({
    record_id: record.id,
    work_record_source_digest: source_digest,
    organization_policy,
    organization_policy_digest,
    slices: record.slices.map((slice) => ({
      address: `${record.id}#${slice.id}`,
      work_kind: slice.work_kind,
      status: slice.status,
      depends_on: slice.depends_on.map((dependency) => projectDependencyAddress(record.id, dependency)),
    })),
  });
}

export const buildWorkRecordPolicySliceDagRequest =
  projectCanonicalWorkRecordPolicySliceDagRequest;
