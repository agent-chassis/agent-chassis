

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseGoModFile, parseGoWorkFile } from "./ecosystem-inputs-go.mjs";

export const GO_WORKSPACE_REFERENCE_REASONS = Object.freeze({
  MODULE_MISSING: "module_missing", OUTSIDE_CHECKOUT: "outside_checkout"
});
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export function describeGoWorkspace(projectDir, checkoutRoot = projectDir, {
  exists = existsSync, read = file => readFileSync(file, "utf8")
} = {}) {
  const project = path.resolve(projectDir);
  const root = path.resolve(checkoutRoot);
  let nearest = null;
  for (let directory = project; within(root, directory); directory = path.dirname(directory)) {
    const candidate = path.join(directory, "go.work");
    if (exists(candidate)) { nearest = candidate; break; }
    if (directory === root) break;
  }
  const work = nearest === null ? null : parseGoWorkFile(read(nearest));
  const used = work?.uses.map(use => ({ use, directory: path.resolve(path.dirname(nearest), use) })) ?? [];
  const file = used.some(({ directory }) => directory === project) ? nearest : null;
  const files = {};
  const invalid = [];
  const references = [];
  const roots = new Set([project]);
  const add = absolute => { files[path.relative(project, absolute).split(path.sep).join("/")] = absolute; };
  const moduleFile = (reference, directory, declaredIn, kind) => {
    const goMod = path.join(directory, "go.mod");
    const reason = !within(root, directory) ? GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT
      : !exists(goMod) ? GO_WORKSPACE_REFERENCE_REASONS.MODULE_MISSING : null;
    if (within(root, directory)) roots.add(directory);
    references.push({ reference, directory, declared_in: declaredIn, kind });
    if (reason !== null) {
      invalid.push(Object.freeze({ reference, declared_in: declaredIn, directory, reason }));
      return null;
    }
    return goMod;
  };
  const localReplacements = (base, replacements, declaredIn) => {
    for (const { target, local } of replacements) {
      if (!local) continue;
      const mod = moduleFile(target, path.resolve(base, target), declaredIn, "replacement");
      if (mod !== null) add(mod);
    }
  };
  const moduleReplacements = mod => localReplacements(path.dirname(mod), parseGoModFile(read(mod)).replacements, mod);
  if (file !== null) {
    add(file);
    if (exists(`${file}.sum`)) add(`${file}.sum`);
    for (const { use, directory } of used) {
      const mod = moduleFile(use, directory, file, "member");
      if (mod === null) continue;
      add(mod);
      if (exists(path.join(directory, "go.sum"))) add(path.join(directory, "go.sum"));
      moduleReplacements(mod);
    }
    localReplacements(path.dirname(file), work.replacements, file);
  } else if (exists(path.join(project, "go.mod"))) moduleReplacements(path.join(project, "go.mod"));
  return Object.freeze({ file, files: Object.freeze(files), invalid: Object.freeze(invalid),
    references: Object.freeze(references), input_roots: Object.freeze([...roots].sort()) });
}
