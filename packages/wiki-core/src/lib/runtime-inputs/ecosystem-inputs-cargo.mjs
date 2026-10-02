

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export const CARGO_OFFLINE_ENV = Object.freeze({ CARGO_NET_OFFLINE: "true", CARGO_TERM_COLOR: "never" });

const absoluteOrNull = (value) => typeof value === "string" && path.isAbsolute(value) ? value : null;

export function cargoHomeFromEnvironment(env) {
  return absoluteOrNull(env.CARGO_HOME) ?? path.join(absoluteOrNull(env.HOME) ?? os.homedir(), ".cargo");
}

export function cargoToolchainEnv(rustc) {
  return { RUSTC: rustc, RUSTDOC: path.join(path.dirname(rustc), "rustdoc") };
}

export function cargoConfigFiles(projectDir, cargoHome) {
  const files = [];
  const home = ["config", "config.toml"].map((name) => path.join(cargoHome, name)).find(existsSync);
  for (let directory = projectDir; ; directory = path.dirname(directory)) {
    const found = ["config", "config.toml"].map((name) => path.join(directory, ".cargo", name)).find(existsSync);
    if (found !== undefined) files.push({ file: found, base: directory, scope: found === home ? "cargo_home"
      : directory === projectDir ? "project" : "ancestor" });
    if (path.dirname(directory) === directory) break;
  }
  if (home !== undefined && !files.some(({ file }) => file === home)) {
    files.push({ file: home, base: path.dirname(cargoHome), scope: "cargo_home" });
  }
  return files;
}
