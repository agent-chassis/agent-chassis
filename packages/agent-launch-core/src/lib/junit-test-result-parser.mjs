

import xml2js from "xml2js";

export const JUNIT_TEST_RESULTS_SCHEMA_VERSION = "junit-test-results.v1";

export const JUNIT_PARSER_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "junit_parser.invalid_input.v1",
  INVALID_XML: "junit_parser.invalid_xml.v1",
  INVALID_REPORT: "junit_parser.invalid_report.v1",
  MISSING_TEST_NAME: "junit_parser.missing_test_name.v1"
});

class JUnitParserError extends Error {
  constructor(code, message, detail, options) {
    super(message, options);
    this.name = "JUnitParserError";
    this.code = code;
    this.detail = detail;
  }
}

const ATTR_KEY = "$";
const CHILD_KEY = "$$";
const TEXT_KEY = "#text";
const NAME_KEY = "#name";
const TEXT_NODE_NAME = "__text__";

const XML_OPTIONS = Object.freeze({
  strict: true,
  async: false,
  xmlns: false,
  explicitRoot: true,
  explicitArray: true,
  explicitChildren: true,
  preserveChildrenOrder: true,
  charsAsChildren: true,
  includeWhiteChars: true,
  mergeAttrs: false,
  ignoreAttrs: false,
  trim: false,
  normalize: false,
  normalizeTags: false,
  attrkey: ATTR_KEY,
  charkey: TEXT_KEY,
  childkey: CHILD_KEY,
  tagNameProcessors: null,
  attrNameProcessors: null,
  attrValueProcessors: null,
  valueProcessors: null,
  validator: null
});

const REPORT_ELEMENTS = new Set(["testsuites", "testsuite", "testcase"]);
const DIAGNOSTIC_KINDS = new Set(["failure", "error", "skipped"]);
const OUTPUT_STREAMS = new Map([["system-out", "stdout"], ["system-err", "stderr"]]);
const DURATION_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function elementPath(frame) {
  const names = [];
  for (let current = frame; current !== null; current = current.parent) {
    names.push(current.name);
  }
  return names.reverse();
}

function invalidReport(reason, frame) {
  return new JUnitParserError(
    JUNIT_PARSER_ERROR_CODES.INVALID_REPORT,
    `JUnit report is not supported: ${reason}`,
    { reason, element: frame.name, path: elementPath(frame) }
  );
}

function invalidXml(reason, position, cause) {
  return new JUnitParserError(
    JUNIT_PARSER_ERROR_CODES.INVALID_XML,
    `JUnit report is not well-formed XML: ${reason}`,
    { reason, line: position.line, column: position.column },
    cause === undefined ? undefined : { cause }
  );
}

function isTextNode(node) {
  return node[NAME_KEY] === TEXT_NODE_NAME &&
    typeof node[TEXT_KEY] === "string" &&
    Object.keys(node).length === 2;
}

function childrenOf(node) {
  return Object.hasOwn(node, CHILD_KEY) ? node[CHILD_KEY] : [];
}

function attribute(node, name) {
  const attributes = Object.hasOwn(node, ATTR_KEY) ? node[ATTR_KEY] : null;
  return attributes !== null && Object.hasOwn(attributes, name) ? attributes[name] : null;
}

function durationSeconds(node) {
  const value = attribute(node, "time");
  if (value === null || !DURATION_PATTERN.test(value)) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function rejectReportElements(node, parent) {
  const pending = [{ node, parent }];
  while (pending.length > 0) {
    const { node: current, parent: currentParent } = pending.pop();
    const frame = { name: current[NAME_KEY], parent: currentParent };
    if (REPORT_ELEMENTS.has(frame.name)) {
      throw invalidReport(`<${frame.name}> is in an unsupported position`, frame);
    }
    const children = childrenOf(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (!isTextNode(children[index])) pending.push({ node: children[index], parent: frame });
    }
  }
}

function leafText(node, frame) {
  let text = "";
  for (const child of childrenOf(node)) {
    if (isTextNode(child)) text += child[TEXT_KEY];
    else rejectReportElements(child, frame);
  }
  return text;
}

function outcomeOf(diagnostics) {
  let status = "passed";
  for (const { kind } of diagnostics) {
    if (kind === "error") return "errored";
    if (kind === "failure") status = "failed";
    else if (status === "passed") status = "skipped";
  }
  return status;
}

function readTestCase(node, frame, suitePath, result) {
  const name = attribute(node, "name");
  if (name === null) {
    throw new JUnitParserError(
      JUNIT_PARSER_ERROR_CODES.MISSING_TEST_NAME,
      "JUnit testcase has no name attribute",
      { suite_path: [...suitePath], test_index: result.tests.length, path: elementPath(frame) }
    );
  }
  const diagnostics = [];
  const output = { stdout: [], stderr: [] };
  for (const child of childrenOf(node)) {
    if (isTextNode(child)) continue;
    const childName = child[NAME_KEY];
    const childFrame = { name: childName, parent: frame };
    if (DIAGNOSTIC_KINDS.has(childName)) {
      diagnostics.push({
        kind: childName,
        message: attribute(child, "message"),
        type: attribute(child, "type"),
        text: leafText(child, childFrame)
      });
    } else if (OUTPUT_STREAMS.has(childName)) {
      output[OUTPUT_STREAMS.get(childName)].push(leafText(child, childFrame));
    } else {
      rejectReportElements(child, frame);
    }
  }
  const status = outcomeOf(diagnostics);
  result.tests.push({
    suite_path: [...suitePath],
    name,
    classname: attribute(node, "classname"),
    file: attribute(node, "file"),
    duration_seconds: durationSeconds(node),
    status,
    diagnostics,
    stdout: output.stdout,
    stderr: output.stderr
  });
  result.counts.total += 1;
  result.counts[status] += 1;
}

function openSuite(node, frame, parentPath, result) {
  const suitePath = [...parentPath, attribute(node, "name")];
  const suite = {
    name: suitePath[suitePath.length - 1],
    suite_path: suitePath,
    duration_seconds: durationSeconds(node),
    stdout: [],
    stderr: []
  };
  result.suites.push(suite);
  return { node, frame, suite, suitePath, index: 0 };
}

function interpretReport(root) {
  const rootFrame = { name: root[NAME_KEY], parent: null };
  if (rootFrame.name !== "testsuites" && rootFrame.name !== "testsuite") {
    throw invalidReport(`root element <${rootFrame.name}> is not a test report`, rootFrame);
  }
  const result = {
    schema_version: JUNIT_TEST_RESULTS_SCHEMA_VERSION,
    suites: [],
    tests: [],
    counts: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 }
  };
  const stack = [rootFrame.name === "testsuite"
    ? openSuite(root, rootFrame, [], result)
    : { node: root, frame: rootFrame, suite: null, suitePath: [], index: 0 }];

  while (stack.length > 0) {
    const container = stack[stack.length - 1];
    const children = childrenOf(container.node);
    if (container.index >= children.length) {
      stack.pop();
      continue;
    }
    const child = children[container.index];
    container.index += 1;
    if (isTextNode(child)) continue;
    const childName = child[NAME_KEY];
    const childFrame = { name: childName, parent: container.frame };
    if (childName === "testcase") {
      readTestCase(child, childFrame, container.suitePath, result);
    } else if (childName === "testsuite") {
      stack.push(openSuite(child, childFrame, container.suitePath, result));
    } else if (container.suite !== null && OUTPUT_STREAMS.has(childName)) {
      container.suite[OUTPUT_STREAMS.get(childName)].push(leafText(child, childFrame));
    } else {
      rejectReportElements(child, container.frame);
    }
  }
  return result;
}

function parseXmlDocument(xmlText) {
  const parser = new xml2js.Parser(XML_OPTIONS);
  const roots = [];
  let failure = null;
  const position = () => ({ line: parser.saxParser.line + 1, column: parser.saxParser.column });
  parser.on("end", (root) => roots.push(root));
  parser.on("error", (error) => {
    failure ??= { error, position: position() };
  });
  try {
    parser.parseString(xmlText);
  } catch (error) {
    failure ??= { error, position: position() };
  }
  if (failure !== null) {
    const reason = String(failure.error?.message ?? failure.error).split("\n", 1)[0];
    throw invalidXml(reason, failure.position, failure.error);
  }
  const unpositioned = { line: null, column: null };
  if (roots.length === 0 || roots[0] === null) {
    throw invalidXml("document has no root element", unpositioned);
  }
  if (roots.length > 1) {
    throw invalidXml("document has more than one root element", unpositioned);
  }
  return Object.values(roots[0])[0];
}

export async function parseJUnitReport(xmlText) {
  if (typeof xmlText !== "string") {
    throw new JUnitParserError(
      JUNIT_PARSER_ERROR_CODES.INVALID_INPUT,
      "JUnit report input must be a string",
      { received_type: xmlText === null ? "null" : typeof xmlText }
    );
  }
  return interpretReport(parseXmlDocument(xmlText));
}
