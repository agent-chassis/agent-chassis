

import path from "node:path";
import { assertLauncherNativePermissionFacts } from "./workspace-agent-native-permission-facts.mjs";

function representable(value) {
  if (typeof value !== "string" || /[?*\\\0]/u.test(value)) {
    throw new TypeError(`opencode_native_permission_path_unrepresentable: ${JSON.stringify(value)}`);
  }
  return value;
}
function relative(root, file) {
  representable(file);
  return representable(path.relative(root, file) || ".");
}
function grant(rules, root, entry) {
  const name = relative(root, entry.path);
  rules[name] = "allow";
  if (entry.directory) rules[name === "." ? "*" : `${name}/*`] = "allow";
}

export function serializeOpenCodeNativePermissions(input) {
  const facts = assertLauncherNativePermissionFacts(input);
  representable(facts.workspaceDir);
  const read = { "*": "deny" }, edit = { "*": "deny" }, external = { "*": "deny" };
  const outside = entry => {
    const rel = path.relative(facts.workspaceDir, entry.path);
    return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  };
  for (const entry of facts.reads.filter(entry => !outside(entry))) grant(read, facts.workspaceDir, entry);

  read["../*"] = "deny";
  for (const entry of facts.reads.filter(outside)) {
    grant(read, facts.workspaceDir, entry);
    const parent = entry.directory ? entry.path : path.dirname(entry.path);
    external[`${representable(parent)}/*`] = "allow";
    if (entry.directory) external[`${representable(path.dirname(entry.path))}/*`] = "allow";
  }
  for (const entry of facts.writes) grant(edit, facts.workspaceDir, entry);

  for (const { root, relative: excluded, nested } of facts.denied) {
    const name = relative(facts.workspaceDir, path.join(root, excluded));
    for (const rules of [read, edit]) {
      rules[name] = "deny"; rules[`${name}/*`] = "deny";
      if (nested) {
        const prefix = relative(facts.workspaceDir, root);
        const pattern = `${prefix}/*/${representable(excluded)}`;
        rules[pattern] = "deny"; rules[`${pattern}/*`] = "deny";
      }
    }
  }
  return Object.freeze({ "*": "deny", read, edit, external_directory: external,
    glob: "allow", grep: "allow", bash: facts.commands ? "allow" : "deny",
    todoread: "allow", todowrite: "allow",
    ...Object.fromEntries(facts.mcpToolNames.map(name => [`wiki_${name}`, "allow"])) });
}
