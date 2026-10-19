

export const INTEGRATED_SLICE_REDISPATCH_CODE = "integrated_slice_requires_new_slice";

export function integratedSliceDispatchRefusal(slice, subject) {
  if (!/^WK-\d{4}#SLICE-\d{3}$/u.test(subject ?? "") ||
      slice?.id !== subject.split("#")[1] ||
      typeof slice.integrated_delivery_sha !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(slice.integrated_delivery_sha)) return null;
  const parent = subject.split("#")[0];
  return {
    code: INTEGRATED_SLICE_REDISPATCH_CODE,
    reason: `${subject} is already integrated. Further implementation requires a new slice of ${parent}, preserving existing review, disposition, outstanding remediation and validation obligations.`,
    detail: { subject, parent, integrated_delivery_sha: slice.integrated_delivery_sha,
      assignment_authoring: { unit: parent, save_tool: "save_record", placement: "changes.ready_slices",
        values: "caller_authored" } }
  };
}
