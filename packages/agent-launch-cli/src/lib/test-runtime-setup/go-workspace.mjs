

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseGoModFile, parseGoWorkFile } from
  "@agent-chassis/wiki-core/src/lib/runtime-inputs/ecosystem-inputs-go.mjs";

export const GO_WORKSPACE_REFERENCE_REASONS = Object.freeze({
  MODULE_MISSING: "module_missing",
  OUTSIDE_CHECKOUT: "outside_checkout"
});

const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function nearestWorkFile(projectDir, checkoutRoot) {
  for (let directory = projectDir; within(checkoutRoot, directory); directory = path.dirname(directory)) {
    const candidate = path.join(directory, "go.work");
    if (existsSync(candidate)) return candidate;
    if (directory === checkoutRoot) return null;
  }
  return null;
}

export function selectGoWorkspace(projectDir, checkoutRoot = projectDir) {
  const project = path.resolve(projectDir);
  const root = path.resolve(checkoutRoot);
  const standalone = Object.freeze({ file: null, files: Object.freeze({}), invalid: Object.freeze([]) });
  const file = nearestWorkFile(project, root);
  if (file === null) return standalone;
  const workDir = path.dirname(file);
  const work = parseGoWorkFile(readFileSync(file, "utf8"));
  const used = work.uses.map((use) => ({ use, directory: path.resolve(workDir, use) }));
  if (!used.some(({ directory }) => directory === project)) return standalone;
  const files = {};
  const invalid = [];
  const add = (absolute) => {
    files[path.relative(project, absolute).split(path.sep).join("/")] = absolute;
  };

  const moduleFile = (reference, directory, declaredIn) => {
    const goMod = path.join(directory, "go.mod");
    const reason = !within(root, directory) ? GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT
      : !existsSync(goMod) ? GO_WORKSPACE_REFERENCE_REASONS.MODULE_MISSING : null;
    if (reason === null) return goMod;
    invalid.push(Object.freeze({ reference, declared_in: declaredIn, directory, reason }));
    return null;
  };
  const localReplacements = (base, replacements, declaredIn) => {
    for (const { target, local } of replacements) {
      if (!local) continue;
      const goMod = moduleFile(target, path.resolve(base, target), declaredIn);
      if (goMod !== null) add(goMod);
    }
  };
  add(file);
  if (existsSync(`${file}.sum`)) add(`${file}.sum`);
  for (const { use, directory } of used) {
    const goMod = moduleFile(use, directory, file);
    if (goMod === null) continue;
    add(goMod);
    const goSum = path.join(directory, "go.sum");
    if (existsSync(goSum)) add(goSum);
    localReplacements(directory, parseGoModFile(readFileSync(goMod, "utf8")).replacements, goMod);
  }
  localReplacements(workDir, work.replacements, file);
  return Object.freeze({ file, files: Object.freeze(files), invalid: Object.freeze(invalid) });
}
