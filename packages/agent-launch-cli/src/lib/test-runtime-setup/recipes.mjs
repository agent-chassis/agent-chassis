

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { TOOLCHAIN_DESCRIPTIONS } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/toolchain-descriptions.mjs";

export function currentPlatformKey({ platform = process.platform, arch = process.arch } = {}) {
  return `${platform}-${arch}`;
}

function firstLine(file) {
  return readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? null;
}

const PIN_READERS = Object.freeze({
  node: Object.freeze([
    Object.freeze({ file: ".nvmrc", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null }),
    Object.freeze({ file: ".node-version", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null })
  ]),
  python: Object.freeze([
    Object.freeze({ file: ".python-version", read: (file) => firstLine(file) })
  ]),
  go: Object.freeze([

    Object.freeze({ file: "go.mod", read: (file) =>
      /^toolchain\s+go(\d+\.\d+\.\d+)\s*$/mu.exec(readFileSync(file, "utf8"))?.[1] ?? null })
  ]),
  rust: Object.freeze([
    Object.freeze({ file: "rust-toolchain.toml", read: (file) =>
      /^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/mu.exec(readFileSync(file, "utf8"))?.[1] ?? null }),
    Object.freeze({ file: "rust-toolchain", read: (file) => firstLine(file) })
  ]),
  deno: Object.freeze([
    Object.freeze({ file: ".dvmrc", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null })
  ])
});

export const TOOLCHAIN_RECIPES = Object.freeze(Object.fromEntries(
  Object.entries(TOOLCHAIN_DESCRIPTIONS).map(([name, description]) => {
    const { name: describedName, probe, ...facts } = description;
    return [name, Object.freeze({
      name: describedName, pins: PIN_READERS[name], ...facts,
      ...(name === "rust" ? { native_prerequisites: Object.freeze(["cc"]) } : {}),
      probe
    })];
  })
));

export const TOOLCHAIN_NAMES = Object.freeze(Object.keys(TOOLCHAIN_RECIPES));

const VERSION_REQUIREMENT = /^\d+(?:\.\d+){0,2}$/u;

export function isVersionRequirement(value) {
  return typeof value === "string" && VERSION_REQUIREMENT.test(value);
}

export function versionSatisfies(requirement, version) {
  return version === requirement || (typeof version === "string" && version.startsWith(`${requirement}.`));
}

export function readProjectToolchainPins(recipe, projectDir) {
  const pins = [];
  for (const pin of recipe.pins) {
    const file = path.join(projectDir, pin.file);
    if (!existsSync(file)) continue;
    const version = pin.read(file);
    if (version !== null) pins.push(Object.freeze({ file: pin.file, version }));
  }
  return pins;
}
