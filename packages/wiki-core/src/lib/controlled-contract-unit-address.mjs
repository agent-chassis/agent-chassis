

export function coverageUnitAddress({ wkId, selectedUnit = null }) {
  return selectedUnit === null || selectedUnit === undefined
    ? wkId : `${wkId}#${selectedUnit}`;
}

export function controlledAcceptanceSelectedUnit(wkId, selectedUnit = null) {
  const sliceId = selectedUnit ?? null;
  return Object.freeze({
    kind: sliceId === null ? "wk" : "slice",
    address: coverageUnitAddress({ wkId, selectedUnit: sliceId }),
    record_id: wkId,
    slice_id: sliceId
  });
}
