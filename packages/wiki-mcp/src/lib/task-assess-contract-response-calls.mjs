

import { isDeepStrictEqual } from 'node:util';

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
  if (body.selected_diagnoses !== undefined) {
    const checked = await Promise.all(body.next_calls.map(call => check(call, contracts)));
    const missing = checked.flatMap((result, index) => result.unavailable ? [{
      ...result.unavailable, call: body.next_calls[index] }] : []);
    const selected_diagnoses = await Promise.all(body.selected_diagnoses.map(async entry => {
      if (entry.failure !== undefined) return entry;
      const unit = entry.save_guidance?.unit ?? entry.recovery?.then?.known_arguments?.unit;
      const members = entry.save_guidance === undefined ? Object.keys(entry.recovery?.then?.known_arguments?.changes ?? {})
        : body.correction_contexts[unit].changes_schema_from.select.input_contract.members;
      const contextMissing = missing.find(failure => failure.call.purpose === 'current_correction_context' &&
        failure.call.arguments.reads?.some(read => read.subject === unit && isDeepStrictEqual(read.for_changes, members)));
      const { recovery, save_guidance, ...meaning } = entry;
      if (contextMissing) {
        const { call: _call, ...cause } = contextMissing;
        return { ...meaning, recovery: { ...cause,
          stop: 'This server supplies no usable current correction context; no save is offered.' } };
      }
      if (recovery?.status === 'awaiting_obligation_choice' &&
          !checked.some(result => result.call?.purpose === 'choose_obligation_owner')) {
        const { call: _call, ...cause } = missing.find(failure => failure.call.purpose === 'choose_obligation_owner');
        return { ...meaning, recovery: { ...cause,
          stop: 'No registered reader accepts an offered obligation-owner correction context; no association save is available.' } };
      }
      return { ...meaning, ...(recovery === undefined ? {} : { recovery: await recoveryCalls(recovery, contracts) }),
        ...(save_guidance === undefined ? {} : { save_guidance }) };
    }));
    const { correction_contexts: contexts, ...answer } = body;
    const used = Object.fromEntries(Object.entries(contexts ?? {}).filter(([unit]) =>
      selected_diagnoses.some(entry => entry.save_guidance?.unit === unit)));
    return { ...answer, selected_diagnoses, ...(Object.keys(used).length ? { correction_contexts: used } : {}),
      ...(missing.some(failure => failure.call.purpose !== 'current_correction_context') ? {
        unavailable_detail: missing.filter(failure => failure.call.purpose !== 'current_correction_context')
          .map(({ call: _call, ...failure }) => failure) } : {}),
      next_calls: checked.flatMap(result => result.call ? [result.call] : []) };
  }
  return { ...body, ...(body.gaps === undefined ? {} : {
    gaps: await Promise.all(body.gaps.map(gap => serveCorrection(gap, contracts))) }) };
}
