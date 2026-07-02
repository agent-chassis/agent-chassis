import path from "node:path";
import { loadManifest } from "@agent-chassis/wiki-core";

function registerStaticResource(server, { name, uri, mimeType, loader, errorContent }) {
  server.registerResource(
    name,
    uri,
    { mimeType },
    async () => {
      try {
        return {
          contents: [
            {
              uri,
              mimeType,
              text: await loader()
            }
          ]
        };
      } catch (error) {
        const shaped = errorContent(error);
        return {
          ...shaped,
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: shaped.content?.[0]?.text ?? String(error)
            }
          ]
        };
      }
    }
  );
}

export function registerStaticResources(server, {
  readContractFile,
  errorContent
}) {
  registerStaticResource(server, {
    name: "Shared Contract Manifest",
    uri: "contract://manifest",
    mimeType: "application/json",
    loader: async () => JSON.stringify(await loadManifest(), null, 2),
    errorContent
  });

  for (const [name, file] of [
    ["Shared Contract Schema", "schema.md"],
    ["Shared Contract Conventions", "conventions.md"],
    ["Shared Contract Taxonomy", "taxonomy.md"],
    ["Shared Contract Query Model", "query.md"],
    ["Shared Contract Lint Model", "lint.md"]
  ]) {
    registerStaticResource(server, {
      name,
      uri: `contract://${path.basename(file, ".md")}`,
      mimeType: "text/markdown",
      loader: async () => readContractFile(file),
      errorContent
    });
  }

  for (const templateName of ["area", "decision", "initiative", "issue", "source"]) {
    registerStaticResource(server, {
      name: `${templateName} template`,
      uri: `contract://templates/${templateName}`,
      mimeType: "text/markdown",
      loader: async () => readContractFile(path.join("templates", `${templateName}.md`)),
      errorContent
    });
  }
}
