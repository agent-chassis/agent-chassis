

import { isObject, normalizeString } from "./work-record-feature-vector-normalize.mjs";

function normalizeRepoAddress(source = {}, options = {}) {
  const recordId = normalizeString(options.recordId ?? source.record_id ?? source.recordId ?? source.id);
  const sliceId = normalizeString(
    options.sliceId ??
      options.selectedSliceId ??
      source.slice_id ??
      source.sliceId ??
      source.work_unit_slice_id ??
      source.workUnitSliceId ??
      parseWorkUnitAddressString(source.id)?.slice_id
  );
  const repo = normalizeString(options.repo ?? source.repo ?? source.repository ?? null);
  const address = normalizeString(options.address ?? source.address ?? source.work_unit_address?.address ?? null);
  const normalizedAddress =
    address ??
    (recordId ? (sliceId ? `${recordId}#${sliceId}` : recordId) : null);

  return {
    repo,
    record_id: recordId,
    slice_id: sliceId,
    address: normalizedAddress
  };
}

function parseWorkUnitAddressString(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const match = /^([A-Za-z]+-\d{4})(?:#(.+))?$/u.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    record_id: match[1],
    slice_id: normalizeString(match[2])
  };
}

function resolveSelectedSlice(source, options = {}) {
  if (isObject(options.selectedSlice)) {
    return options.selectedSlice;
  }

  if (isObject(source.selected_slice)) {
    return source.selected_slice;
  }

  if (isObject(source.selectedSlice)) {
    return source.selectedSlice;
  }

  if (!Array.isArray(source.slices) || source.slices.length === 0) {
    return null;
  }

  const requestedSliceId =
    normalizeString(options.sliceId ?? options.selectedSliceId ?? source.slice_id ?? source.sliceId) ??
    parseWorkUnitAddressString(source.id)?.slice_id;
  const requestedSliceAddress = normalizeString(options.sliceAddress ?? options.selectedSliceAddress);

  if (!requestedSliceId && !requestedSliceAddress) {
    return null;
  }

  return (
    source.slices.find((slice) => {
      if (!isObject(slice)) {
        return false;
      }
      const sliceId = normalizeString(slice.id ?? slice.slice_id ?? slice.sliceId);
      const sliceAddress = normalizeString(slice.address ?? slice.work_unit_address?.address);
      if (requestedSliceId && sliceId === requestedSliceId) {
        return true;
      }
      return Boolean(requestedSliceAddress && sliceAddress === requestedSliceAddress);
    }) ?? null
  );
}

export { normalizeRepoAddress, parseWorkUnitAddressString, resolveSelectedSlice };
