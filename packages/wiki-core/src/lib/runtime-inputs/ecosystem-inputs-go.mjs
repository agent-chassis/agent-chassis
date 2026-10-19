

import path from "node:path";

export const GO_OFFLINE_MODULE_ENV = Object.freeze({
  GOPROXY: "off", GOFLAGS: "-mod=readonly", GOTOOLCHAIN: "local", GOTELEMETRY: "off",
  GOENV: "off", GOSUMDB: "off"
});

function parseGoModuleLines(text) {
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => {
    const [modulePath, version, dir, goMod] = line.split("\t");
    return { path: modulePath, version, dir, goMod };
  });
}

export function goModuleCachePopulation(listedText, cache, exists) {
  const within = (candidate) => typeof candidate === "string" && candidate.startsWith(`${cache}${path.sep}`);
  return [...new Set(parseGoModuleLines(listedText).flatMap(({ dir, goMod }) =>
    [within(dir) && exists(dir) ? dir : null, within(goMod) ? path.dirname(goMod) : null])
    .filter(Boolean))].sort();
}

export function goModuleCacheFromEnvironment(env) {
  const absolute = (value) => typeof value === "string" && path.isAbsolute(value) ? value : null;
  if (typeof env.GOMODCACHE === "string" && env.GOMODCACHE !== "") return absolute(env.GOMODCACHE);
  const gopath = typeof env.GOPATH === "string" && env.GOPATH !== ""
    ? absolute(env.GOPATH.split(path.delimiter)[0])
    : absolute(env.HOME) && path.join(env.HOME, "go");
  return gopath ? path.join(gopath, "pkg", "mod") : null;
}

export function parseGoQuotedDiagnostic(text) {
  if (typeof text !== "string" || text[0] !== '"' || text.at(-1) !== '"') {
    throw new SyntaxError("Go diagnostic is not a quoted string");
  }
  let json = '"';
  for (let index = 1; index < text.length - 1; index++) {
    const character = text[index];
    if (character !== "\\") { json += character; continue; }
    const escape = text[++index];
    if (escape === "a" || escape === "v") json += escape === "a" ? "\\u0007" : "\\u000b";
    else if (["x", "u", "U"].includes(escape)) {
      const count = { x: 2, u: 4, U: 8 }[escape];
      const digits = text.slice(index + 1, index + 1 + count);
      if (digits.length !== count || !/^[0-9a-f]+$/iu.test(digits)) throw new SyntaxError("invalid Go diagnostic escape");
      const point = Number.parseInt(digits, 16);
      if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new SyntaxError("invalid Go diagnostic code point");
      json += JSON.stringify(String.fromCodePoint(point)).slice(1, -1);
      index += count;
    } else if (['"', "\\", "b", "f", "n", "r", "t"].includes(escape)) json += `\\${escape}`;
    else throw new SyntaxError("invalid Go diagnostic escape");
  }
  return JSON.parse(`${json}"`);
}

function unquote(token) {
  if (token.length >= 2 && ((token[0] === "\"" && token.at(-1) === "\"") ||
      (token[0] === "`" && token.at(-1) === "`"))) {
    return token[0] === "\"" ? JSON.parse(token) : token.slice(1, -1);
  }
  return token;
}

function tokens(line) {
  return (line.replace(/\/\/.*$/u, "").match(/"(?:[^"\\]|\\.)*"|`[^`]*`|\S+/gu) ?? []).map(unquote);
}

function directives(text) {
  const result = [];
  let block = null;
  for (const raw of String(text).split("\n")) {
    const words = tokens(raw);
    if (words.length === 0) continue;
    if (block !== null) {
      if (words[0] === ")") block = null;
      else result.push([block, ...words]);
      continue;
    }
    if (words.length === 2 && words[1] === "(") {
      block = words[0];
      continue;
    }
    result.push(words);
  }
  return result;
}

function isLocalTarget(target) {
  return target.startsWith("./") || target.startsWith("../") || target === "." ||
    target === ".." || path.isAbsolute(target);
}

function replacements(parsed) {
  return parsed.filter(([verb]) => verb === "replace").flatMap((words) => {
    const arrow = words.indexOf("=>");
    if (arrow === -1 || arrow + 1 >= words.length) return [];
    const target = words[arrow + 1];
    return [{ module: words[1], target, local: isLocalTarget(target) }];
  });
}

export function parseGoModFile(text) {
  const parsed = directives(text);
  const moduleLine = parsed.find(([verb]) => verb === "module");
  return { module: moduleLine?.[1] ?? null, replacements: replacements(parsed) };
}

export function parseGoWorkFile(text) {
  const parsed = directives(text);
  return { uses: parsed.filter(([verb]) => verb === "use").map((words) => words[1]).filter(Boolean),
    replacements: replacements(parsed) };
}
