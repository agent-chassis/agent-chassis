

import { types } from "node:util";

export const JSON_BYTE_MEASUREMENT_LIMITS = Object.freeze({
  maxDepth: 32,
  maxValues: 4096,
  maxStringUnits: 262144
});

export const JSON_BYTE_MEASUREMENT_STATUSES = Object.freeze({
  MEASURED: "measured",
  UNSAFE_VALUE: "unsafe_value",
  BUDGET_EXCEEDED: "budget_exceeded",
  MEASUREMENT_FAILED: "measurement_failed"
});

class MeasurementStop {
  constructor(status) {
    this.status = status;
  }
}

const unsafe = () => new MeasurementStop(JSON_BYTE_MEASUREMENT_STATUSES.UNSAFE_VALUE);
const overBudget = () => new MeasurementStop(JSON_BYTE_MEASUREMENT_STATUSES.BUDGET_EXCEEDED);

function jsonStringBytes(text) {
  let bytes = 2;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c) {
      bytes += 2;
    } else if (unit < 0x20) {
      bytes += unit === 0x08 || unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d ? 2 : 6;
    } else if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isOrdinaryObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function measureJsonBytes(value, limits = JSON_BYTE_MEASUREMENT_LIMITS) {
  const state = { values: 0, stringUnits: 0, ancestors: new Set() };

  const countString = (text) => {
    state.stringUnits += text.length;
    if (state.stringUnits > limits.maxStringUnits) throw overBudget();
    return jsonStringBytes(text);
  };

  const measure = (candidate, depth) => {
    state.values += 1;
    if (state.values > limits.maxValues) throw overBudget();
    if (candidate === null) return 4;
    switch (typeof candidate) {
      case "boolean":
        return candidate ? 4 : 5;
      case "number":
        if (!Number.isFinite(candidate)) throw unsafe();
        return String(candidate).length;
      case "string":
        return countString(candidate);
      case "object":
        break;
      default:
        throw unsafe();
    }
    if (types.isProxy(candidate)) throw unsafe();
    if (depth >= limits.maxDepth) throw overBudget();
    if (state.ancestors.has(candidate)) throw unsafe();
    const isArray = Array.isArray(candidate);
    if (!isArray && !isOrdinaryObject(candidate)) throw unsafe();
    if (isArray && Object.getPrototypeOf(candidate) !== Array.prototype) throw unsafe();

    state.ancestors.add(candidate);
    let bytes = 2;
    if (isArray) {
      const { length } = candidate;
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (descriptor === undefined || !("value" in descriptor)) throw unsafe();
        if (index > 0) bytes += 1;
        bytes += measure(descriptor.value, depth + 1);
      }
    } else {
      let members = 0;
      for (const key of Reflect.ownKeys(candidate)) {
        if (typeof key === "symbol") throw unsafe();
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!("value" in descriptor)) throw unsafe();
        if (!descriptor.enumerable) continue;
        if (key === "toJSON") throw unsafe();
        if (members > 0) bytes += 1;
        members += 1;
        bytes += countString(key) + 1 + measure(descriptor.value, depth + 1);
      }
    }
    state.ancestors.delete(candidate);
    return bytes;
  };

  try {
    const bytes = measure(value, 0);
    return Number.isSafeInteger(bytes)
      ? { status: JSON_BYTE_MEASUREMENT_STATUSES.MEASURED, bytes }
      : { status: JSON_BYTE_MEASUREMENT_STATUSES.BUDGET_EXCEEDED, bytes: null };
  } catch (stop) {
    return {
      status: stop instanceof MeasurementStop
        ? stop.status
        : JSON_BYTE_MEASUREMENT_STATUSES.MEASUREMENT_FAILED,
      bytes: null
    };
  }
}
