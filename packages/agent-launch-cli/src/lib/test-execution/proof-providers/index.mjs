

import { TEST_RUNTIME_RUNNER_CATALOG, testProofProviderFamily } from
  "@agent-chassis/controlled-contract/test-proof";

import ava from "./ava.mjs";
import cargoTest from "./cargo-test.mjs";
import deno from "./deno.mjs";
import goTest from "./go-test.mjs";
import jest from "./jest.mjs";
import lib0Testing from "./lib0-testing.mjs";
import mocha from "./mocha.mjs";
import nodeTest from "./node-test.mjs";
import pytest from "./pytest.mjs";
import stestr from "./stestr.mjs";
import vitest from "./vitest.mjs";

export const INSTALLED_PROOF_PROVIDER_IMPLEMENTATIONS = Object.freeze([
  nodeTest, pytest, jest, vitest, mocha, ava, deno, lib0Testing, stestr, goTest, cargoTest
]);

export class ProofProviderRegistrationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "ProofProviderRegistrationError";
    this.code = code;
    this.detail = detail;
  }
}

export function bindProofProviderImplementations(catalog, implementations) {
  const bound = new Map();
  for (const implementation of implementations) {
    if (typeof implementation?.prepare !== "function" || typeof implementation?.execute !== "function") {
      throw new ProofProviderRegistrationError("proof_provider_implementation_incomplete",
        `proof provider implementation ${implementation?.family_id ?? "<unknown>"} is incomplete`,
        { family_id: implementation?.family_id ?? null });
    }
    if (bound.has(implementation.family_id)) {
      throw new ProofProviderRegistrationError("proof_provider_implementation_duplicate",
        `proof provider implementation ${implementation.family_id} is registered twice`,
        { family_id: implementation.family_id });
    }
    bound.set(implementation.family_id, implementation);
  }
  const families = catalog.runners.map(({ selector_kind: kind }) =>
    testProofProviderFamily(kind)?.family_id ?? null);
  const unknown = [...bound.keys()].filter((family) => !families.includes(family));
  if (unknown.length > 0) {
    throw new ProofProviderRegistrationError("proof_provider_implementation_unknown_family",
      `proof provider implementations without a package family: ${unknown.join(", ")}`,
      { family_ids: unknown });
  }
  const missing = families.filter((family) => !bound.has(family));
  if (missing.length > 0) {
    throw new ProofProviderRegistrationError("proof_provider_implementation_missing",
      `package provider families without an installed implementation: ${missing.join(", ")}`,
      { family_ids: missing });
  }
  return bound;
}

const INSTALLED = bindProofProviderImplementations(TEST_RUNTIME_RUNNER_CATALOG,
  INSTALLED_PROOF_PROVIDER_IMPLEMENTATIONS);

export function installedProofProviderImplementation(familyId) {
  return INSTALLED.get(familyId) ?? null;
}
