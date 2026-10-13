

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTROLLED_VOCABULARY } from '../vocabulary/controlled-contract-vocabulary.v1.mjs';
import { loweringInventory } from './cel-lowering.mjs';

const vendor = new URL('../vendor/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('cel-reference-sources.json', vendor), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = loweringInventory();
const localSource = Object.freeze({ attribution: 'local_application',
  vocabulary: CONTROLLED_VOCABULARY.vocabulary_version,
  definition_owner: '@agent-chassis/controlled-contract/vocabulary/controlled-contract-vocabulary.v1.mjs',
  mapping_owner: '@agent-chassis/controlled-contract/cel-lowering',
  lowering_version: inventory.version });

export function celDefinitionIndex() {
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
    license_source: manifest.sources[row.source === 'language' ? 'language_license' : 'extensions_license'],
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
  for (const [name, id] of [['all', 'cel.all'], ['exists', 'cel.exists'], ['size', 'cel.size'],
    ['double', 'cel.double'], ['distinct', 'cel_java.lists.distinct']]) {
    if (new RegExp(`\\b${name}\\s*\\(`, 'u').test(text)) found.add(id);
  }
  if (text.includes('[')) found.add('cel.aggregate_values');
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
  if (operation) return structuredClone({ schema_version: 'cel-definition.v1', selection: [...selection],
    identifier: operation.identifier, kind: operation.kind, attribution: operation.attribution,
    signatures: operation.signatures, ...(operation.extension ? { extension: operation.extension } : {}),
    prerequisites: operation.prerequisites.map(id => ['operations', id]), ...selectedSource(operation) });
  const mapping = inventory.relations.find(row => row.relation === key);
  return structuredClone({ schema_version: 'cel-definition.v1', selection: [...selection], identifier: key,
    kind: 'application_relation', attribution: 'local_application', text: relation.definition,
    signatures: [relation.signature], definition: relation, provenance: localSource,
    multiplicity: relation.multiplicity, lowering: mapping,
    required_observations: mapping.bindings ?? [], input_contract: mapping.input_contract ?? [],
    input_contract_observations: mapping.input_contract_observations ?? [],
    mapping_basis: 'Generated inventory examples use S as subject, O/P as operands and a mirrored statement where applicable. Laws constrain the observations a compiled specification reads; these examples do not require observations of every possible subject.',
    cel_operations: operationSelections(mapping),
    observation_boundary: key === 'number:returns'
      ? 'Numeric returns has one singular result, observed as list<double> so absence and extra values remain evaluable. MUST requires exactly its declared value; MAY permits absence or that value; MUST_NOT prohibits its declared value. Closure and singularity are conformance checks, not observation admission checks. The caller supplies observations; CEL acquires none.'
      : 'The caller supplies observations with the vocabulary meaning. Numeric relation sets preserve their declared set semantics; number:returns instead governs a singular result. A Boolean observation of determinism does not establish determinism. CEL evaluates the supplied facts; it does not independently establish application relations.' });
}
