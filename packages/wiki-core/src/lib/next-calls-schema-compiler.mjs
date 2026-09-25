

import { createRequire } from "node:module";

const requireFromModule = createRequire(import.meta.url);

let ajvInstance = null;
const compiledBySchema = new WeakMap();

export function argumentValidatorFor(schema) {
  const cached = compiledBySchema.get(schema);
  if (cached) return cached;
  if (ajvInstance === null) {
    const loaded = requireFromModule("ajv");
    const Ajv = loaded.default ?? loaded;

    ajvInstance = new Ajv({ strict: false, allErrors: true });
  }
  const compiled = ajvInstance.compile(schema);
  compiledBySchema.set(schema, compiled);
  return compiled;
}
