function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeUnitObject(value) {
  if (typeof value === 'string') {
    return { address: asNonEmptyString(value), record_id: null, slice_id: null };
  }

  if (!isPlainObject(value)) {
    return null;
  }

  return {
    address: asNonEmptyString(
      value.address ?? value.unit_address ?? value.unit ?? value.target_unit ?? value.selected_unit ?? value.work_unit ?? value.subject,
    ),
    record_id: asNonEmptyString(value.record_id ?? value.recordId),
    slice_id: asNonEmptyString(value.slice_id ?? value.sliceId),
  };
}

function evidenceUnitCandidates(entry) {
  return [
    normalizeUnitObject(entry.unit),
    normalizeUnitObject(entry.target_unit),
    normalizeUnitObject(entry.selected_unit),
    normalizeUnitObject(entry.work_unit),
    normalizeUnitObject(entry.unit_address),
    normalizeUnitObject(entry.subject),
    normalizeUnitObject(entry.address),
    normalizeUnitObject(entry),
  ].filter(Boolean);
}

function matchesSelection(candidate, selection) {
  const address = asNonEmptyString(selection?.address);
  const recordId = asNonEmptyString(selection?.record_id);
  const sliceId = asNonEmptyString(selection?.slice_id);

  if (!address || !recordId) {
    return false;
  }

  if (candidate.address === address) {
    return true;
  }

  if (candidate.record_id !== recordId) {
    return false;
  }

  if (sliceId) {
    return candidate.slice_id === sliceId;
  }

  return !candidate.slice_id;
}

export function collectSelectedDerivedEvidence(selection, record) {
  if (!isPlainObject(record) || !Array.isArray(record.derived_evidence)) {
    return [];
  }

  return record.derived_evidence.filter((entry) => {
    if (!isPlainObject(entry)) {
      return false;
    }

    return evidenceUnitCandidates(entry).some((candidate) => matchesSelection(candidate, selection));
  });
}
