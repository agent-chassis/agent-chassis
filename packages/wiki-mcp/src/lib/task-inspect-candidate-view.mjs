

const EFFECTS = Object.freeze({ observation_only: true });

function causeLevels(level) {
  const facts = level.properties ?? level;
  const result = Object.fromEntries(['name', 'code', 'message', 'value', 'errno', 'syscall', 'path',
    'operation', 'reason', 'condition', 'expected_id', 'observed_id', 'initiative']
    .filter(key => Object.hasOwn(facts, key)).map(key => [key, facts[key]]));
  for (const key of ['name', 'message']) if (level[key] !== undefined) result[key] = level[key];
  const detail = facts.detail ?? facts.details;
  if (typeof detail?.field === 'string') result.field = detail.field;
  if (typeof detail?.condition === 'string') result.condition = detail.condition;
  if (detail?.prerequisite?.kind === 'persistent_wk_lifecycle_ref') result.ref = detail.prerequisite.ref;
  const nested = detail?.failure ?? detail?.cause ?? facts.failure;
  return [result, ...(nested != null && typeof nested === 'object' ? causeLevels(nested) : [])];
}

function diagnosis(value) {
  if (value == null) return undefined;
  const native = value.candidate_failure?.detail;
  return {
    condition: value.condition,
    ...(value.uncertainty == null ? {} : { uncertainty: value.uncertainty }),
    ...(native?.git_diagnosis === undefined ? {} : { git_diagnosis: native.git_diagnosis }),
    ...Object.fromEntries(['git_operation', 'git_status', 'git_signal', 'git_native_error', 'git_output_overflow']
      .filter(key => native?.[key] !== undefined && native[key] !== null).map(key => [key, native[key]])),
    ...(value.cause_chain?.length ? { cause_chain: value.cause_chain.flatMap(causeLevels) } : {})
  };
}

function recovery(value, historical, reobserve = false) {
  if (value == null) return undefined;
  if (historical) return {
    state: 'no_supported_route',
    prerequisite: 'The same selected immutable version must be available, readable and valid.',
    ...(reobserve ? { retry_condition: 'Use the offered inspection only after the same selected version is available, valid and no longer moving.' } : {}),
    explanation: 'Stop this historical conclusion until that exact version can be verified. Inspection offers no supported repair and substitutes no other version or current candidate.'
  };
  const { state, prerequisite, operator_action, retry_condition, explanation } = value;
  return Object.fromEntries(Object.entries({ state, prerequisite, operator_action,
    retry_condition, explanation }).filter(([, field]) => field !== undefined && field !== null));
}

export function candidateInspectionView(body) {
  const refused = body.carried !== undefined;
  const source = refused ? body.carried : body;
  const answer = {
    subject: source.subject,
    selection: source.selection,
    state: refused ? 'candidate_unavailable' : body.state,
    next_calls: [...(body.next_calls ?? [])]
  };
  let detail = null;
  if (refused || body.state === 'candidate_identity_invalid_or_moved') {
    if (body.state === 'candidate_identity_invalid_or_moved' && body.currentness?.observed_w === null) {
      answer.state = 'candidate_unavailable';
    }
    answer.code = body.code;
    answer.effects = EFFECTS;
    answer.diagnostic = diagnosis(source.diagnostic);
    answer.recovery = recovery(body.recovery, source.selection.kind === 'historical', answer.next_calls.length > 0);
  } else if (body.state === 'candidate_stale_w') {
    if (answer.next_calls.length) {
      answer.choice = 'To update the selected stale candidate to the current WK tip, explicitly choose the offered advance. It constructs and selects the updated candidate; it performs no review or publication.';
    } else {
      answer.recovery = recovery(body.recovery, false);
    }
  }
  const review = body.review_consumer;
  if (review && !['compatible', 'not_designated'].includes(review.compatibility)) {
    const comparisonFailed = body.diagnostic?.operation === 'compare_review_contract';
    answer.review_consumer = {
      compatibility: comparisonFailed ? null : review.compatibility,
      ...(review.subject == null ? {} : { subject: review.subject }),
      cause: comparisonFailed ? body.diagnostic.cause_chain[0]?.code ??
        body.diagnostic.cause_chain[0]?.name ?? body.diagnostic.condition : review.cause,
      recovery: comparisonFailed ? {
        state: 'no_supported_route',
        prerequisite: 'The review comparison must complete before compatibility can be established.',
        explanation: 'Candidate state remains as observed; no supported repair for this comparison failure was established.'
      } : {
        state: 'choice_required',
        choice: review.compatibility === 'authored_contract_divergent'
          ? 'For review use, choose the intended authored meaning and correct the differing fields. Advancing does not resolve authored differences.'
          : 'For review use, choose a valid terminal-review designation and compatible contract.'
      }
    };
    if (body.diagnostic != null) answer.diagnostic = diagnosis(body.diagnostic);
    if (review.divergence != null) detail = {
      subject: body.subject,
      selection: body.selection,
      review_subject: review.subject,
      differences: review.divergence.differences,
      next_calls: []
    };
  }
  const correction = source.automatic_correction;
  if (correction != null) answer.notice = correction.verified_outcome.observed &&
      correction.verified_outcome.state !== 'candidate_identity_invalid_or_moved'
    ? 'Inputs changed during inspection; one fresh observation established the status above.'
    : 'Inputs changed during inspection; the one fresh observation could not verify current candidate status.';
  return { answer, detail };
}
