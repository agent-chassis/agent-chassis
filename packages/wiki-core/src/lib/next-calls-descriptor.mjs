

export const NEXT_CALLS_DESCRIPTOR_VERSION = "next-calls-descriptor.v1";

export function buildNextCall(spec = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("buildNextCall requires an entry spec object");
  }
  const { tool, arguments: callArguments, recommended, disallowed, ...payload } = spec;
  if (typeof tool !== "string" || tool.trim() === "") {
    throw new TypeError("buildNextCall requires a non-empty string `tool`");
  }
  if (recommended !== undefined && typeof recommended !== "boolean") {
    throw new TypeError("buildNextCall `recommended` must be a boolean when provided");
  }
  if (disallowed !== undefined && typeof disallowed !== "boolean") {
    throw new TypeError("buildNextCall `disallowed` must be a boolean when provided");
  }
  if (recommended === true && disallowed === true) {
    throw new TypeError(
      "a recommended next-call cannot also be disallowed (recommended must be an allowed member)"
    );
  }
  if (
    callArguments !== undefined &&
    callArguments !== null &&
    (typeof callArguments !== "object" || Array.isArray(callArguments))
  ) {
    throw new TypeError("buildNextCall `arguments` must be a plain object when provided");
  }
  const entry = { tool, ...payload };
  if (callArguments !== undefined && callArguments !== null) {
    entry.arguments = { ...callArguments };
  }
  if (recommended === true) entry.recommended = true;
  if (disallowed === true) entry.disallowed = true;
  return entry;
}

export function renderNextCall(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const callArguments = entry.arguments;
  if (
    callArguments &&
    typeof callArguments === "object" &&
    !Array.isArray(callArguments) &&
    Object.keys(callArguments).length > 0
  ) {
    const body = Object.entries(callArguments)
      .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
      .join(", ");
    return `${entry.tool}({${body}})`;
  }
  return entry.tool;
}

function toolRegistrationPredicate(knownTools) {
  if (knownTools === null || knownTools === undefined) {
    return null;
  }
  if (typeof knownTools === "function") {
    return knownTools;
  }
  if (knownTools instanceof Set) {
    return (tool) => knownTools.has(tool);
  }
  if (Array.isArray(knownTools)) {
    const set = new Set(knownTools);
    return (tool) => set.has(tool);
  }
  throw new TypeError("validateNextCalls knownTools must be an array, Set, or predicate");
}

export function validateNextCalls(list, { knownTools = null } = {}) {
  if (!Array.isArray(list)) {
    return { valid: false, errors: ["next-calls list must be an array"] };
  }
  const isRegisteredTool = toolRegistrationPredicate(knownTools);
  const errors = [];
  list.forEach((entry, index) => {
    const where = `entry[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (typeof entry.tool !== "string" || entry.tool.trim() === "") {
      errors.push(`${where} must have a non-empty string tool`);
    }
    if (entry.recommended !== undefined && typeof entry.recommended !== "boolean") {
      errors.push(`${where}.recommended must be a boolean when present`);
    }
    if (entry.disallowed !== undefined && typeof entry.disallowed !== "boolean") {
      errors.push(`${where}.disallowed must be a boolean when present`);
    }
    if (entry.recommended === true && entry.disallowed === true) {
      errors.push(
        `${where} is flagged both recommended and disallowed; a recommended entry must be an allowed subset member`
      );
    }
    if (
      entry.arguments !== undefined &&
      entry.arguments !== null &&
      (typeof entry.arguments !== "object" || Array.isArray(entry.arguments))
    ) {
      errors.push(`${where}.arguments must be a plain object when present`);
    }
    if (isRegisteredTool && typeof entry.tool === "string" && !isRegisteredTool(entry.tool)) {
      errors.push(`${where} references unregistered tool "${entry.tool}"`);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function pickDoThisNext(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  return list.find((entry) => entry && typeof entry === "object" && entry.recommended === true) ?? null;
}

export function projectNextActionScalar(list) {
  const doThisNext = pickDoThisNext(list);
  return doThisNext ? renderNextCall(doThisNext) : null;
}
