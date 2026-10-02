

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
