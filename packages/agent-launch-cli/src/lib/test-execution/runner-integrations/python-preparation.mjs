import path from "node:path";

export function pythonDependencyPreparation({ runtime, projectDir, requirementFiles }) {
  const python = runtime.executables?.python;
  const absolute = (value) => typeof value === "string" && path.isAbsolute(value);
  if (!absolute(python) || !absolute(projectDir) || !Array.isArray(requirementFiles) ||
      requirementFiles.length === 0 || !requirementFiles.every(absolute)) return null;
  return { command: python, args: ["-m", "pip", "install", ...requirementFiles.flatMap((file) => ["-r", file])],
    cwd: projectDir, env: {} };
}
