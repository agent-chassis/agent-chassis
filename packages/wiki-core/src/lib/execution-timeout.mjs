

export const EXECUTION_TIMEOUT_PRESET_SECONDS = Object.freeze({ short: 30, medium: 300, long: 1800 });
export const EXECUTION_DEFAULT_TIMEOUT = "medium";
export const EXECUTION_TIMEOUT_MAX_SECONDS = 2147483;

export function executionTimeoutRefusalFacts() {
  return { accepted_presets: { ...EXECUTION_TIMEOUT_PRESET_SECONDS },
    maximum_seconds: EXECUTION_TIMEOUT_MAX_SECONDS };
}

export const EXECUTION_TIMEOUT_INVALID_MESSAGE =
  "timeout must be short, medium, long, or a closed { seconds } object with an integer from 1 to 2147483";

export function parseExecutionTimeout(value, refusal) {
  if (typeof refusal !== "function") {
    throw new TypeError("parseExecutionTimeout requires the calling route's refusal factory");
  }
  const accepted = (kind, label, seconds) => Object.freeze({ kind, label, seconds,
    milliseconds: seconds * 1000 });
  if (value === undefined) return accepted("preset", EXECUTION_DEFAULT_TIMEOUT,
    EXECUTION_TIMEOUT_PRESET_SECONDS[EXECUTION_DEFAULT_TIMEOUT]);
  if (typeof value === "string" && Object.hasOwn(EXECUTION_TIMEOUT_PRESET_SECONDS, value)) {
    return accepted("preset", value, EXECUTION_TIMEOUT_PRESET_SECONDS[value]);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === 1 && Object.hasOwn(value, "seconds") &&
      Number.isSafeInteger(value.seconds) && value.seconds >= 1 &&
      value.seconds <= EXECUTION_TIMEOUT_MAX_SECONDS) {
    return accepted("custom", null, value.seconds);
  }
  throw refusal(EXECUTION_TIMEOUT_INVALID_MESSAGE, executionTimeoutRefusalFacts());
}

export function executionTimeoutInputSchema(z, description) {
  return z.union([
    z.enum(Object.keys(EXECUTION_TIMEOUT_PRESET_SECONDS)),
    z.object({ seconds: z.number().int().min(1).max(EXECUTION_TIMEOUT_MAX_SECONDS) }).strict()
  ]).optional().describe(description);
}
