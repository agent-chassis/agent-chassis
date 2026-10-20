

import { prepareCommittedQuery, runSnapshotQuery } from '../../lib/sidecar-query-selection.mjs';
import { captureCommittedSourceContext, readCommittedSourceDescriptors, unavailableCommittedSnapshot } from '../../lib/sidecar-committed-preparation.mjs';
import { resolvePublishedSidecarSnapshot, pinnedQueryContext } from '../../lib/sidecar-published-preparation.mjs';
import { getSidecarSymbolDefinition, projectSidecarSymbolQueryForMcp, resolveCommittedSourceSymbol } from '../../lib/sidecar-symbol-query.mjs';
import { readCompleteFiles } from '../../lib/sidecar-occurrence-source.mjs';
import { parseScipSymbol } from '../../lib/sidecar-scip-normalize.mjs';
import { descriptionKey } from './contract-requirement-descriptions.mjs';
import { projectRequirementSourceLink, REQUIREMENT_SOURCE_FIELD } from './contract-requirement-source-links.mjs';

const codeBound = entity => ['code_symbol', 'repository_path'].includes(entity.identity.kind);
const failure = (code, more = {}) => ({ state: 'incomplete', code, ...more });
const quietPublishedContext = { prepare: options => resolvePublishedSidecarSnapshot({ ...options, dirtyState: false, refresh: false }) };
const indexUnavailable = error => error?.code === 'sidecar_published_index_unavailable' ||
  ['repository_snapshot_changed', 'base_store_incompatible'].includes(error?.code);
const callableTypes = ['cc:operation', 'cc:command', 'cc:process', 'cc:runtime_component', 'cc:test', 'cc:capability'];

export function projectRequirementDescriptionSource(source) {
  const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined)
    .map(key => [key, structuredClone(value[key])]));
  const definition = value => pick(value, ['path', 'symbol', 'declaration_kind',
    'start_line', 'end_line', 'source_text', 'defined_meanings']);
  return { ...pick(source, ['state', 'code', 'identity', 'resolution', 'defined_meanings',
    'path', 'repository', 'bound_repository', 'cause', 'source_basis', 'source_limitation']),
    ...(source.source_generation?.committed_source == null ? {} : { source_basis: 'committed_source' }),
    ...(source.definitions === undefined ? {} : { definitions: source.definitions.map(definition) }),
    ...(source.candidates === undefined ? {} : { candidates: source.candidates.map(definition) }),
    ...(typeof source.recovery === 'string' ? { recovery: source.recovery } : {}),
    ...(source.scip_unavailable == null ? {} : { source_limitation: pick(source.scip_unavailable, ['code', 'reason']) }) };
}

export function projectRequirementDefinitionMeaning(value) {
  if (Array.isArray(value)) return value.map(projectRequirementDefinitionMeaning);
  if (value === null || typeof value !== 'object') return value;
  if (value.source?.field === REQUIREMENT_SOURCE_FIELD && value.user_requirement !== undefined) {
    return projectRequirementSourceLink(value);
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'source_generation')
    .map(([key, member]) => [key, key === 'source' && member?.state === 'absent'
      ? projectRequirementSourceLink(member) : key === 'source' && member?.state !== undefined &&
      (member.source_generation !== undefined || member.defined_meanings !== undefined ||
        member.definitions !== undefined || member.candidates !== undefined ||
        member.source_basis !== undefined || member.code?.startsWith('description_'))
      ? projectRequirementDescriptionSource(member) : projectRequirementDefinitionMeaning(member)]));
}

async function optionalIndex(repoRoot, context) {
  try { return { prepared: await prepareCommittedQuery({ dir: repoRoot }, context ?? quietPublishedContext) }; }
  catch (error) {
    if (!indexUnavailable(error)) throw error;
    return { unavailable: { code: error.code, reason: error.index_state?.reason ?? error.code,
      recovery: error.index_state ?? error.status ?? null } };
  }
}

function definitionFingerprint(descriptions) {
  return JSON.stringify([...descriptions].map(([key, row]) => [key, { state: row.state, code: row.code ?? null,
    identity: row.identity, resolution: row.resolution, defined_meanings: row.defined_meanings,
    definitions: row.definitions?.map(definition => ({ path: definition.path, source_text: definition.source_text,
      declaration_kind: definition.declaration_kind, symbol: definition.symbol })) }]));
}

function nativeDeclaration(parsed, definitions) {
  if (!['resolved', 'ambiguous'].includes(parsed.state)) return parsed;
  const candidates = parsed.state === 'resolved' ? [parsed.definition] : parsed.candidates;
  const matches = candidates.filter(candidate => definitions.every(row => {
    const range = row.occurrence.payload.range;
    return range && candidate.name_line >= range.start_line && candidate.name_line <= range.end_line;
  }));
  return matches.length === 1 ? { state: 'resolved', definition: matches[0], provider: parsed.provider } : parsed.state === 'resolved'
    ? { state: 'ambiguous', code: 'description_identity_ambiguous', candidates } : parsed;
}

function preparedDescriptions({ descriptions, generation, repoRoot, repository, owner, entities }) {
  const fingerprint = definitionFingerprint(descriptions);
  return { descriptions, source_generation: generation,
    assertDefinitions: async () => {
      const current = await prepareRequirementDescriptionSources({ repoRoot, repository, owner, entities });
      if (definitionFingerprint(current.descriptions) !== fingerprint) throw unavailableCommittedSnapshot('repository_snapshot_changed',
        { source_generation: generation, current_source_generation: current.source_generation,
          reason: 'a used definition, binding or resolution changed before publication' });
    } };
}

export function prepareRequirementDescriptionSources(input) {
  return runSnapshotQuery({ repeatOnPublication: true }, () => prepareDescriptionSources(input));
}

async function prepareDescriptionSources({ repoRoot, repository, owner, entities, context = null }) {
  const codeEntities = [...new Map(entities.filter(codeBound).map(entity => [descriptionKey(owner, entity), entity])).values()];
  const descriptions = new Map();
  if (!codeEntities.length) return { descriptions, source_generation: null, assertDefinitions: async () => {} };
  const queryable = codeEntities.filter(entity => {
    if (entity.identity.repository === repository) return true;
    descriptions.set(descriptionKey(owner, entity), failure('description_repository_unavailable',
      { repository: entity.identity.repository, bound_repository: repository,
        recovery: `The reference names ${entity.identity.repository}; source resolution is bound to ${repository}. Correct the identity only if mistaken, preserving the requirement meaning. An intentional foreign reference remains outside this source scope.` }));
    return false;
  });
  if (!queryable.length) return { descriptions, source_generation: null, assertDefinitions: async () => {} };
  let captured;
  try { captured = await captureCommittedSourceContext({ dir: repoRoot }); }
  catch (error) {
    if (error?.code !== 128 && error?.code !== 'ENOENT') throw error;
    for (const entity of queryable) descriptions.set(descriptionKey(owner, entity), failure('description_committed_source_unavailable',
      { cause: { code: error.code, message: error.message }, recovery: 'Make the owning Git repository and committed HEAD available.' }));
    return preparedDescriptions({ descriptions, generation: null, repoRoot, repository, owner, entities: codeEntities });
  }
  const paths = [...new Set(queryable.map(entity => entity.identity.path))];
  const descriptors = await readCommittedSourceDescriptors(captured, paths);
  const files = await readCompleteFiles(captured.repoRoot, paths, descriptors);

  const index = queryable.some(entity => entity.identity.scip_symbol !== undefined)
    ? await optionalIndex(captured.repoRoot, context) : null;
  if (index?.prepared && index.prepared.repoRoot !== captured.repoRoot) throw unavailableCommittedSnapshot('base_store_incompatible',
    { reason: 'the source and index captures identify different repositories' });
  const generation = { committed_source: { repository_commit: captured.repository_commit, repository_tree: captured.repository_tree },
    published_index: index?.prepared?.graph_snapshot ?? null, index_unavailable: index?.unavailable ?? null,
    resolution_scope: queryable.map(entity => descriptionKey(owner, entity)) };
  for (const entity of queryable) {
    const identity = entity.identity, key = descriptionKey(owner, entity);
    const file = files.get(identity.path).entry;
    if (file.state !== 'available') {
      descriptions.set(key, failure(file.reason === 'missing_file_descriptor' ? 'description_source_missing' : file.reason,
        { source_generation: generation, path: identity.path, recovery: 'Restore the exact committed regular source file.' }));
      continue;
    }
    if (identity.kind === 'repository_path') {
      descriptions.set(key, { state: 'complete', identity, source_generation: generation,
        defined_meanings: ['subject', 'object', 'identity'], definitions: [file] });
      continue;
    }
    let parsed = await resolveCommittedSourceSymbol({ path: identity.path, symbol: identity.symbol, source_text: file.source_text });
    let native = null;
    const prepared = index?.prepared;
    if (identity.scip_symbol !== undefined && prepared?.status.scip_state?.scip_available === true &&
      prepared.status.scip_state.graph_available === true) {

      const result = await getSidecarSymbolDefinition({ dir: captured.repoRoot, symbol: identity.scip_symbol,
        ...(parseScipSymbol(identity.scip_symbol).local ? { path: identity.path } : {}) }, pinnedQueryContext(prepared));
      const recovery = projectSidecarSymbolQueryForMcp(result).next_action;
      if (result.symbol_resolution.state !== 'resolved') {
        descriptions.set(key, failure(result.symbol_resolution.status_reason, { source_generation: generation,
          resolution: result.symbol_resolution.state, recovery }));
        continue;
      }
      const definitions = result.definitions.filter(row => row.path === identity.path);
      const regions = new Map(result.context_regions.map(row => [row.region_id, row]));
      if (!definitions.length || definitions.some(row => row.source.state !== 'available' || !regions.has(row.source.region_id))) {
        descriptions.set(key, failure('description_definition_source_missing', { source_generation: generation,
          recovery: 'Resolve an exact definition with source in the committed owning path; external symbol information is insufficient.' }));
        continue;
      }
      const indexedFile = result.complete_files.find(row => row.path === identity.path);
      if (indexedFile?.blob_oid === file.blob_oid) parsed = nativeDeclaration(parsed, definitions);
      else {
        const indexed = indexedFile?.source_text === undefined ? null : nativeDeclaration(await resolveCommittedSourceSymbol({ path: identity.path,
          symbol: identity.symbol, source_text: indexedFile.source_text }), definitions);
        if (parsed.state === 'ambiguous' && indexed?.state === 'resolved') {
          const matches = parsed.candidates.filter(row => row.symbol === indexed.definition.symbol);
          if (matches.length === 1) parsed = { state: 'resolved', definition: matches[0], provider: parsed.provider };
        }
        if (parsed.state !== 'resolved' || indexed?.state !== 'resolved' ||
          indexed.definition.source_text !== parsed.definition.source_text) {
          descriptions.set(key, failure('description_definition_source_stale', { source_generation: generation,
            recovery: 'Publish an index resolving the changed definition, or author its exact current path/symbol identity without stale SCIP evidence.' }));
          continue;
        }
      }
      native = { native_identity: result.symbol_resolution.candidates[0].symbol_key,
        definitions: definitions.map(row => ({ hit_id: row.hit_id, occurrence: row.occurrence,
          blob_oid: indexedFile?.blob_oid, ...structuredClone(regions.get(row.source.region_id)) })) };
    }
    if (parsed.state !== 'resolved' && (native === null || parsed.state !== 'unavailable')) {
      descriptions.set(key, failure(parsed.code, { source_generation: generation, resolution: parsed.state,
        candidates: parsed.candidates ?? [], recovery: 'Identify one exact declaration in the owning path; unsupported source syntax needs an available native definition.' }));
      continue;
    }

    const meanings = [...new Set([...(parsed.state === 'resolved' ? parsed.definition.defined_meanings : ['subject', 'object']), 'identity'])];
    if (meanings.includes('behavior') && callableTypes.includes(entity.type_term)) meanings.push('value');
    descriptions.set(key, { state: 'complete', identity, source_generation: generation, defined_meanings: meanings,
      ...(native === null ? {} : { native_identity: native.native_identity }),
      ...(identity.scip_symbol === undefined || native !== null ? {} : { scip_unavailable: index?.unavailable ?? prepared?.status.scip_state }),
      definitions: parsed.state === 'resolved' ? [{ ...parsed.definition, blob_oid: file.blob_oid, provider: parsed.provider }] : native.definitions });
  }
  return preparedDescriptions({ descriptions, generation, repoRoot: captured.repoRoot, repository, owner, entities: codeEntities });
}
