

import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

const absent = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR";
const within = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

function sourceTargets(tree, sources) {
  const targets = [];
  for (const source of sources) {
    const installed = path.join(tree.dir, source.package);
    targets.push({ from: installed, to: source.path });
    try {
      targets.push({ from: realpathSync(installed), to: source.path });
    } catch (error) {
      if (!absent(error)) throw error;

      if (lstatSync(installed).isSymbolicLink()) targets.push({
        from: path.resolve(path.dirname(installed), readlinkSync(installed)), to: source.path });
    }
  }
  return targets.sort((a, b) => b.from.length - a.from.length);
}

function rebaseLauncher(bytes, targets) {
  const text = bytes.toString("latin1");
  const replacements = targets.map(({ from, to }) => ({
    from: Buffer.from(from).toString("latin1"), to: Buffer.from(to).toString("latin1") }));
  let result = "";
  for (let offset = 0; offset < text.length;) {
    const target = replacements.find(({ from }) => text.startsWith(from, offset) &&
      (offset === 0 || /[\s'"=:;]/u.test(text[offset - 1])) &&
      (offset + from.length === text.length || /[\s/'":;]/u.test(text[offset + from.length])));
    if (target === undefined) result += text[offset++];
    else { result += target.to; offset += target.from.length; }
  }
  return Buffer.from(result, "latin1");
}

export function npmExecutableEntries(tree, modules, sources) {
  const installed = path.join(tree.dir, ".bin");
  try { lstatSync(installed); } catch (error) {
    if (absent(error)) return { directories: [], links: [], writes: [] };
    throw error;
  }
  const destination = path.join(modules, ".bin");
  const targets = sourceTargets(tree, sources);
  const launcherTargets = targets.flatMap((target) => [target,
    ...["$basedir", "${basedir}"].map((variable) => ({
      from: `${variable}/${path.relative(installed, target.from)}`, to: target.to }))])
    .sort((a, b) => b.from.length - a.from.length);
  const rebase = (file) => {
    const target = targets.find(({ from }) => within(from, file));
    return target === undefined ? file : path.join(target.to, path.relative(target.from, file));
  };
  const links = [];
  const writes = [];
  for (const name of readdirSync(installed).sort()) {
    const file = path.join(installed, name);
    const output = path.join(destination, name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      const lexical = path.resolve(installed, readlinkSync(file));
      let target = rebase(lexical);
      if (target === lexical) {
        try { target = rebase(realpathSync(file)); } catch (error) {
          if (!absent(error)) throw error;

        }
      }
      links.push({ path: output, target });
    } else if (stat.isFile()) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) links.push({ path: output, target: file });
      else writes.push({ path: output, content: rebaseLauncher(bytes, launcherTargets), mode: stat.mode & 0o777 });
    } else {

      links.push({ path: output, target: file });
    }
  }
  return { directories: [destination], links, writes };
}
