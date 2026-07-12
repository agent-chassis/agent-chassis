

import {
  API_KEY_HEADER,
  CLIENT_DISPOSITIONS,
  VALIDATE_PATH,
  REQUEST_CONTRACT_DIGEST_ENV_KEYS,
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

export function buildSmokeDiagnostic(outcome, { strict = false } = {}) {
  const diagnostic = {
    tool: "node-engine validate-smoke",
    posture: "structural_only_non_authority",
    disposition: outcome.disposition ?? null,
    outcome: outcome.outcome ?? null,
    reason_code: outcome.reason_code ?? null,
    authenticated_request_sent: outcome.authenticated_request_sent === true,
    node_engine_backed_success: outcome.node_engine_backed_success === true,
    request_header: API_KEY_HEADER,
    target_route: VALIDATE_PATH,
    auth_mode: "x_api_key_only",
    sources: {
      service_url_source: outcome.service_url_source ?? null,
      service_url_preferred: outcome.service_url_preferred ?? null,
      key_source: outcome.key_source ?? null,
      key_preferred: outcome.key_preferred ?? null,
    },
  };

  if ("status_class" in outcome) diagnostic.status_class = outcome.status_class;
  if ("content_type" in outcome) diagnostic.content_type = outcome.content_type;
  if ("json_parsed" in outcome) diagnostic.json_parsed = outcome.json_parsed;
  if ("body_summary" in outcome) diagnostic.body_summary = outcome.body_summary;
  if ("redacted_key" in outcome) diagnostic.redacted_key = outcome.redacted_key;
  if ("error_name" in outcome) diagnostic.error_name = outcome.error_name;

  let exitCode;
  if (outcome.disposition === CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN) {
    exitCode = strict ? 1 : 0;
  } else if (outcome.node_engine_backed_success === true) {
    exitCode = 0;
  } else {
    exitCode = 1;
  }

  return { diagnostic, exitCode };
}

export function renderText(diagnostic) {
  console.log(`Chassis Control Engine validate-smoke (${diagnostic.posture})`);
  console.log(`  disposition: ${diagnostic.disposition}`);
  console.log(`  outcome: ${diagnostic.outcome}`);
  console.log(`  reason_code: ${diagnostic.reason_code}`);
  console.log(`  authenticated_request_sent: ${diagnostic.authenticated_request_sent}`);
  console.log(`  node_engine_backed_success: ${diagnostic.node_engine_backed_success}`);
  console.log(`  auth_mode: ${diagnostic.auth_mode} (header ${diagnostic.request_header}, route ${diagnostic.target_route})`);
  console.log(`  service_url_source: ${diagnostic.sources.service_url_source ?? "(none)"} (preferred: ${diagnostic.sources.service_url_preferred})`);
  console.log(`  key_source: ${diagnostic.sources.key_source ?? "(none)"} (preferred: ${diagnostic.sources.key_preferred})`);
  if ("status_class" in diagnostic) {
    console.log(`  status_class: ${diagnostic.status_class}`);
  }
  if ("error_name" in diagnostic) {
    console.log(`  error_name: ${diagnostic.error_name}`);
  }
}

export function buildPackSmokeDiagnostic(outcome, { strict = false } = {}) {
  const diagnostic = {
    tool: "node-engine worker-admission-pack-smoke",
    posture: "structural_only_non_authority",
    disposition: outcome.disposition ?? null,
    outcome: outcome.outcome ?? null,
    reason_code: outcome.reason_code ?? null,
    authenticated_request_sent: outcome.authenticated_request_sent === true,
    pack_backed: outcome.pack_backed === true,
    effect: outcome.effect ?? null,
    node_engine_backed_success: outcome.node_engine_backed_success === true,
    node_engine_binding_status: outcome.node_engine_binding_status ?? null,
    request_header: API_KEY_HEADER,
    auth_mode: "x_api_key_only",
    sources: {
      service_url_source: outcome.service_url_source ?? null,
      service_url_preferred: outcome.service_url_preferred ?? null,
      key_source: outcome.key_source ?? null,
      key_preferred: outcome.key_preferred ?? null,

      request_contract_digest_source: outcome.request_contract_digest_source ?? null,
      request_contract_digest_preferred:
        outcome.request_contract_digest_source
          ? outcome.request_contract_digest_source === REQUEST_CONTRACT_DIGEST_ENV_KEYS[0]
          : null,
      request_contract_digest_present: outcome.request_contract_digest_present === true,
    },
  };

  if ("status_class" in outcome) diagnostic.status_class = outcome.status_class;
  if ("content_type" in outcome) diagnostic.content_type = outcome.content_type;
  if ("json_parsed" in outcome) diagnostic.json_parsed = outcome.json_parsed;
  if ("body_summary" in outcome) diagnostic.body_summary = outcome.body_summary;
  if ("redacted_key" in outcome) diagnostic.redacted_key = outcome.redacted_key;
  if ("error_name" in outcome) diagnostic.error_name = outcome.error_name;

  let exitCode;
  if (outcome.disposition === CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN) {
    exitCode = strict ? 1 : 0;
  } else if (outcome.node_engine_backed_success === true) {
    exitCode = 0;
  } else {

    exitCode = 1;
  }

  return { diagnostic, exitCode };
}

export function renderPackText(diagnostic) {
  console.log(`Chassis Control Engine worker-admission-pack-smoke (${diagnostic.posture})`);
  console.log(`  disposition: ${diagnostic.disposition}`);
  console.log(`  outcome: ${diagnostic.outcome}`);
  console.log(`  reason_code: ${diagnostic.reason_code}`);
  console.log(`  authenticated_request_sent: ${diagnostic.authenticated_request_sent}`);
  console.log(`  pack_backed: ${diagnostic.pack_backed}`);
  console.log(`  effect: ${diagnostic.effect ?? "(none)"}`);
  console.log(`  node_engine_backed_success: ${diagnostic.node_engine_backed_success}`);
  console.log(`  node_engine_binding_status: ${diagnostic.node_engine_binding_status}`);
  console.log(`  auth_mode: ${diagnostic.auth_mode} (header ${diagnostic.request_header})`);
  console.log(`  service_url_source: ${diagnostic.sources.service_url_source ?? "(none)"} (preferred: ${diagnostic.sources.service_url_preferred})`);
  console.log(`  key_source: ${diagnostic.sources.key_source ?? "(none)"} (preferred: ${diagnostic.sources.key_preferred})`);
  console.log(`  request_contract_digest_source: ${diagnostic.sources.request_contract_digest_source ?? "(none)"} (present: ${diagnostic.sources.request_contract_digest_present})`);
  if ("status_class" in diagnostic) {
    console.log(`  status_class: ${diagnostic.status_class}`);
  }
  if ("error_name" in diagnostic) {
    console.log(`  error_name: ${diagnostic.error_name}`);
  }
}
