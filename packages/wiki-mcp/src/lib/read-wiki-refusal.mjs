

export function readWikiRefusal(code, facts, nextCalls = []) {
  const { subject, unit, cause, message, effects, recovery, next_calls: _nested, ...details } = facts;
  return Object.assign(new Error(typeof cause === 'string' ? cause : message ?? code), {
    code,
    envelope: { schema_version: 'workspace-read-wiki-refusal.v1', accepted: false, code,
      ...(subject === undefined && unit === undefined ? {} : { subject: subject ?? unit }),
      cause: typeof cause === 'object' && cause !== null ? cause
        : { code: facts.code ?? code, message: cause ?? message ?? code },
      ...(Object.keys(details).length ? { details } : {}),
      effects: effects ?? { writes: [] }, next_calls: nextCalls,
      recovery: recovery ?? { state: nextCalls.length ? 'choice' : facts.choice || facts.selection_context ? 'caller_choice' : 'no_supported_route',
        ...(nextCalls.length || facts.choice || facts.selection_context ? {} : {
          reason: 'No supported correction is known for this selection; choose a granted source or report the stated missing capability.' }) }
    }
  });
}
