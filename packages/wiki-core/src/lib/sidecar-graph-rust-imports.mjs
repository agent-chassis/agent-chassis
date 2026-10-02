

import path from "node:path";

export const SIDECAR_RUST_CRATE_SET_CANDIDATE = "Cargo.toml:*";

const EXTERNAL_ROOTS = new Set(["std", "core", "alloc", "proc_macro", "test"]);

function namedChildren(node) {
  return Array.from({ length: node.namedChildCount }, (_, index) => node.namedChild(index));
}

function textOf(text, node) {
  return text.slice(node.startIndex, node.endIndex);
}

function outerAttributes(node, text) {
  const attributes = [];
  for (let sibling = node.previousNamedSibling; sibling?.type === "attribute_item";
    sibling = sibling.previousNamedSibling) {
    attributes.push(textOf(text, sibling));
  }
  return attributes;
}

const isCfg = (attributes) => attributes.some((attribute) => /^#\[\s*cfg(?:_attr)?\s*\(/u.test(attribute));
const hasPathAttribute = (attributes) => attributes.some((attribute) => /^#\[\s*path\s*=/u.test(attribute));

function pathSegments(node, text) {
  if (!node) return [];
  switch (node.type) {
    case "identifier": case "crate": case "self": case "super":
      return [textOf(text, node)];
    case "scoped_identifier": {
      const prefix = node.childForFieldName("path");
      const name = node.childForFieldName("name");
      return [...(prefix ? pathSegments(prefix, text) : ["::"]), ...(name ? pathSegments(name, text) : [])];
    }
    default:
      return [textOf(text, node)];
  }
}

function useLeaves(node, text, prefix = []) {
  if (!node) return [];
  switch (node.type) {
    case "use_as_clause":
      return [{ segments: [...prefix, ...pathSegments(node.childForFieldName("path"), text)], glob: false }];
    case "use_wildcard": {
      const inner = namedChildren(node)[0] ?? null;
      return [{ segments: [...prefix, ...pathSegments(inner, text)], glob: true }];
    }
    case "scoped_use_list": {
      const base = [...prefix, ...pathSegments(node.childForFieldName("path"), text)];
      return useLeaves(node.childForFieldName("list"), text, base);
    }
    case "use_list":
      return namedChildren(node).flatMap((child) => child.type === "self"
        ? [{ segments: prefix, glob: false }] : useLeaves(child, text, prefix));
    default:
      return [{ segments: [...prefix, ...pathSegments(node, text)], glob: false }];
  }
}

export function collectRustImportFacts({ rootNode, text, languageKey }) {
  const facts = [];
  const visit = (node, inline, cfg) => {
    for (const child of namedChildren(node)) {
      if (child.type === "mod_item") {
        const attributes = outerAttributes(child, text);
        const name = textOf(text, child.childForFieldName("name"));
        const body = child.childForFieldName("body");
        const guarded = cfg || isCfg(attributes);
        if (body) {
          visit(body, [...inline, name], guarded);
          continue;
        }
        facts.push({ construct: "mod", dynamic: false, index: child.startIndex, languageKey, specifier: name,
          rust: { kind: "mod", inline, name, cfg: guarded, path_attribute: hasPathAttribute(attributes) } });
      } else if (child.type === "use_declaration") {
        const guarded = cfg || isCfg(outerAttributes(child, text));
        for (const leaf of useLeaves(child.childForFieldName("argument"), text)) {
          facts.push({ construct: "use", dynamic: false, index: child.startIndex, languageKey,
            specifier: `${leaf.segments.join("::").replace(/^::::/u, "::")}${leaf.glob ? "::*" : ""}`,
            rust: { kind: "use", inline, segments: leaf.segments, glob: leaf.glob, cfg: guarded } });
        }
      } else if (child.type === "extern_crate_declaration") {
        const name = textOf(text, child.childForFieldName("name"));
        facts.push({ construct: "extern_crate", dynamic: false, index: child.startIndex, languageKey,
          specifier: name, rust: { kind: "extern_crate", inline, segments: ["::", name], glob: false,
            cfg: cfg || isCfg(outerAttributes(child, text)) } });
      } else if (child.type !== "macro_definition" && child.type !== "macro_invocation") {
        visit(child, inline, cfg);
      }
    }
  };
  visit(rootNode, [], false);
  return facts.sort((left, right) => left.index - right.index);
}

function manifestString(text, table, key) {
  let current = null;
  for (const raw of String(text).split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, "").trim();
    const header = /^\[\s*([^\[\]]+?)\s*\]$/u.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== table) continue;
    const pair = new RegExp(`^${key}\\s*=\\s*"([^"\\\\]*)"$`, "u").exec(line);
    if (pair) return pair[1];
  }
  return null;
}

export function sidecarRustCrates(cargoFiles) {
  return [...cargoFiles.entries()]
    .filter(([filePath]) => path.posix.basename(filePath) === "Cargo.toml")
    .map(([filePath, content]) => {
      const directory = path.posix.dirname(filePath);
      const packageName = manifestString(content, "package", "name");
      const hasPackage = /^\s*\[\s*package\s*\]\s*$/mu.test(content);
      const libName = manifestString(content, "lib", "name");
      const name = libName ?? packageName;
      return { dir: directory === "" ? "." : directory, manifest: filePath, package: hasPackage,
        crate: hasPackage && name ? name.replaceAll("-", "_") : null };
    })
    .sort((left, right) => left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0);
}

const join = (...parts) => path.posix.join(...parts.filter((part) => part !== "."));
const within = (directory, relativePath) => directory === "." || relativePath.startsWith(`${directory}/`);

function owningPackage(relativePath, rustCrates) {
  let owner = null;
  for (const entry of rustCrates) {
    if (entry.package && within(entry.dir, relativePath) &&
        (owner === null || entry.dir.length > owner.dir.length)) owner = entry;
  }
  return owner;
}

function crateOfFile(relativePath, owner, sourcePathSet, dependencies) {
  const rel = owner.dir === "." ? relativePath : relativePath.slice(owner.dir.length + 1);
  const at = (value) => join(owner.dir, value);
  const rootMatch = /^(?:build\.rs|src\/(?:lib|main)\.rs|src\/bin\/[^/]+\.rs|(?:tests|examples|benches)\/[^/]+\.rs|(?:src\/bin|tests|examples|benches)\/[^/]+\/main\.rs)$/u;
  if (rootMatch.test(rel)) {
    return { rootDir: path.posix.dirname(relativePath), roots: [relativePath], module: [] };
  }
  const nested = /^((?:src\/bin|tests|examples|benches)\/[^/]+)\/(.+)$/u.exec(rel);
  let rootDir;
  let roots;
  let below;
  let candidates;
  if (nested) {
    rootDir = at(nested[1]);
    candidates = [join(rootDir, "main.rs")];
    below = nested[2];
  } else if (rel.startsWith("src/")) {
    rootDir = at("src");
    candidates = ["lib.rs", "main.rs"].map((name) => join(rootDir, name));
    below = rel.slice(4);
  } else {
    return null;
  }
  roots = candidates.filter((root) => sourcePathSet.has(root));
  for (const candidate of candidates) {
    dependencies.push({ candidate_path: candidate, resolution_state: !sourcePathSet.has(candidate) ? "absent"
      : roots.length > 1 ? "ambiguous" : "present" });
  }
  if (roots.length === 0) return null;
  const parts = below.replace(/\.rs$/u, "").split("/");
  if (parts.at(-1) === "mod") parts.pop();
  return { rootDir, roots, module: parts };
}

function moduleFile(rootDir, modulePath, sourcePathSet, dependencies) {
  const base = join(rootDir, ...modulePath);
  const candidates = [`${base}.rs`, join(base, "mod.rs")];
  const present = candidates.filter((candidate) => sourcePathSet.has(candidate));
  for (const candidate of candidates) {
    dependencies.push({ candidate_path: candidate,
      resolution_state: !sourcePathSet.has(candidate) ? "absent" : present.length > 1 ? "ambiguous" : "present" });
  }
  if (present.length > 1) return { ambiguous: true, candidates: present };
  return present.length === 1 ? { path: present[0] } : null;
}

function resolveModulePath(crate, modulePath, sourcePathSet, dependencies) {
  for (let length = modulePath.length; length > 0; length -= 1) {
    const found = moduleFile(crate.rootDir, modulePath.slice(0, length), sourcePathSet, dependencies);
    if (found?.ambiguous) return { reason: "ambiguous_local_path", candidates: found.candidates };
    if (found) return { target: found.path };
  }
  if (crate.roots.length !== 1) return { reason: "rust_crate_root_ambiguous", candidates: crate.roots };
  return { target: crate.roots[0] };
}

function unresolved(reason, candidates = [], external = false) {
  return { resolved: false, external, unresolvedReason: reason, candidatePaths: candidates };
}

function resolveRustFactWith({ fact, relativePath, sourcePathSet, rustCrates }, dependencies) {
  const rust = fact.rust ?? {};
  if (rust.cfg) return unresolved("cfg_dependent");
  if (rust.kind === "mod" && rust.path_attribute) return unresolved("rust_path_attribute");
  if (rust.glob) return unresolved("glob_import");
  dependencies.push({ candidate_path: SIDECAR_RUST_CRATE_SET_CANDIDATE, resolution_state: "present" });
  const owner = owningPackage(relativePath, rustCrates);
  if (owner === null) return unresolved("outside_cargo_package");
  const crate = crateOfFile(relativePath, owner, sourcePathSet, dependencies);
  if (crate === null) return unresolved("rust_crate_root_unknown");
  const base = [...crate.module, ...(rust.inline ?? [])];
  if (rust.kind === "mod") {
    const found = moduleFile(crate.rootDir, [...base, rust.name], sourcePathSet, dependencies);
    if (found?.ambiguous) return unresolved("ambiguous_local_path", found.candidates);
    return found ? { resolved: true, targetPaths: [found.path] } : unresolved("local_path_unresolved");
  }
  const segments = [...(rust.segments ?? [])];
  let target = null;
  let modulePath = null;
  if (segments[0] === "crate") {
    target = crate;
    modulePath = segments.slice(1);
  } else if (segments[0] === "self" || segments[0] === "super") {
    modulePath = [...base];
    if (segments[0] === "self") segments.shift();
    while (segments[0] === "super") {
      if (modulePath.length === 0) return unresolved("super_beyond_crate_root");
      modulePath.pop();
      segments.shift();
    }
    target = crate;
    modulePath.push(...segments);
  } else {
    const global = segments[0] === "::";
    const name = global ? segments[1] : segments[0];
    const rest = segments.slice(global ? 2 : 1);
    if (!global && moduleFile(crate.rootDir, [...base, name], sourcePathSet, dependencies)) {
      target = crate;
      modulePath = [...base, name, ...rest];
    } else if (typeof name !== "string" || EXTERNAL_ROOTS.has(name)) {
      return unresolved("external_or_unresolved", [], true);
    } else {

      let library;
      if (owner.crate === name) {
        library = join(owner.dir, "src", "lib.rs");
      } else if (owner.dependencies === null || owner.dependencies === undefined) {
        return unresolved("rust_dependency_mapping_unobserved",
          rustCrates.filter((entry) => entry.crate === name).map(({ manifest }) => manifest));
      } else if (Object.hasOwn(owner.dependencies, name)) {
        library = owner.dependencies[name];
      } else {
        return unresolved("external_or_unresolved", [], true);
      }
      dependencies.push({ candidate_path: library,
        resolution_state: sourcePathSet.has(library) ? "present" : "absent" });
      if (!sourcePathSet.has(library)) return unresolved("rust_crate_library_missing");
      target = { rootDir: path.posix.dirname(library), roots: [library], module: [] };
      modulePath = rest;
    }
  }
  const found = resolveModulePath(target, modulePath, sourcePathSet, dependencies);
  if (found.reason) return unresolved(found.reason, found.candidates);
  if (found.target === relativePath) return unresolved("same_module");
  return { resolved: true, targetPaths: [found.target] };
}

export function resolveRustImportFact(input) {
  const dependencies = [];
  const result = resolveRustFactWith(input, dependencies);
  return { ...result, dependencies };
}
