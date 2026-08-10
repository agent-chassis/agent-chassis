import { types } from "node:util";

import {
  ExactBindingError,
  assertSchema,
  deepFreeze
} from "./exact-binding-common.mjs";

const BOUNDARY_REQUESTS = new WeakSet();

function refuse(code, message) {
  throw new ExactBindingError(code, message);
}

function snapshotPlainData(value, active, proxyDetector) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse(
      "plain_data_number_invalid", "plain-data numbers must be finite"
    );
    return Object.is(value, -0) ? 0 : value;
  }
  if (["function", "symbol", "bigint", "undefined"].includes(typeof value)) {
    refuse("plain_data_value_invalid", "request contains a non-JSON value");
  }
  if (value === null || typeof value !== "object") {
    refuse("plain_data_value_invalid", "request contains an unsupported value");
  }
  if (proxyDetector(value)) refuse(
    "plain_data_proxy_refused", "proxy carriers are not accepted"
  );
  if (active.has(value)) refuse(
    "plain_data_cycle_refused", "cyclic carriers are not accepted"
  );

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype :
    prototype !== Object.prototype && prototype !== null) {
    refuse("plain_data_prototype_refused", "carrier prototype is not plain");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) refuse(
    "plain_data_symbol_key_refused", "symbol keys are not accepted"
  );
  active.add(value);
  try {
    if (array) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        refuse("plain_data_array_length_invalid", "array length descriptor is invalid");
      }
      const expectedKeys = Array.from(
        { length: lengthDescriptor.value }, (_, index) => String(index)
      );
      const elementKeys = keys.filter((key) => key !== "length");
      if (elementKeys.length !== expectedKeys.length ||
          elementKeys.some((key, index) => key !== expectedKeys[index])) {
        refuse(
          "plain_data_array_shape_refused",
          "sparse arrays and arrays with custom own fields are not accepted"
        );
      }
      const result = new Array(lengthDescriptor.value);
      for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) refuse(
          "plain_data_accessor_refused", "array accessors are not accepted"
        );
        result[Number(key)] = snapshotPlainData(descriptor.value, active, proxyDetector);
      }
      return result;
    }

    const result = prototype === null ? Object.create(null) : {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) refuse(
        "plain_data_accessor_refused",
        "accessors and non-enumerable record fields are not accepted"
      );
      result[key] = snapshotPlainData(descriptor.value, active, proxyDetector);
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function snapshotExactBindingAssessmentRequest(request) {
  assertProxyDetectorAvailable(types);
  const snapshot = deepFreeze(snapshotPlainData(request, new WeakSet(), types.isProxy));
  assertSchema(
    "controlled-contract-exact-binding-assessment-request.v1.schema.json",
    snapshot,
    "exact_binding_assessment_request_invalid"
  );
  BOUNDARY_REQUESTS.add(snapshot);
  return snapshot;
}

function assertProxyDetectorAvailable(runtimeTypes) {
  if (typeof runtimeTypes?.isProxy !== "function") refuse(
    "plain_data_proxy_detector_unavailable",
    "object requests require a non-trapping proxy detector; use serialized JSON"
  );
}

function parseExactBindingAssessmentRequestJson(bytes) {
  if (!(typeof bytes === "string" || Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
    refuse("serialized_request_bytes_invalid", "serialized request must be UTF-8 bytes");
  }
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new ExactBindingError(
      "serialized_request_json_invalid", "serialized request is not valid JSON",
      { cause: error.message }
    );
  }
  const snapshot = deepFreeze(value);
  assertSchema(
    "controlled-contract-exact-binding-assessment-request.v1.schema.json",
    snapshot,
    "exact_binding_assessment_request_invalid"
  );
  BOUNDARY_REQUESTS.add(snapshot);
  return snapshot;
}

function assertBoundaryRequest(request) {
  if (!BOUNDARY_REQUESTS.has(request) || !Object.isFrozen(request) ||
      !Object.isFrozen(request.exactBindingSources)) {
    refuse(
      "exact_binding_boundary_bypassed",
      "downstream capture requires the one frozen whole-request snapshot"
    );
  }
  return request;
}

export {
  assertBoundaryRequest,
  assertProxyDetectorAvailable,
  parseExactBindingAssessmentRequestJson,
  snapshotExactBindingAssessmentRequest
};
