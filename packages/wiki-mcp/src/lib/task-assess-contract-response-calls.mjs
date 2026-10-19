

const OWN = 'workspace_assess_contract';

async function check(call, contracts) {
  if (call.tool === OWN) return { call };
  const consumer = contracts?.contractFor(call.tool);
  if (consumer == null) return { unavailable: { code: 'assessment_consumer_unavailable', subject: call.tool,
    cause: 'This server has no registered receiving contract for the offered correction or detail.' } };
  if (call.executable === false) return { call };
  try {
    if (await consumer.acceptsArguments(call.arguments) === true) return { call };
    return { unavailable: { code: 'assessment_consumer_request_rejected', subject: call.tool,
      cause: 'The receiving registration does not accept this correction or detail request.' } };
  } catch (error) {
    return { unavailable: { code: 'assessment_consumer_validation_failed', subject: call.tool,
      cause: { code: error.code ?? null, message: error.message } } };
  }
}

async function recoveryCalls(value, contracts) {
  if (Array.isArray(value)) return Promise.all(value.map(member => recoveryCalls(member, contracts)));
  if (value == null || typeof value !== 'object') return value;
  if (typeof value.tool === 'string' && (value.arguments !== undefined || value.executable === false)) {
    const result = await check(value, contracts);
    return result.call ?? { unavailable: result.unavailable };
  }
  return Object.fromEntries(await Promise.all(Object.entries(value)
    .map(async ([key, member]) => [key, await recoveryCalls(member, contracts)])));
}

async function serveCorrection(value, contracts) {
  const checked = await Promise.all(value.next_calls.map(call => check(call, contracts)));
  const missing = checked.filter(result => result.unavailable).map(result => result.unavailable);
  const contextMissing = checked.some((result, index) => result.unavailable
    && value.next_calls[index].purpose === 'current_correction_context');
  const { next_calls: _next, recovery, save_guidance: save, ...meaning } = value;
  return { ...meaning,
    ...(contextMissing ? { recovery: { ...missing[0], stop: 'This server supplies no usable current correction context; no save is offered.' } }
      : { ...(recovery === undefined ? {} : { recovery: await recoveryCalls(recovery, contracts) }),
        ...(save === undefined ? {} : { save_guidance: save }) }),
    ...(missing.length && !contextMissing ? { unavailable_detail: missing } : {}),
    next_calls: checked.flatMap(result => result.call ? [result.call] : []) };
}

export async function serveContractAssessmentResponse(body, contracts) {
  if (body.selected_diagnosis !== undefined) {
    const selected = await serveCorrection({ ...body.selected_diagnosis, next_calls: body.next_calls }, contracts);
    const { next_calls, ...selected_diagnosis } = selected;
    return { ...body, selected_diagnosis, next_calls };
  }
  return { ...body, ...(body.gaps === undefined ? {} : {
    gaps: await Promise.all(body.gaps.map(gap => serveCorrection(gap, contracts))) }) };
}
