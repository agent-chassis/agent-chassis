

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import avaIntegration from "./runner-integrations/ava.mjs";
import cargoTestIntegration from "./runner-integrations/cargo-test.mjs";
import denoIntegration from "./runner-integrations/deno.mjs";
import goTestIntegration from "./runner-integrations/go-test.mjs";
import jestIntegration from "./runner-integrations/jest.mjs";
import lib0TestingIntegration from "./runner-integrations/lib0-testing.mjs";
import mochaIntegration from "./runner-integrations/mocha.mjs";
import nodeTestIntegration from "./runner-integrations/node-test.mjs";
import pytestIntegration from "./runner-integrations/pytest.mjs";
import stestrIntegration from "./runner-integrations/stestr.mjs";
import vitestIntegration from "./runner-integrations/vitest.mjs";

export const INSTALLED_RUNNER_INTEGRATIONS = Object.freeze([
  nodeTestIntegration, jestIntegration, vitestIntegration, mochaIntegration, avaIntegration,
  denoIntegration, lib0TestingIntegration, pytestIntegration, stestrIntegration,
  goTestIntegration, cargoTestIntegration
]);

export class RunnerIntegrationRegistrationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "RunnerIntegrationRegistrationError";
    this.code = code;
    this.detail = detail;
  }
}

export function bindRunnerIntegrations(catalog, integrations) {
  const bound = new Map();
  for (const integration of integrations) {
    if (typeof integration?.setupProbe !== "function") {
      throw new RunnerIntegrationRegistrationError("runner_integration_incomplete",
        `integration ${integration?.runner_id ?? "<unknown>"} lacks setupProbe`,
        { runner_id: integration?.runner_id ?? null, missing: ["setupProbe"] });
    }
    if (bound.has(integration.runner_id)) {
      throw new RunnerIntegrationRegistrationError("runner_integration_duplicate",
        `integration ${integration.runner_id} is registered twice`,
        { runner_id: integration.runner_id });
    }
    const descriptor = catalog.runners.find(({ runner_id: id }) => id === integration.runner_id);
    if (!descriptor) {
      throw new RunnerIntegrationRegistrationError("runner_integration_unknown_runner",
        `integration ${integration.runner_id} has no package runtime runner`,
        { runner_id: integration.runner_id });
    }
    bound.set(integration.runner_id, Object.freeze({ descriptor, integration }));
  }
  const unbound = catalog.runners.filter(({ runner_id: id }) => !bound.has(id))
    .map(({ runner_id: id }) => id);
  if (unbound.length > 0) {
    throw new RunnerIntegrationRegistrationError("runner_integration_missing",
      `runtime runners without an installed integration: ${unbound.join(", ")}`,
      { runner_ids: unbound });
  }
  return bound;
}

const INSTALLED = bindRunnerIntegrations(TEST_RUNTIME_RUNNER_CATALOG, INSTALLED_RUNNER_INTEGRATIONS);

export function resolveInstalledRunnerIntegration(descriptor) {
  const entry = INSTALLED.get(descriptor?.runner_id);
  return entry !== undefined && entry.descriptor === descriptor ? entry.integration : null;
}

export function describeInstalledRunnerIntegrations() {
  return Object.freeze([...INSTALLED.values()].map(({ descriptor }) => Object.freeze({
    name: descriptor.name,
    runner_id: descriptor.runner_id,
    runner: descriptor.runner,
    languages: descriptor.languages,
    toolchains: descriptor.toolchains,
    dependency_ecosystem: descriptor.dependency_ecosystem,
    proof_providers: descriptor.proof_providers
  })));
}
