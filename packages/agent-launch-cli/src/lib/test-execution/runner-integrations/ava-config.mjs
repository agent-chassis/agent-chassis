

import { pathToFileURL } from "node:url";

export const AVA_LOAD_CONFIG_ENV = "LAUNCHER_AVA_LOAD_CONFIG";
export const AVA_TMPDIR_ENV = "LAUNCHER_AVA_TMPDIR";

const inheritedTmpdir = process.env.TMPDIR;
const attemptTmpdir = process.env[AVA_TMPDIR_ENV];
delete process.env[AVA_TMPDIR_ENV];
if (typeof attemptTmpdir === "string" && attemptTmpdir.length > 0) process.env.TMPDIR = attemptTmpdir;

function restoreInheritedTmpdir() {
  if (inheritedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = inheritedTmpdir;
}

export default async function launcherAttemptAvaConfig({ projectDir }) {
  try {
    const loader = process.env[AVA_LOAD_CONFIG_ENV];
    if (typeof loader !== "string" || loader.length === 0) {
      throw new Error(`the launcher AVA configuration requires ${AVA_LOAD_CONFIG_ENV}`);
    }
    const { loadConfig } = await import(pathToFileURL(loader).href);
    const { config } = await loadConfig({ resolveFrom: projectDir });
    const { projectDir: _projectDir, configFile: _configFile, ...project } = config;
    return { ...project, cache: false };
  } finally {
    restoreInheritedTmpdir();
  }
}
