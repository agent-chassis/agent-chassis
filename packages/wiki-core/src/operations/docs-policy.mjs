import { validateDocsPolicy } from "../lib/docs-policy.mjs";

export async function validateDocsPolicyOperation({
  dir = ".",
  paths = null,
  verbose = false,
  include_all_findings = false
} = {}) {
  return validateDocsPolicy({
    dir,
    paths,
    verbose,
    include_all_findings
  });
}
