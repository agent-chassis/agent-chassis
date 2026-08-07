

export function lexModule(source) {
  const literals = [];
  let code = "", i = 0;
  while (i < source.length) {
    const c = source[i], d = source[i + 1];
    if (c === "/" && d === "/") { while (i < source.length && source[i] !== "\n") i += 1; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c !== '"' && c !== "'" && c !== "`") { code += c; i += 1; continue; }
    let j = i + 1, value = "", plain = true;
    for (; j < source.length && source[j] !== c; j += 1) {
      if (source[j] === "\\") { value += source[j + 1]; j += 1; continue; }
      if (c === "`" && source[j] === "$" && source[j + 1] === "{") plain = false;
      value += source[j];
    }
    code += ` @${literals.length} `;
    literals.push(plain ? value : null);
    i = j + 1;
  }
  return { code, literals };
}

export function callArguments(code, open) {
  const args = [];
  let depth = 0, current = "";
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") { depth += 1; if (depth === 1) continue; }
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) { args.push(current); return args; }
    } else if (c === "," && depth === 1) { args.push(current); current = ""; continue; }
    current += c;
  }
  return args;
}

export function executableAssertOidLabels(source) {
  const { code, literals } = lexModule(source);
  const labels = [];
  for (const match of code.matchAll(/\bassertOid\s*\(/gu)) {
    if (code.slice(0, match.index).endsWith("function ")) continue;
    const args = callArguments(code, code.indexOf("(", match.index));
    const token = /^\s*@(\d+)\s*$/u.exec(args[1] ?? "");
    if (token === null) return { error: "assertOid call site without a literal label" };
    const value = literals[Number(token[1])];
    if (typeof value !== "string") return { error: "assertOid label is an interpolated template" };
    labels.push(value);
  }
  return { labels };
}

const REFUSAL_LITERAL_PATTERNS = Object.freeze([
  /\bfail\(\s*[A-Za-z_.$0-9[\]"]+,\s*\n?\s*"((?:[^"\\]|\\.)*)"/gu,
  /\brefuseIndexState\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/gu,
  /\bmessage:\s*"((?:[^"\\]|\\.)*)"/gu
]);

export function mintedRefusalLiterals(body) {
  const minted = new Set();
  for (const pattern of REFUSAL_LITERAL_PATTERNS) {
    for (const match of body.matchAll(pattern)) minted.add(match[1]);
  }
  return minted;
}

export function functionSource(code, name) {
  const start = code.indexOf(`function ${name}`);
  if (start < 0) return null;
  const end = code.indexOf("\nfunction ", start + 1);
  return code.slice(start, end < 0 ? code.length : end);
}

export const OID_SUFFIX = " is not a canonical Git object id";

export const oidFamily = (allowedPredicates) => allowedPredicates
  .filter((reason) => reason.endsWith(OID_SUFFIX))
  .map((reason) => reason.slice(0, -OID_SUFFIX.length));

export function compareOidVocabulary(source, allowedPredicates) {
  const { labels, error } = executableAssertOidLabels(source);
  if (error) return error;
  if (labels.length === 0) return "no executable assertOid call site was extracted";
  if (new Set(labels).size !== labels.length) return "duplicate executable assertOid label";
  const family = oidFamily(allowedPredicates);
  if (new Set(family).size !== family.length) return "duplicate OID predicate in the allowlist";
  const missing = labels.filter((label) => !family.includes(label));
  if (missing.length) return `unallowlisted executable assertOid label: ${missing.join(", ")}`;
  const stale = family.filter((label) => !labels.includes(label));
  if (stale.length) return `OID predicate with no executable call site: ${stale.join(", ")}`;
  return null;
}
