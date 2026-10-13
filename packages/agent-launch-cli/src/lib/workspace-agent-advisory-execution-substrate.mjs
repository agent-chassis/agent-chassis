import { prepareCompiledValidatorCache } from "@agent-chassis/controlled-contract/validator-cache";
import { consumeAdvisoryReviewInput } from "./workspace-agent-advisory-review-contract.mjs";
import { standaloneValidatorCacheBinds } from "./workspace-agent-validator-cache-binds.mjs";

const preparations = new WeakMap();
const prepared = new WeakMap();

function authenticate(input) {
  try {
    return consumeAdvisoryReviewInput(input, { role: input?.role, subject: input?.subject });
  } catch (cause) {
    throw Object.assign(new TypeError("advisory execution substrate requires launcher-owned input", { cause }),
      { code: "advisory_execution_substrate_input_invalid" });
  }
}

export function prepareAdvisoryExecutionSubstrate(input) {
  authenticate(input);
  if (preparations.has(input)) return preparations.get(input);
  const preparation = (async () => {
    const ensured = await prepareCompiledValidatorCache({ mode: "ensure" });
    const verified = await prepareCompiledValidatorCache({ mode: "verify" });
    const cacheBinds = standaloneValidatorCacheBinds({ ensured, verified,
      workspaceDir: input.private_checkout_root });
    const facts = Object.freeze({ read_only_binds: Object.freeze([...cacheBinds]) });
    prepared.set(input, { ensured, verified, facts });
    return facts;
  })();
  preparations.set(input, preparation);
  return preparation;
}

export function consumeAdvisoryExecutionSubstrate(input) {
  authenticate(input);
  const preparation = prepared.get(input);
  if (preparation === undefined) {
    throw Object.assign(new Error("advisory execution substrate has not been prepared"),
      { code: "advisory_execution_substrate_unprepared" });
  }
  const { ensured, verified, facts } = preparation;

  standaloneValidatorCacheBinds({ ensured, verified, workspaceDir: input.private_checkout_root });
  return facts;
}
