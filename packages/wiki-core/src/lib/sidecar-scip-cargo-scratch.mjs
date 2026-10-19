

import { copyFile, lstat, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MATERIAL = new Set(["Cargo.toml", "Cargo.lock", "rust-toolchain", "rust-toolchain.toml"]);
const EXCLUDED = new Set([".git", ".cache", ".agent-runs", "node_modules", "target", "wiki"]);

export async function prepareSidecarCargoScratch({ checkoutRoot, privateRoot, manifests, configurationFiles = [] }) {
  const cargoRoot = path.join(privateRoot, "cargo-projects");
  await rm(cargoRoot, { recursive: true, force: true });
  const spine = new Set(["."]);
  const configurations = new Set(configurationFiles.map((file) => path.relative(checkoutRoot, file).split(path.sep).join("/")));
  const projects = new Set(manifests.map((file) => path.posix.dirname(file)));
  for (const project of [...projects, ...[...configurations].map((file) => path.posix.dirname(file))]) {
    for (let dir = project; ; dir = path.posix.dirname(dir)) {
      spine.add(dir);
      if (dir === ".") break;
    }
  }
  async function visit(relative) {
    const source = path.join(checkoutRoot, relative);
    const destination = path.join(cargoRoot, relative);
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      const child = relative === "." ? entry.name : `${relative}/${entry.name}`;
      if (EXCLUDED.has(entry.name) && !spine.has(child) && !configurations.has(child)) continue;
      if (MATERIAL.has(entry.name) || configurations.has(child)) {

        if ((await lstat(from)).isDirectory()) continue;
        await copyFile(from, to);
      } else if (spine.has(child)) await visit(child);
      else if (entry.name !== ".cargo" && !relative.split("/").some((part) => part === ".cargo" || EXCLUDED.has(part)) && [...projects].some((project) =>
        project === "." || relative === project || relative.startsWith(`${project}/`))) await symlink(from, to);
    }
  }
  await visit(".");
  return cargoRoot;
}

export async function sidecarRustConfiguration({ privateRoot, project }) {
  const file = path.join(privateRoot, `rust-${Buffer.from(project).toString("hex") || "root"}.json`);
  await writeFile(file, JSON.stringify({ linkedProjects: [path.join(privateRoot, "cargo-projects", project, "Cargo.toml")],
    cargo: { targetDir: path.join(privateRoot, "cargo-target") } }));
  return file;
}
