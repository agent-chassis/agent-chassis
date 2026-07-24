

export function resolveFamilyExecutorRole({ role, validateRole, roleMap } = {}) {
  if (typeof validateRole !== "function") {
    throw new TypeError("resolveFamilyExecutorRole requires a validateRole function");
  }
  const check = validateRole(role);
  if (!check || check.ok !== true) {
    return {
      ok: false,
      kind: check?.kind ?? null,
      allowed: check?.allowed ?? null,
      role: role ?? null
    };
  }
  const canonicalRole = check.role;
  const table = roleMap && typeof roleMap === "object" ? roleMap : {};
  const familyRole = Object.prototype.hasOwnProperty.call(table, canonicalRole)
    ? table[canonicalRole]
    : null;
  return { ok: true, role: canonicalRole, familyRole };
}

function noFamilyModelSupport() {
  return false;
}

export function evaluateFamilyModelDisposition({
  model,
  normalizeModelHint,
  isModelSupported = noFamilyModelSupport
} = {}) {
  const normalize = typeof normalizeModelHint === "function"
    ? normalizeModelHint
    : (value) => (typeof value === "string" && value.length > 0 ? value : null);
  const hint = normalize(model);
  if (hint === null || hint === undefined) {
    return { disposition: "absent", model: null };
  }
  const supported = typeof isModelSupported === "function"
    ? isModelSupported(hint) === true
    : false;
  return supported
    ? { disposition: "honor", model: hint }
    : { disposition: "refuse", model: hint };
}

const DEFAULT_TRANSPORT_SECRET_PLACEHOLDER = "[redacted]";

function escapeRegExpLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactFamilyTransportSecrets({
  text,
  env = {},
  secretEnvVars = [],
  placeholder = DEFAULT_TRANSPORT_SECRET_PLACEHOLDER
} = {}) {
  if (typeof text !== "string" || text.length === 0) return text;
  const names = Array.isArray(secretEnvVars) ? secretEnvVars : [];
  const envObj = env && typeof env === "object" ? env : {};
  let out = text;
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0) continue;
    out = out.replace(
      new RegExp(`${escapeRegExpLiteral(name)}=\\S+`, "g"),
      `${name}=${placeholder}`
    );
    const value = envObj[name];
    if (typeof value === "string" && value.length > 0) {
      out = out.split(value).join(placeholder);
    }
  }
  return out;
}
