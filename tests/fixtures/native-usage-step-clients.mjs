

export const agyId = "00000000-0000-0000-0000-000000000001";
export const openCodeId = "ses_fixture";
export const agyUsage = (n = 1) => ({ input_tokens: 100 * n, cache_read_tokens: 40 * n,
  output_tokens: 20 * n, thinking_tokens: 5 * n, total_tokens: 120 * n });
export const agyInit = (id = agyId) => ({ event: "init", conversation_id: id });
export const agyStep = (index, usage = agyUsage(), id = agyId) => ({ event: "step_update", step_update: {
  conversation_id: id, step_index: index, step_type: "agent_response", state: "DONE", usage } });
export const agyResult = (usage = agyUsage(), status = "SUCCESS", id = agyId) => ({ event: "result", result: {
  conversation_id: id, status, response: "done", usage } });
export function openCodeStep(index, { tokens = { input: 100, output: 15, reasoning: 5, cache: { read: 40, write: 7 } },
  cost = 0.125, reason = "stop", id = openCodeId } = {}) {
  return { type: "step_finish", sessionID: id, part: { id: `prt_${index}`, messageID: `msg_${index}`,
    sessionID: id, type: "step-finish", reason, tokens, cost } };
}
export const jsonl = events => Buffer.from(events.map(event => JSON.stringify(event)).join("\n") + "\n");
