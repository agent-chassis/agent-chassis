import { sidecarCheckoutObservationIdentity } from "@agent-chassis/wiki-core/src/lib/sidecar-checkout-inputs.mjs";
import { isDeepStrictEqual } from "node:util";
import { projectFailureDiagnosis } from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { SIDECAR_NAVIGATION_RESULT_FIELDS } from
  "@agent-chassis/wiki-core/src/lib/sidecar-navigation-projection.mjs";
import { SIDECAR_CODE_QUESTION_FIELDS, SIDECAR_CODE_QUESTION_RELATIONSHIPS } from
  "@agent-chassis/wiki-core/src/lib/sidecar-query-input.mjs";
import { SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE, pinnedQueryContext } from
  "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { codeCandidateCalls, codeMeaningSubjects, codeSourceCalls, inlineCodeRegions, projectCodeNavigation, qualifyCodeSourceLimits, selectedCodeCandidateMeaning } from "./code-index-query-meaning.mjs";
import { jsonContent, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import {
  retainSelectedResponseSource,
  selectedResponseDeliveryBound,
  readSelectedResponseSource,
  selectedResponseCorrectableError,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import { codeIndexDetailSchema, selectableSubjects, selectCodeIndexRetainedCollection } from "./code-index-query-selection.mjs";
export { codeIndexDetailSchema, codeIndexCollectionCounts, selectCodeIndexRetainedCollection } from "./code-index-query-selection.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { inputContractMechanicalRefusal } from "./tool-discovery-input-guidance-delivery.mjs";
import { presentCodeReviewSource } from "./code-index-query-reviewed-source.mjs";

export const CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION = "code-index-question-navigation.v1";

const COMPOSITION_MAX_PASSES = 3;

const QUERY_ARGUMENTS = SIDECAR_CODE_QUESTION_FIELDS;

const NAVIGATION_RELATIONSHIPS = SIDECAR_CODE_QUESTION_RELATIONSHIPS;

const NAVIGATION_RESULT_FIELDS = SIDECAR_NAVIGATION_RESULT_FIELDS;

const PREPARATION_TOOL = "workspace_code_index_build";
const PREPARATION_PURPOSE = "prepare_index";

export function createCodeIndexPreparationGuidance(contracts = null) {
  return async () => {
    const contract = contracts?.contractFor(PREPARATION_TOOL) ?? null;
    if (contract === null || !await contract.acceptsArguments({})) {
      return { state: "capability_unavailable", call: null,
        slot: { state: "capability_unavailable", missing_capability: "prepare_code_index" },
        sentence: "This session has no registered operation that prepares the code index " +
          "(preparation.missing_capability)." };
    }
    return { state: "action_available",
      call: { ...buildNextCall({ tool: PREPARATION_TOOL, arguments: {} }), purpose: PREPARATION_PURPOSE },
      slot: { state: "action_available", operation: PREPARATION_TOOL },
      sentence: `Call ${PREPARATION_TOOL} with {} (next_calls, purpose ${PREPARATION_PURPOSE}) to prepare ` +
        "current HEAD and wait." };
  };
}

export function createCodeIndexUnavailableResponse({ workspaceRepo, route, args, error, preparation }) {
  const refresh = error.index_state?.refresh;
  return {
    available: false, code: error.code, reason: error.index_state?.reason,
    ...(error.index_state?.cause ? { cause: error.index_state.cause } : {}),
    ...(refresh ? { refresh: { state: refresh.state,
      ...(refresh.failure ? { failure: { code: refresh.failure.code, message: refresh.failure.message },
        publication_outcome: refresh.failure.details?.publication_outcome ?? "unknown" } : {}) } } : {}),
    preparation: preparation.slot,
    recovery: { state: refresh?.state === "failed" ? "cause_correction_required"
      : ["queued", "running"].includes(refresh?.state) ? "waiting_for_publication" : "index_unavailable",
      condition: refresh?.state === "failed" ? "The reported cause must be corrected before this question can be answered."
        : "This question requires a usable published code index.",
      ...(refresh?.retry?.not_before ? { not_before: refresh.retry.not_before } : {}) },
    next_calls: preparation.call === null ? [] : [{ ...preparation.call,
      information: "Prepare the index only if index maintenance is authorized for this task." }]
  };
}

function responseContractError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function describeRetainedObservation(binding, resolveCurrentObservationIdentity) {
  const retained = binding?.observation_identity ?? null;
  const observation = { kind: "retained_prior_observation", observation_identity: retained };
  if (typeof resolveCurrentObservationIdentity !== "function" || typeof retained !== "string") {
    return { ...observation, state: "unavailable", unavailable_reason: "observation_identity_unrecorded" };
  }
  try {
    const current = await resolveCurrentObservationIdentity(Object.freeze({ ...binding }));
    return { ...observation, state: current === retained ? "current" : "changed" };
  } catch (error) {

    return { ...observation, state: "unavailable",
      unavailable_reason: typeof error?.code === "string" ? error.code : "current_observation_identity_unreadable",
      diagnosis: projectFailureDiagnosis(error),
      ...(Number.isInteger(error?.code) ? { exit_code: error.code } : {}) };
  }
}

export function createCodeIndexAnswerSelection({ route, requestSchema, detailSchema, buildDetailArguments,
  resolveCurrentObservationIdentity = null, review = null, env = process.env }) {
  if (typeof route !== "string" || typeof buildDetailArguments !== "function" ||
      requestSchema === null || typeof requestSchema !== "object" ||
      typeof detailSchema?.safeParse !== "function") {
    throw new TypeError("a code answer selection requires route, requestSchema, detailSchema and buildDetailArguments");
  }
  const detailCall = (repository, selection, extra = {}) => buildNextCall({ tool: route,
    arguments: buildDetailArguments(Object.freeze({ repository, unit: null }), selection), recommended: true,
    ...extra });
  const observationOf = (binding) => describeRetainedObservation(binding, resolveCurrentObservationIdentity);
  const refusals = new WeakMap();

  const authenticated = (repository, detail) => {
    const retained = readSelectedResponseSource(detail.source, { env, expected: { route, repository } });
    if (retained.binding.authority_identity !== undefined) {
      if (!review) throw selectedResponseQueryInvalidError(route, "source_binding_mismatch", { field: "review_source" });
      review.authenticate(retained.binding);
    }
    return retained;
  };
  const retain = ({ binding, carrier, selection }) => ({ source: retainSelectedResponseSource({ binding, carrier,
    ownerCall: locator => ({ tool: route, arguments: buildDetailArguments(Object.freeze({
      repository: binding.repository, unit: null }), { source: { ref_id: locator.ref_id }, ...selection }) }),
    ownerRequestSchema: requestSchema }, { env }) });

  return Object.freeze({
    route,
    maximumBytes: selectedResponseDeliveryBound(env),
    requestSchema,
    detailSchema,
    failure: error => refusals.get(error),
    resolveReviewContext: () => review?.resolve() ?? null,
    async bindReview({ workspace, result, context }) {
      const captured = await review?.capture(result, context);
      if (!captured) return null;
      const binding = { route, repository: workspace.repo, unit: null, authority_identity: context.binding };
      const source = captured.files.length ? retain({ binding,
        carrier: { query_kind: "reviewed_code", reviewed_files: captured.files },
        selection: { collection: "reviewed_files" } }).source : null;
      return { files: captured.files, notice: { state: captured.state, paths: captured.paths,
        ...(captured.cause ? { cause: captured.cause } : {}),
        choices: captured.files.map(file => ({ path: file.path, state: file.state,
          ...(file.reason ? { reason: file.reason } : {}),
          ...(source && file.state === "available" ? { call: detailCall(workspace.repo, {
            source, collection: "reviewed_files", path: file.path }, { purpose: "read_reviewed_source" }) } : {}) })) } };
    },

    retain,

    detailCall(binding, selection, extra = {}) {
      return detailCall(binding.repository, selection, extra);
    },

    async detail({ repository, detail }) {
      const retained = authenticated(repository, detail);
      try {
        const { subject, matched } = selectCodeIndexRetainedCollection({
          route, carrier: retained.carrier, detail });

        const observation = retained.carrier.query_kind === "reviewed_code" ||
          retained.binding.authority_identity !== undefined && !retained.carrier._review
          ? { state: "current" } : await observationOf(retained.binding);
        const response = {
          query_kind: retained.carrier.query_kind,
          selected_detail: { source: detail.source },
          ...(observation.state !== "current" ? { source_limit: {
            state: observation.state, reason: observation.unavailable_reason ?? "checkout_or_publication_changed",
            ...(observation.diagnosis ? { cause: { code: observation.diagnosis.code,
              message: observation.diagnosis.message } } : {}),
            meaning: "This selection is the earlier answer; it does not establish the content of changed or unverified source."
          } } : {}),
          [detail.collection]: (() => {
            const rows = codeMeaningSubjects(new Map([[detail.collection, { ...subject, rows: matched }]]))
              .get(detail.collection).rows;
            return subject.kind === "member" ? rows[0] ?? null : rows;
          })(),
          next_calls: []
        };
        const candidateMeaning = detail.collection === "candidates"
          ? selectedCodeCandidateMeaning(retained.carrier, matched, detail.relationship) : null;
        if (candidateMeaning) {
          Object.assign(response, candidateMeaning);
          const regions = inlineCodeRegions(response, selectableSubjects(retained.carrier));
          if (regions.length) response.context_regions = regions;
        }
        qualifyCodeSourceLimits(response, selectableSubjects(retained.carrier));
        response.next_calls = codeSourceCalls({ subjects: selectableSubjects(retained.carrier),
          source: detail.source, summary: response, collection: candidateMeaning ? null : detail.collection,
          detailCall: (binding, selection) => detailCall(binding.repository, selection), binding: retained.binding });
        presentCodeReviewSource(response, retained.carrier._review, { supplementalRead: true });
        return selectedFullContent({ source: detail.source, retained,
          projection: response });
      } catch (error) {

        if (error?.envelope !== undefined) {
          const subjects = selectableSubjects(retained.carrier);
          const collection = subjects.has(detail.collection) ? detail.collection
            : [...subjects].find(([, subject]) => subject.rows.length > 0)?.[0] ?? subjects.keys().next().value;
          const corrected = collection === undefined ? error : selectedResponseCorrectableError(route,
            (error.envelope.deciding_facts ?? []).find(fact => fact.field === "selected_response.invalid_reason")?.value ?? "code_selection_requires_choice", { rejected_selection: detail,
              cause: error.message, collections: [...subjects.keys()] }, {
              arguments: buildDetailArguments(retained.binding, { source: detail.source, collection }),
              requestSchema, prerequisite: "Choose the intended row or valid source lines from this retained code selection.",
              successCondition: "Inspect the available code selection; this does not answer the rejected selection." });
          error.envelope = corrected.envelope;
          const result = selectedFullContent({ source: detail.source, retained, projection: corrected.envelope });
          result.isError = true;
          refusals.set(error, result);
        }
        throw error;
      }
    },

    validate({ repository, detail }) {
      selectCodeIndexRetainedCollection({ route, carrier: authenticated(repository, detail).carrier, detail });
    },

    observation: observationOf
  });
}

function codeIndexObservationIdentity(result) {
  const snapshot = result?.graph_snapshot;
  return snapshot ? sidecarCheckoutObservationIdentity({ ...snapshot, sequence: snapshot.publication_sequence }) : null;
}

export function createSelectedCodeIndexResponse({ workspaceRepo, result, carrier = result,
  projectSummary, session, queryIdentity, collections = [],
  review = null, authorityIdentity = null,
  observationIdentity = codeIndexObservationIdentity(result) }) {
  const full = { workspaceRepo, ...structuredClone(carrier), ...(review ? { _review: review.notice } : {}) };
  const binding = { route: session.route, repository: workspaceRepo, unit: null,
    query_identity: queryIdentity, observation_identity: observationIdentity,
    ...(authorityIdentity ? { authority_identity: authorityIdentity } : {}) };
  const subjects = codeMeaningSubjects(selectableSubjects(full));
  if (subjects.size === 0) throw new TypeError("a retained code answer has no selectable collection");
  const names = [...new Set([...collections.filter(name => subjects.has(name)), ...subjects.keys()])];
  const preferred = names.find(name => subjects.get(name).rows.length > 0) ?? names[0];
  const { source } = session.retain({ binding, carrier: full, selection: { collection: preferred } });
  const frame = summary => {
    const calls = [];
    const counts = {};
    for (const name of names) {
      const subject = subjects.get(name);
      const count = subject.rows.length;
      if (!count) continue;

      if (!collections.includes(name)) continue;
      if (name === "candidates" && !Object.values(summary.relationships ?? {}).some(part => part.candidates)) continue;
      let delivered = summary[name];
      if (delivered === undefined) delivered = Object.values(summary.relationships ?? {}).find(part => name in part)?.[name];
      const whole = subject.kind === "member" ? subject.rows[0] : subject.rows;
      if (!isDeepStrictEqual(delivered, whole)) {
        counts[name] = count;
        if (name !== "source") calls.push(session.detailCall(binding, { source, collection: name }, { recommended: false }));
      }
    }
    const answer = { ...summary, selected_detail: { source, ...(Object.keys(counts).length ? { totals: counts } : {}) },
      next_calls: calls };
    qualifyCodeSourceLimits(answer, subjects);
    answer.context_regions = inlineCodeRegions(answer, subjects);
    if (!answer.context_regions.length) delete answer.context_regions;
    answer.next_calls.push(...codeCandidateCalls(summary, source, session.detailCall, binding));
    answer.next_calls.push(...codeSourceCalls({ subjects, source, summary: answer,
      detailCall: session.detailCall, binding }));
    presentCodeReviewSource(answer, review?.notice, { files: review?.files });
    if (review) {
      const offered = new Set(answer.next_calls.map(call => JSON.stringify(call.arguments)));
      for (const call of codeSourceCalls({ subjects, source, summary: answer,
        detailCall: session.detailCall, binding })) {
        if (!offered.has(JSON.stringify(call.arguments))) answer.next_calls.push({ ...call, recommended: false,
          information: "Inspect supplemental indexed code; this does not read the reviewed version." });
      }
    }
    return answer;
  };
  const summary = projectSummary(result, { fits: candidate => measureMcpInlineResultBytes(frame(candidate)) <= session.maximumBytes });
  const answer = frame(summary);
  if (measureMcpInlineResultBytes(answer) > session.maximumBytes) {
    throw new RangeError("the requested code meaning and its calls exceed compact admission");
  }
  return answer;
}

function detailOnlyCorrection(session, { repository, queryArguments, detail }) {
  return selectedResponseCorrectableError(session.route, "detail_excludes_query_arguments",
    { arguments: queryArguments }, {
      arguments: session.detailCall({ repository }, detail).arguments,
      requestSchema: session.requestSchema,
      prerequisite: "a detail read selects a retained answer and carries no query argument",
      successCondition: "the same selection without query arguments returns the selected detail" });
}

async function readSelectedCodeIndexDetail({ args, session, workspace }) {
  const parsed = session.detailSchema.safeParse(args.detail);
  if (!parsed.success) {
    throw selectedResponseQueryInvalidError(session.route, "detail_invalid", {
      issues: parsed.error.issues.map(({ code, path }) => ({ code, path }))
    });
  }
  const detail = parsed.data;
  const queryArguments = QUERY_ARGUMENTS.filter((field) => args[field] !== undefined);
  if (queryArguments.length > 0) {

    await session.detail({ repository: workspace.repo, detail });
    throw detailOnlyCorrection(session, { repository: workspace.repo, queryArguments, detail });
  }
  return session.detail({ repository: workspace.repo, detail });
}

export async function composeCodeIndexNavigationAnswer({ navigation, input, relationship, prepare = null }) {
  const requested = relationship === null ? NAVIGATION_RELATIONSHIPS : [relationship];
  let parts;
  for (let pass = 1; ; pass += 1) {
    const context = typeof prepare === "function"
      ? pinnedQueryContext(await prepare({ dir: input.dir, cacheDir: input.cacheDir })) : null;
    parts = {};
    try {
      for (const kind of requested) {
        parts[kind] = await navigation[kind](input, context);
      }
      break;
    } catch (error) {
      if (context === null || error?.code !== "repository_snapshot_changed" ||
          pass >= COMPOSITION_MAX_PASSES) throw error;
    }
  }
  return { schema_version: CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION, query_kind: "code_question_navigation",
    relationship, requested_relationships: [...requested], target: { symbol: input.symbol ?? null,
      path: input.path ?? null, line: input.line ?? null, character: input.character ?? null }, parts };
}

function navigationCarrier(answer) {
  const parts = {};
  const rows = {};
  for (const [relationship, result] of Object.entries(answer.parts)) {
    const field = NAVIGATION_RESULT_FIELDS[result?.query_kind];
    const { [field]: population, ...envelope } = structuredClone(result ?? {});
    parts[relationship] = envelope;
    if (field !== undefined) rows[field] = Array.isArray(population) ? population : [];
  }
  return { schema_version: answer.schema_version, query_kind: answer.query_kind,
    relationship: answer.relationship, requested_relationships: [...answer.requested_relationships],
    target: { ...answer.target }, parts, ...rows };
}

function projectNavigationSummary(answer, { fits }) {
  for (let limit = 3; limit >= 0; limit -= 1) {
    const summary = projectCodeNavigation(answer, { limit });
    if (fits(summary)) return summary;
  }
  throw new RangeError("navigation meaning exceeds compact admission");
}

async function answerCodeQuestion({ selected, queries, workspace, args, projections, session, reviewContext }) {

  const selectedArguments = { ...selected.arguments, dir: workspace.dir };
  const common = { workspaceRepo: workspace.repo, session, queryIdentity: args, authorityIdentity: reviewContext?.binding };
  const present = async options => createSelectedCodeIndexResponse({ ...common, ...options,
    review: await session.bindReview?.({ workspace, result: options.result, context: reviewContext }) });
  if (selected.query_kind === "impact") {
    const result = await queries.impact(selectedArguments);
    return present({ result,
      projectSummary: projections.impactSummary, collections: ["affected_files", "semantic_relationships",
        "semantic_resolution", "canonical_refs", "structural_impacts", "invalid_paths", "invalid_diff_records", "unsupported_changes", "validation_hints", "path_limits"] });
  }
  if (selected.query_kind === "context") {
    const result = await queries.context(selectedArguments);
    return present({ result,
      projectSummary: projections.contextSummary,
      collections: ["source", "definitions", "affected_files", "semantic_relationships", "semantic_resolution",
        ...(selected.arguments.includeSuppressed === true ? ["canonical_refs"] : [])] });
  }
  const answer = await composeCodeIndexNavigationAnswer({ navigation: queries.navigation,
    input: selectedArguments, relationship: selected.relationship,
    prepare: queries.prepareNavigation ?? null });
  const carrier = navigationCarrier(answer);

  const heads = [...new Set(Object.values(answer.parts).map((part) =>
    codeIndexObservationIdentity(part)))];
  return present({ result: answer, carrier,
    observationIdentity: heads.length === 1 ? heads[0] : null,
    projectSummary: projectNavigationSummary,
    collections: [...answer.requested_relationships.map((relationship) =>
      NAVIGATION_RESULT_FIELDS[answer.parts[relationship]?.query_kind]).filter(Boolean), "candidates"] });
}

function codeQuestionInputError(error, route, alternatives) {
  const details = { tool: route, alternatives: error.alternatives ?? alternatives };
  for (const field of ["conflicting_selectors", "supported_relationships", "path_code"]) {
    if (error[field] !== undefined) details[field] = error[field];
  }
  error.envelope = {
    code: error.code, accepted: false, diagnostic: error.message,
    refusal: inputContractMechanicalRefusal(error.code, error.message, details),
    next_calls: [], recovery: { state: "choice_required", responsible_actor: "caller" }
  };
  return error;
}

export function createCodeIndexQuestionHandler({ selectQuestion, queries, argumentNames, invalidCode,
  alternatives = [], projections, session, workspaceRepos, jsonContent, errorContent,
  preparation = createCodeIndexPreparationGuidance() }) {
  const supported = alternatives.length === 0 ? "" : `. Supported code questions: ${alternatives
    .map((text, index) => `(${index + 1}) ${text}`).join(" ")}`;
  return async (args = {}) => {
    let workspace = null;
    let selected = null, reviewContext = null;
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {

        throw codeQuestionInputError(responseContractError(
          `code-index query does not accept: ${unknown.join(", ")}${supported}`, invalidCode),
        session.route, alternatives);
      }
      if (args.status !== undefined) {
        const others = Object.keys(args).filter((key) => key !== "status" && args[key] !== undefined);
        if (args.status !== true || others.length > 0) {
          throw codeQuestionInputError(responseContractError("status:true is an alternative of its own: it reports the " +
            `published index and accepts no question or detail${args.status !== true ? "" : `; received ${
              others.join(", ")}`}${supported}`, invalidCode), session.route, alternatives);
        }
        workspace = resolveWorkspaceRepo(workspaceRepos);
        const status = await queries.status({ dir: workspace.dir });
        const guidance = await preparation();
        const summary = projections.status(workspace.repo, status, guidance);
        return jsonContent(summary);
      }
      workspace = resolveWorkspaceRepo(workspaceRepos);
      if (args.detail !== undefined) {
        return await readSelectedCodeIndexDetail({ args, session, workspace });
      }
      try {
        selected = selectQuestion(args);
      } catch (error) {
        if (error?.code !== invalidCode && error?.code !== "sidecar_navigation_input_invalid") throw error;
        throw codeQuestionInputError(error, session.route, alternatives);
      }
      reviewContext = session.resolveReviewContext?.();
      return jsonContent(await answerCodeQuestion({ selected, queries, workspace, args, projections,
        session, reviewContext }));
    } catch (error) {
      const selectedRefusal = session.failure(error);
      if (selectedRefusal !== undefined) return selectedRefusal;
      if (error?.code === SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE && workspace !== null) {
        const answer = createCodeIndexUnavailableResponse({ workspaceRepo: workspace.repo,
          route: session.route, args, error, preparation: await preparation() });
        const reviewed = await session.bindReview?.({ workspace, context: reviewContext,
          result: { path: selected?.arguments.path, validated_paths: selected?.arguments.paths } });
        return jsonContent(presentCodeReviewSource(answer, reviewed?.notice, { files: reviewed?.files }));
      }
      return errorContent(error);
    }
  };
}
