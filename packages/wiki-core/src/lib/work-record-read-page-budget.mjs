

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function fitReadPagePopulation(maximum, build, budgetBytes) {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new TypeError("fitReadPagePopulation maximum must be a nonnegative safe integer");
  }
  if (typeof build !== "function") {
    throw new TypeError("fitReadPagePopulation build must be a function");
  }
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    throw new TypeError("fitReadPagePopulation budgetBytes must be a positive safe integer");
  }
  if (maximum === 0) return build(0);
  let low = 1;
  let high = maximum;
  let accepted = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = build(middle);
    if (serializedBytes(candidate) <= budgetBytes) {
      accepted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return accepted ?? build(1);
}
