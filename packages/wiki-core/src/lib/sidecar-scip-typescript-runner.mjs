

import { closeSync, openSync, writeSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isEmptyTypescriptFiles, observeTypescriptConfiguration,
  resolveTypescriptConfig } from "./sidecar-scip-typescript-config.mjs";

export function runTypescriptProjects({ indexerPath, checkoutRoot, outputPath, configurations }) {
  const require = createRequire(indexerPath);

  require(indexerPath);
  const ts = require("typescript");
  const { ProjectIndexer } = require(path.join(path.dirname(indexerPath), "ProjectIndexer.js"));
  const { scip } = require(path.join(path.dirname(indexerPath), "scip.js"));
  const { parseHumanByteSizeIntoNumber } = require(path.join(path.dirname(indexerPath), "parseHumanByteSizeIntoNumber.js"));
  const version = require("../package.json").version;
  const cache = { sources: new Map(), parsedCommandLines: new Map() };
  const visited = new Set();
  const membership = [];
  const output = openSync(outputPath, "w");
  let documentCount = 0;
  const writeIndex = (index) => {
    documentCount += index.documents.length;
    writeSync(output, index.serializeBinary());
  };
  const relative = (file) => path.relative(checkoutRoot, file).split(path.sep).join("/");
  function visit(config) {
    const file = resolveTypescriptConfig(ts, checkoutRoot, config);
    if (visited.has(file)) return;
    visited.add(file);
    const { parsed, state, diagnostics } = observeTypescriptConfiguration(ts, file);
    const member = { configuration: relative(file), state, document_count: 0, diagnostics };
    membership.push(member);
    for (const reference of [...(parsed?.projectReferences ?? [])].sort((a, b) => a.path.localeCompare(b.path))) {
      visit(ts.resolveProjectReferencePath(reference));
    }
    if (!parsed || state === "configuration_error" || state === "configuration_unavailable") return;
    member.state = "empty_project";
    if (!parsed.fileNames.length) return;
    const before = documentCount;

    new ProjectIndexer(parsed, {
      cwd: checkoutRoot, output: outputPath,

      projectRoot: checkoutRoot, projectDisplayName: relative(file),
      globalCaches: true, progressBar: false, maxFileByteSizeNumber: parseHumanByteSizeIntoNumber("1mb"),
      indexedProjects: visited, writeIndex
    }, { ...cache, indexedFiles: new Set() }).index();
    member.document_count = documentCount - before;
    if (member.document_count === 0) {
      if (!isEmptyTypescriptFiles(ts, parsed.fileNames)) {
        throw new Error(`SCIP provider produced no documents for nonempty configuration ${relative(file)}`);
      }
    } else member.state = "indexed";
  }
  try {
    writeIndex(new scip.Index({ metadata: new scip.Metadata({
      project_root: pathToFileURL(checkoutRoot).toString(), text_document_encoding: scip.TextEncoding.UTF8,
      tool_info: new scip.ToolInfo({ name: "scip-typescript", version, arguments: [] })
    }) }));
    for (const config of [...configurations].sort()) visit(config);
  } finally {
    closeSync(output);
  }
  writeFileSync(`${outputPath}.projects.json`, JSON.stringify(membership));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [indexerPath, checkoutRoot, outputPath, ...configurations] = process.argv.slice(2);
  runTypescriptProjects({ indexerPath, checkoutRoot, outputPath, configurations });
}
