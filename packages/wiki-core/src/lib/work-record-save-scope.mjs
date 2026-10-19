import { REPOSITORY_SCOPE_FIELDS } from './work-record-repository-path.mjs';

export function authoredSaveRecordScopes({ record, previousRecord, selectedUnit, changes, bindings }) {
  const targets = [];
  const add = (request, scope, previous, inputPath) => {
    const fields = REPOSITORY_SCOPE_FIELDS.filter(field => Object.hasOwn(request, field));
    const derivedChange = previous !== undefined && REPOSITORY_SCOPE_FIELDS.some(field =>
      JSON.stringify(scope[field]) !== JSON.stringify(previous[field]));
    if (fields.length || derivedChange) targets.push({ scope, inputPath,
      authored: Object.fromEntries(fields.map(field => [field, request[field]])) });
  };
  add(changes, selectedUnit === null ? record : record.slices.find(slice => slice.id === selectedUnit),
    selectedUnit === null ? previousRecord : previousRecord.slices.find(slice => slice.id === selectedUnit), 'changes');
  for (const member of ['slices', 'ready_slices']) {
    for (const [index, row] of (changes[member] ?? []).entries()) {
      const id = row.id ?? bindings.slice?.[row.key];
      add(row, record.slices.find(slice => slice.id === id), previousRecord.slices.find(slice => slice.id === id),
        `changes.${member}[${index}]`);
    }
  }
  return targets;
}
