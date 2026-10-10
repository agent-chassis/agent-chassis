

import { loadManifest, readContractFile } from "../lib/contract.mjs";
import { extractMarkdownBody } from "../lib/wiki-frontmatter.mjs";
import { renderYamlLine } from "../lib/work-record-kind-renderer.mjs";

const serverOwned = new Set(["id", "title", "captured", "updated"]);
const manifest = await loadManifest();
const schemas = new Map(await Promise.all(["source", "area"].map(async kind => {
  const definition = manifest.types[kind];
  const template = await readContractFile(`templates/${definition.template}`);
  const fields = [...definition.requiredFrontMatter, ...definition.optionalFrontMatter]
    .filter(field => !serverOwned.has(field));
  const required = kind === "source"
    ? definition.requiredFrontMatter.filter(field => !serverOwned.has(field)) : [];
  const properties = Object.fromEntries(fields.map(field => {
    const strings = { type: "string" };
    if (definition.enumFrontMatter && Object.hasOwn(definition.enumFrontMatter, field)) {
      strings.enum = [...definition.enumFrontMatter[field]];
    }
    const schema = definition.arrayFrontMatter.includes(field)
      ? { type: "array", items: strings } : strings;
    if (schema.type === "string" && required.includes(field)) schema.pattern = "\\S";
    return [field, schema];
  }));

  const sections = [...extractMarkdownBody(template).matchAll(/^##[ \t]+(.+)$/gm)]
    .map(([, heading]) => [heading.trim().toLowerCase().replace(/\s+/gu, "_"), { type: "string" }]);
  properties.sections = {
    type: "object", additionalProperties: false, properties: Object.fromEntries(sections)
  };
  return [kind, {
    type: "object", additionalProperties: false,
    ...(required.length > 0 ? { required } : {}), properties
  }];
})));

export function sourceAreaBirthSchema(kind) {
  if (!schemas.has(kind)) {
    throw new TypeError(`Unsupported source/area birth schema kind '${String(kind)}'`);
  }
  return structuredClone(schemas.get(kind));
}

export function prepareSourceAreaBirth({ kind, title, initial, id, date }) {

  const schema = sourceAreaBirthSchema(kind);
  const definition = manifest.types[kind];
  const frontmatter = {};
  for (const field of [...definition.requiredFrontMatter, ...definition.optionalFrontMatter]) {
    if (field === "id") frontmatter[field] = id;
    else if (field === "title") frontmatter[field] = title;
    else if (field === "captured" || field === "updated") frontmatter[field] = date;
    else if (Object.hasOwn(initial, field)) frontmatter[field] = structuredClone(initial[field]);
    else if (definition.arrayFrontMatter.includes(field)) frontmatter[field] = [];
  }
  const sections = structuredClone(initial.sections ?? {});
  const body = [`\n# ${title}\n\n`];
  for (const slot of Object.keys(schema.properties.sections.properties)) {
    if (!Object.hasOwn(sections, slot)) continue;
    const heading = slot.split("_").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
    body.push(`## ${heading}\n\n${sections[slot]}\n\n`);
  }
  const yaml = Object.entries(frontmatter).map(([field, value]) => renderYamlLine(field, value)).join("\n");
  return { frontmatter, sections, markdown: `---\n${yaml}\n---\n${body.join("")}` };
}
