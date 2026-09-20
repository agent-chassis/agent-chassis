import { canonicalDigest, compareCodeUnits, deepFreeze } from './deterministic-projection-primitives.mjs';

export const PROOF_AUTHORING_DIAGNOSTIC_GROUPS_VERSION = 'proof-authoring-diagnostic-groups.v2';

const clone = value => structuredClone(value);
const sortedUnique = values => [...new Set(values)].sort(compareCodeUnits);

function diagnosticProblem(diagnostic) {
  if (diagnostic.problem?.category && diagnostic.problem?.cause) return clone(diagnostic.problem);
  const { path: ignoredPath, ...ownerFacts } = diagnostic;
  return {
    category: 'unclassified',
    severity: diagnostic.severity ?? 'unspecified',
    cause: { kind: 'owner_diagnostic', owner_facts: ownerFacts }
  };
}

function routeAssessment(diagnostic) {
  return clone(diagnostic.problem?.route_assessment ?? {
    schema_version: 'selected-proof-diagnostic-route-assessment.v1',
    effect: 'unresolved', stage: 'unclassified', selected_route: 'unknown',
    owner_code: diagnostic.code ?? 'owner_diagnostic',
    reason: 'The diagnostic owner did not assess this occurrence against a selected route.',
    unavailable_operation: null,
    responsible_owner: diagnostic.owner ?? null,
    recovery: null
  });
}

function diagnosticKey({ diagnostic, definition }) {
  const problem = diagnosticProblem(diagnostic);
  return canonicalDigest({
    version: PROOF_AUTHORING_DIAGNOSTIC_GROUPS_VERSION,
    owner: diagnostic.owner ?? null,
    code: diagnostic.code ?? null,
    severity: problem.severity ?? diagnostic.severity ?? 'unspecified',
    meaning: diagnostic.reason ?? null,
    cause: problem.cause,
    route_assessment: routeAssessment(diagnostic),
    ...(problem.definition_sensitive === true ? { definition: definition ?? null } : {})
  });
}

export function groupProofAuthoringDiagnostics(resolved) {
  if (!resolved || typeof resolved.identity_digest !== 'string' ||
      !Array.isArray(resolved.diagnostics) || !Array.isArray(resolved.rows)) {
    throw new TypeError('Resolved proof authoring diagnostics are required');
  }
  const occurrences = [
    ...resolved.diagnostics.map(diagnostic => ({ obligation_id: null, definition: null, diagnostic })),
    ...resolved.rows.flatMap(row => row.diagnostics.map(diagnostic => ({
      obligation_id: row.obligation_id,
      definition: row.definition ?? null,
      diagnostic
    })))
  ].map((entry, occurrenceIndex) => {
    const problem = diagnosticProblem(entry.diagnostic);
    const assessedRoute = routeAssessment(entry.diagnostic);
    return {
      occurrence_index: occurrenceIndex,
      obligation_id: entry.obligation_id,
      semantic_key: diagnosticKey(entry),
      category: problem.category,
      route_effect: assessedRoute.effect,
      route_assessment: assessedRoute,
      severity: problem.severity ?? entry.diagnostic.severity ?? 'unspecified',
      diagnostic: clone(entry.diagnostic)
    };
  });

  const grouped = new Map();
  for (const occurrence of occurrences) {
    let group = grouped.get(occurrence.semantic_key);
    if (!group) {
      group = {
        semantic_key: occurrence.semantic_key,
        category: occurrence.category,
        owner: occurrence.diagnostic.owner ?? null,
        code: occurrence.diagnostic.code ?? null,
        severity: occurrence.severity,
        actionable_meaning: occurrence.route_assessment.reason,
        route_effect: occurrence.route_effect,
        route_assessment: occurrence.route_assessment,
        occurrences: []
      };
      grouped.set(occurrence.semantic_key, group);
    }
    group.occurrences.push(occurrence);
  }

  const groups = [...grouped.values()].sort((a, b) => compareCodeUnits(a.semantic_key, b.semantic_key)).map(group => {
    const affected = sortedUnique(group.occurrences.flatMap(entry =>
      entry.obligation_id === null ? [] : [entry.obligation_id]));
    const globalCount = group.occurrences.filter(entry => entry.obligation_id === null).length;
    return {
      ...group,
      occurrence_count: group.occurrences.length,
      affected_obligation_count: affected.length,
      global_occurrence_count: globalCount,
      affected_obligation_ids: affected
    };
  });

  const categoryNames = sortedUnique(groups.map(group => group.category));
  const categories = categoryNames.map(category => {
    const members = groups.filter(group => group.category === category);
    const withEffect = effect => members.filter(group => group.route_effect === effect);
    const effectCount = (effect, field) => withEffect(effect).reduce((total, group) =>
      total + (field === 'groups' ? 1 : group.occurrence_count), 0);
    return {
      category,
      group_count: members.length,
      occurrence_count: members.reduce((total, group) => total + group.occurrence_count, 0),
      affected_obligation_count: sortedUnique(members.flatMap(group => group.affected_obligation_ids)).length,
      global_occurrence_count: members.reduce((total, group) => total + group.global_occurrence_count, 0),
      blocking_group_count: effectCount('blocking', 'groups'),
      blocking_occurrence_count: effectCount('blocking', 'occurrences'),
      nonblocking_group_count: effectCount('nonblocking', 'groups'),
      nonblocking_occurrence_count: effectCount('nonblocking', 'occurrences'),
      unresolved_group_count: effectCount('unresolved', 'groups'),
      unresolved_occurrence_count: effectCount('unresolved', 'occurrences')
    };
  });
  const byEffect = effect => occurrences.filter(entry => entry.route_effect === effect);
  return deepFreeze({
    version: PROOF_AUTHORING_DIAGNOSTIC_GROUPS_VERSION,
    identity_digest: resolved.identity_digest,
    counts: {
      diagnostic_occurrences: occurrences.length,
      diagnostic_groups: groups.length,
      affected_obligations: sortedUnique(occurrences.flatMap(entry =>
        entry.obligation_id === null ? [] : [entry.obligation_id])).length,
      global_occurrences: occurrences.filter(entry => entry.obligation_id === null).length,
      blocking_occurrences: byEffect('blocking').length,
      blocking_affected_obligations: sortedUnique(byEffect('blocking').flatMap(entry =>
        entry.obligation_id === null ? [] : [entry.obligation_id])).length,
      nonblocking_occurrences: byEffect('nonblocking').length,
      nonblocking_affected_obligations: sortedUnique(byEffect('nonblocking').flatMap(entry =>
        entry.obligation_id === null ? [] : [entry.obligation_id])).length,
      unresolved_occurrences: byEffect('unresolved').length,
      unresolved_affected_obligations: sortedUnique(byEffect('unresolved').flatMap(entry =>
        entry.obligation_id === null ? [] : [entry.obligation_id])).length
    },
    categories,
    groups
  });
}

export const PROOF_AUTHORING_SHARED_CONSTRAINTS_VERSION =
  'proof-authoring-shared-constraints.v1';

const RESTATED_CAUSE_MEMBERS = Object.freeze(['source_policy', 'refinements', 'assessment']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function* constraintSites(cause) {
  if (isRecord(cause.source_policy)) yield { hold: cause, key: 'source_policy' };
  if (Array.isArray(cause.refinements)) {
    for (const refinement of cause.refinements) {
      if (isRecord(refinement) && isRecord(refinement.value)) yield { hold: refinement, key: 'value' };
    }
  }
  if (isRecord(cause.assessment) && isRecord(cause.assessment.role)) {
    yield { hold: cause.assessment, key: 'role' };
  }

  if (isRecord(cause.problem?.cause)) yield { hold: cause.problem, key: 'cause' };
}

const siteValue = site => site.hold[site.key];

export function shareRepeatedProofConstraints(causes) {
  if (!Array.isArray(causes)) throw new TypeError('refusal causes must be an array');
  const projected = causes.map(cause => clone(cause));

  for (const cause of projected) {
    const problemCause = cause.problem?.cause;
    if (!isRecord(problemCause)) continue;
    const restated = RESTATED_CAUSE_MEMBERS.filter(member =>
      Object.hasOwn(problemCause, member) && Object.hasOwn(cause, member) &&
      canonicalDigest(problemCause[member]) === canonicalDigest(cause[member]));
    if (restated.length === 0) continue;
    for (const member of restated) delete problemCause[member];
    problemCause.restates_cause_members = restated;
  }

  const counts = new Map();
  for (const cause of projected) {
    for (const site of constraintSites(cause)) {
      const digest = canonicalDigest(siteValue(site));
      const entry = counts.get(digest);
      if (entry === undefined) counts.set(digest, { digest, value: clone(siteValue(site)), count: 1 });
      else entry.count += 1;
    }
  }
  const shared = [...counts.values()].filter(entry => entry.count > 1)
    .sort((a, b) => compareCodeUnits(a.digest, b.digest))
    .map((entry, index) => ({
      constraint_id: `constraint-${index + 1}`,
      digest: entry.digest,
      occurrence_count: entry.count,
      value: entry.value
    }));
  const idByDigest = new Map(shared.map(entry => [entry.digest, entry.constraint_id]));
  if (idByDigest.size === 0) return deepFreeze({ shared_constraints: [], causes: projected });

  for (const cause of projected) {
    for (const site of constraintSites(cause)) {
      const constraintId = idByDigest.get(canonicalDigest(siteValue(site)));
      if (constraintId !== undefined) site.hold[site.key] = { constraint: constraintId };
    }
  }
  return deepFreeze({ shared_constraints: shared, causes: projected });
}
