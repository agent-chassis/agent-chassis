
export async function admitResultContinuations(body, requestContracts) {
  const limitations = [];
  async function admitted(call) {
    const contract = requestContracts?.contractFor?.(call.tool);
    if (contract && await contract.acceptsArguments(call.arguments) === true) return true;
    limitations.push({ tool: call.tool, code: contract ? "result_continuation_arguments_unavailable"
      : "result_continuation_not_served" });
    return false;
  }
  const next_calls = [];
  for (const call of body.next_calls ?? []) if (await admitted(call)) next_calls.push(call);
  const result = { ...body, next_calls };
  if (body.attempt_choices !== undefined) {
    result.attempt_choices = [];
    for (const choice of body.attempt_choices) {
      if (choice.call === undefined) { result.attempt_choices.push(choice); continue; }
      if (await admitted(choice.call)) result.attempt_choices.push(choice);
      else { const { call: _call, ...facts } = choice; result.attempt_choices.push(facts); }
    }
  }
  if (body.proof_verification?.detail_call !== undefined && !await admitted(body.proof_verification.detail_call)) {
    const { detail_call: _call, ...facts } = body.proof_verification;
    result.proof_verification = facts;
  }
  if (body.delivery?.choices !== undefined) {
    const choices = [];
    for (const choice of body.delivery.choices) {
      if (choice.call === undefined) { choices.push(choice); continue; }
      if (await admitted(choice.call)) choices.push(choice);
      else { const { call: _call, ...facts } = choice; choices.push(facts); }
    }
    result.delivery = { ...body.delivery, choices };
  }
  if (limitations.length > 0) result.continuation_limitations = [...new Map(limitations
    .map(value => [`${value.tool}:${value.code}`, value])).values()];
  return result;
}
