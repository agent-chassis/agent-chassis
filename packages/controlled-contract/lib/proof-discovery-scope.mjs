

import { readFileSync } from 'node:fs';
import { loadAdmittedProofPackMeaning, readProofPackCatalog } from './admitted-proof-packs.mjs';
import { loadPackParameterContract, describePackParameters } from './pack-parameters.mjs';
import { CONTROLLED_VOCABULARY } from './vocabulary-v1.mjs';
import { canonicalDigest, deepFreeze, compareCodeUnits } from './deterministic-projection-primitives.mjs';

export class ProofDiscoveryScopeError extends Error {
  constructor(construct, details = {}) {
    super(`Proof discovery cannot render ${construct}`);
    this.code = 'proof_discovery_scope_unsupported';
    this.details = { construct, ...details };
  }
}

const words = value => value.replace(/[_-]/gu, ' ');
const terms = new Map([
  ...CONTROLLED_VOCABULARY.operators,
  ...CONTROLLED_VOCABULARY.applicability_modes,
  ...CONTROLLED_VOCABULARY.type_terms
].map(entry => [entry.term, entry]));

export function renderDiscoveryConstraint({ ref, constraint }) {
  const proposition = constraint.proposition_template;
  if (!proposition) return { ref, constraint: structuredClone(constraint) };
  const operator = terms.get(proposition.operator);
  const context = terms.get(proposition.applicability_context.mode);
  if (!operator || !context) throw new ProofDiscoveryScopeError(
    !operator ? proposition.operator : proposition.applicability_context.mode, { ref });
  if (!['evidence', 'behavior', 'verification'].includes(constraint.claim_kind) ||
      !constraint.allowed_modalities.every(x => ['MUST', 'MUST_NOT', 'MAY'].includes(x))) {
    throw new ProofDiscoveryScopeError('claim modality or kind', { ref });
  }
  const reading = `${constraint.claim_kind}: ${words(proposition.subject_role)} ` +
    `${constraint.allowed_modalities.join(' / ')} satisfy ${proposition.operator} ` +
    `with ${proposition.operands.map(x => words(x.role ?? JSON.stringify(x))).join(', ')}. ` +
    `${operator.definition} ${context.definition}`;
  return { ref, reading, constraint: structuredClone(constraint) };
}

export function projectProofDiscoveryScope(pack) {
  const description = describePackParameters(loadPackParameterContract(pack));
  const constraints = description.constraints.map(renderDiscoveryConstraint);
  const refinements = description.parameters.map(parameter => ({
    name: parameter.name, refinements: parameter.refinements,
    applicability: parameter.constraints
  }));

  return deepFreeze({
    proof_name: description.profile_id,
    profile_version: description.profile_version,
    assertion: pack.admission.guarantee,
    exclusions: [...pack.admission.explicit_exclusions],
    constraints,
    refinements,
    observations: description.construction.required_observations,
    capabilities: description.capabilities.map(({ kind, state, evidence_kind }) =>
      ({ kind, state, evidence_kind })),
    provenance: {
      profile_id: description.profile_id, profile_version: description.profile_version,
      profile_digest: pack.profile_digest, admission_digest: pack.admission_digest,
      parameter_contract_digest: pack.parameter_contract_digest,
      vocabulary_digest: canonicalDigest(CONTROLLED_VOCABULARY)
    }
  });
}

export async function loadProofDiscoveryPopulation(catalog, rawCatalogDigest) {
  const admittedCatalog = await readProofPackCatalog();
  const associations = new Map();
  for (const intent of catalog.intents) for (const identity of intent.capable_packs) {
    const key = `${identity.profile_id}@${identity.profile_version}`;
    if (!associations.has(key)) associations.set(key, { identity, intents: [] });
    associations.get(key).intents.push(intent);
  }
  const population = [];
  const sourcePaths = ['proof-intents/catalog.json', 'profiles/catalog.json',
    'vocabulary/controlled-contract-vocabulary.v1.mjs'];
  for (const { identity } of associations.values()) {
    const entry = admittedCatalog.packs.find(x => x.profile_id === identity.profile_id);
    if (!entry) throw new ProofDiscoveryScopeError('intent/admission membership mismatch', { identity });
    sourcePaths.push(...['profile.json', 'admission.json', 'parameter-contract.json'].map(x => `${entry.path}/${x}`));
  }
  const urls = sourcePaths.map(path => new URL(`../${path}`, import.meta.url));
  const currentSourceIdentity = () => ({ discovery: canonicalDigest(
    urls.map(url => readFileSync(url).toString('base64'))) });
  const sourceIdentity = currentSourceIdentity();

  if (canonicalDigest(JSON.parse(readFileSync(urls[0], 'utf8'))) !== rawCatalogDigest ||
      canonicalDigest(JSON.parse(readFileSync(urls[1], 'utf8'))) !== canonicalDigest(admittedCatalog))
    throw new ProofDiscoveryScopeError('catalog moved during discovery initialization');
  for (const [id, { identity, intents }] of [...associations].sort(([a], [b]) => compareCodeUnits(a, b))) {
    const pack = await loadAdmittedProofPackMeaning(identity.profile_id);
    if (pack.profile.profile_version !== identity.profile_version) throw new ProofDiscoveryScopeError(
      'intent/admission exact identity mismatch', { identity });
    population.push({ id, ...projectProofDiscoveryScope(pack), intents });
  }
  if (canonicalDigest(currentSourceIdentity()) !== canonicalDigest(sourceIdentity))
    throw new ProofDiscoveryScopeError('sources moved during discovery initialization');
  return { population: deepFreeze(population), sourceIdentity, currentSourceIdentity };
}

export function discoveryLimitation(scope, queryTerms, normalize) {
  const iteratedTerms = new Set(scope.constraints.flatMap(({ constraint }) =>
    constraint.for_each ? normalize(constraint.for_each.population_role).split(' ') : []));
  const orderedObservations = scope.constraints.some(({ constraint }) =>
    constraint.for_each && constraint.proposition_template?.operator === 'reference:precedes');
  const ranked = scope.exclusions.map((exclusion, index) => {
    const exclusionTerms = normalize(exclusion).split(' ');

    const structural = orderedObservations && exclusionTerms.includes('between') &&
      exclusionTerms.some(term => iteratedTerms.has(term));
    return { exclusion, index, structural,
      count: queryTerms.filter(term => exclusionTerms.includes(term)).length };
  }).sort((a, b) => Number(b.structural) - Number(a.structural) || b.count - a.count || a.index - b.index);

  return ranked[0] && (ranked[0].structural || ranked[0].count > 0) ? `Excluded: ${words(ranked[0].exclusion)}.` : null;
}
