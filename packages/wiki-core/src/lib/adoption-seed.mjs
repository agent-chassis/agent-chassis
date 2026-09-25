import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates"
);

const ADOPTION_SEED_SOURCE = JSON.parse(
  readFileSync(path.join(TEMPLATES_DIR, "IN-0001.adoption-seed.json"), "utf8")
);

export function getStaticIn0001AdoptionSeed() {
  return JSON.parse(JSON.stringify(ADOPTION_SEED_SOURCE));
}
