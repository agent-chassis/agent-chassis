

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTROLLED_VOCABULARY } from '../vocabulary/controlled-contract-vocabulary.v1.mjs';
import { loweringInventory } from './cel-lowering.mjs';

const vendor = new URL('../vendor/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('cel-reference-sources.json', vendor), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const referenceNotes = {
  'cel.multiply': { attribution: 'local_reference_erratum',
    correction: 'The pinned multiplication example has a sign error. Use -2 * 6 // -12; the upstream text below is retained verbatim.' },
  'cel_java.comprehensions.map_over': { attribution: 'local_reference_erratum',
    correction: 'The filtered transformList example in the pinned text is missing a comma after the filter. The complete corrected example is [1, 2, 3].transformList(indexVar, valueVar, indexVar % 2 == 0, (indexVar * valueVar) + valueVar) // [1, 9].' },
  'cel_java.comprehensions.filter_over': { attribution: 'local_reference_erratum',
    correction: 'The filtered transformList example in the pinned text is missing a comma after the filter. The complete corrected example is [1, 2, 3].transformList(indexVar, valueVar, indexVar % 2 == 0, (indexVar * valueVar) + valueVar) // [1, 9].' },
  'cel.numeric_values': { attribution: 'local_reference_conflict',
    limitation: 'The pinned numeric-values passage says NaN values compare equal, but the same source’s Equality section says NaN == NaN is false and NaN != NaN is true. These passages conflict. Do not infer evaluator behavior from this excerpt; obtain the applicable evaluator contract before relying on NaN comparisons.',
    compare: ['operations', 'cel.equality_rules'] },
  'cel.equality_rules': { attribution: 'local_reference_conflict',
    limitation: 'This section’s NaN examples conflict with the same pinned source’s Numeric Values statement that NaN values compare equal. Do not infer evaluator behavior from these conflicting passages; obtain the applicable evaluator contract before relying on NaN comparisons.',
    compare: ['operations', 'cel.numeric_values'] }
};

let inventory;
function referenceInventory() {
  if (inventory === undefined) inventory = loweringInventory();
  return inventory;
}
const localSource = Object.freeze({ attribution: 'local_application',
  vocabulary: CONTROLLED_VOCABULARY.vocabulary_version,
  definition_owner: '@agent-chassis/controlled-contract/vocabulary/controlled-contract-vocabulary.v1.mjs',
  mapping_owner: '@agent-chassis/controlled-contract/cel-lowering' });

export function celDefinitionIndex() {
  const inventory = referenceInventory();
  return {
    schema_version: 'cel-definition-index.v1',
    definition_digest: sha256(JSON.stringify({ definitions: manifest.definitions,
      vocabulary: CONTROLLED_VOCABULARY, inventory })),
    distinction: 'CEL language defines expression semantics; CEL Java defines extension semantics. Application relations and their observations are defined locally, even when lowered to a CEL operation.',
    operations: Object.fromEntries(Object.entries(manifest.definitions).map(([id, row]) => [id,
      { identifier: row.identifier, kind: row.kind, attribution: row.attribution,
        selection: ['operations', id] }])),
    relations: CONTROLLED_VOCABULARY.operators.map(row => row.term),
    relation_selection: ['relations', '<returned relation term>'],
    sources: structuredClone(manifest.sources)
  };
}

export class CelDefinitionReferenceError extends Error {
  constructor(code, subject, message, recovery) {
    super(message);
    this.name = 'CelDefinitionReferenceError';
    this.code = code;
    this.subject = subject;
    this.recovery = recovery;
  }
}

function selectedSource(row) {
  const source = manifest.sources[row.source];
  const bytes = readFileSync(new URL(source.bundle_path, vendor));
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) {
    throw new CelDefinitionReferenceError('cel_reference_source_integrity', source.bundle_path,
      `Bundled CEL source ${source.bundle_path} differs from pinned ${source.commit}; restore the pinned package bundle.`,
      { action: 'restore_pinned_bundle', source });
  }
  const selected = bytes.subarray(row.section.start_byte, row.section.end_byte);
  if (sha256(selected) !== row.section.sha256) {
    throw new CelDefinitionReferenceError('cel_reference_section_integrity', row.section,
      `CEL section in ${source.bundle_path} differs from its pinned range; restore the pinned package bundle.`,
      { action: 'restore_pinned_bundle', source });
  }
  return { text: selected.toString('utf8'), provenance: { ...source,
    license_source: manifest.sources[row.source === 'kubernetes' ? 'kubernetes_license' : ['language', 'value_format', 'type_format'].includes(row.source) ? 'language_license' : 'extensions_license'],
    section: row.section, section_url: `${source.url}#${row.section.anchor}` } };
}

function operationSelections(mapping) {
  const text = [mapping.must, ...(mapping.input_contract_predicates ?? []).map(row => row.expression)]
    .filter(Boolean).join(' ').replace(/"(?:\\.|[^"\\])*"/gu, '').replace(/<[A-Z]>/gu, '');
  const symbols = new Map([['==', 'cel.eq'], ['!=', 'cel.ne'], ['<=', 'cel.le'], ['>=', 'cel.ge'],
    ['<', 'cel.lt'], ['>', 'cel.gt'], ['&&', 'cel.and'], ['||', 'cel.or'], ['!', 'cel.not'],
    ['?', 'cel.conditional'], ['in', 'cel.in']]);
  const found = new Set([...text.matchAll(/==|!=|<=|>=|&&|\|\||[<>!?]|\bin\b/gu)]
    .map(([token]) => symbols.get(token)));
  for (const [name, id] of [['contains', 'cel.contains'], ['all', 'cel.all'], ['exists', 'cel.exists'], ['size', 'cel.size'],
    ['double', 'cel.double'], ['distinct', 'cel_java.lists.distinct'], ['type', 'cel.type'], ['substring', 'cel_java.strings.substring'], ['sum', 'kubernetes.lists.sum'], ['bind', 'cel_java.bindings.bind'], ['isFinite', 'cel_java.math.isFinite'], ['transformList', 'cel_java.comprehensions.map_over']]) {
    if (new RegExp(`\\b${name}\\s*\\(`, 'u').test(text)) found.add(id);
  }
  if (text.includes('[')) found.add('cel.aggregate_values');
  if (mapping.operand_kind === 'value') { found.add('cel.value_format'); found.add('cel.type_format'); }
  for (const [symbol, id] of [['+', 'cel.add'], [' - ', 'cel.subtract'], [' * ', 'cel.multiply'], [' / ', 'cel.divide'], [' % ', 'cel.remainder']]) if (text.includes(symbol)) found.add(id);
  return [...found].sort().map(id => ['operations', id]);
}

export function selectCelDefinition(selection) {
  const [group, key] = Array.isArray(selection) ? selection : [];
  const operation = group === 'operations' && Object.hasOwn(manifest.definitions, key)
    ? manifest.definitions[key] : null;
  const relation = group === 'relations' ? CONTROLLED_VOCABULARY.operators.find(row => row.term === key) : null;
  if (!Array.isArray(selection) || selection.length !== 2 || (!operation && !relation)) {
    throw new CelDefinitionReferenceError('cel_definition_selection_not_found', selection,
      `Unknown CEL definition selection ${JSON.stringify(selection)}; select a key from celDefinitionIndex().`,
      { export: '@agent-chassis/controlled-contract/cel-definition-reference', function: 'celDefinitionIndex', arguments: [] });
  }
  if (operation) {
    const source = selectedSource(operation);
    const note = referenceNotes[key];

    const annotated = note ? { ...source, upstream_text: source.text,
      text: `Local reference ${note.correction ? 'erratum' : 'conflict'}: ${note.correction ?? note.limitation}\n\nPinned upstream excerpt (verbatim; provenance.section describes these bytes):\n\n${source.text}`,
      reference_note: note } : source;
    return structuredClone({ schema_version: 'cel-definition.v1', selection: [...selection],
    identifier: operation.identifier, kind: operation.kind, attribution: operation.attribution,
    signatures: operation.signatures, ...(operation.extension ? { extension: operation.extension } : {}),
    prerequisites: operation.prerequisites.map(id => ['operations', id]),
    ...annotated });
  }
  const inventory = referenceInventory();
  const mapping = inventory.relations.find(row => row.relation === key);
  return structuredClone({ schema_version: 'cel-definition.v1', selection: [...selection], identifier: key,
    kind: 'application_relation', attribution: 'local_application', text: relation.definition,
    signatures: [relation.signature], definition: relation, provenance: { ...localSource, lowering_version: inventory.version },
    multiplicity: relation.multiplicity, lowering: mapping,
    ...(key === 'value:equal_to' ? { application_semantics: 'Local typed equality preserves numeric types: int 3 differs from double 3.0, with no numeric coercion. It compares complete structures, list order and repetitions, and optional-field presence. Required missing captures remain unavailable. This local application restriction differs from upstream CEL heterogeneous numeric equality.' } : {}),
    required_observations: mapping.bindings ?? [], input_contract: mapping.input_contract ?? [],
    input_contract_observations: mapping.input_contract_observations ?? [],
    mapping_basis: 'Generated inventory examples use S as subject, O/P as operands and a mirrored statement where applicable. Laws constrain the observations a compiled specification reads; these examples do not require observations of every possible subject.',
    cel_operations: operationSelections(mapping),
    ...(key.startsWith('value:') ? { permission_boundary: 'A conditional positive row contributes permission only while active. MUST_NOT prohibits; it supplies no positive permitted domain. An empty-search message rule alone does not authorize an arbitrary nonempty-search message. State the intended complementary behavior or retain the source decision as unresolved.' } : {}),
    ...(key === 'value:choose' ? { predicate_boundary: 'choose(condition, predicate, true) expresses a one-way predicate: when the condition is false, this predicate leaves behavior unconstrained. It does not complete an unresolved behavioral specification or change closed permissions. Do not adopt it as an automatic repair or remove missing source decisions. Test both condition branches; a bounded fragment grants no completeness to its original.' } : {}),
    observation_boundary: key === 'number:returns'
      ? 'Numeric returns has one singular result, observed as list<double> so absence and extra values remain evaluable. MUST requires exactly its declared value; MAY permits absence or that value; MUST_NOT prohibits its declared value. Closure and singularity are conformance checks, not observation admission checks. The caller supplies observations; CEL acquires none.'
      : 'The caller supplies observations with the vocabulary meaning. Numeric relation sets preserve their declared set semantics; number:returns instead governs a singular result. A Boolean observation of determinism does not establish determinism. CEL evaluates the supplied facts; it does not independently establish application relations.' });
}
