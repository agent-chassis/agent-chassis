

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { isMap, isScalar, parseDocument, visit } from 'yaml';
import { reportedTestFailureLocation } from '../workspace-agent-test-proof-error-diagnostic.mjs';

export function distillCorrection(text) {
  if (typeof text !== 'string') return text;
  const lines = text.split(/\r?\n/u);
  const cause = lines.find(line => stripVTControlCharacters(line).trim().length > 0);
  const corrections = lines.filter(line => /^\s*(?:Correction|Required correction|Fix|Remedy|Action|Expected(?: string| pattern| substring)?|Actual|Received(?: string| pattern| substring)?|Caused by)[\t ]*:\s*\S/iu
    .test(stripVTControlCharacters(line)));
  const startup = lines.filter(line => /Missing X server or \$DISPLAY|without (?:having )?an? XServer|Executable doesn't exist at|error while loading shared libraries|No usable sandbox/u
    .test(stripVTControlCharacters(line)))
    .map(line => line.replace(/^\s*\[pid=\d+\]\[(?:err|out)\]\s*/u, ''));
  if (corrections.length === 0 && startup.length === 0) return text;
  const subjects = lines.filter(line => /^\s*(?:location|error|source|locator)[\t ]*:\s*\S/iu.test(stripVTControlCharacters(line)));

  const headline = /^\s*(?:\w+[\t ]+)*trace[\t ]*:/iu.test(stripVTControlCharacters(cause ?? ''))
    ? subjects.find(line => /^\s*error[\t ]*:/iu.test(stripVTControlCharacters(line))) ?? cause : cause;
  return [...new Set([headline, ...subjects, ...corrections, ...startup])].join('\n') + (text.endsWith('\n') ? '\n' : '');
}

const unavailable = reason => ({ state: 'unavailable', reason,
  uncertainty: 'The native process outcome stands; this capture does not establish the failing assertion or its cause.',
  stopping_condition: 'Do not infer a cause from other output or execute again merely to recover this historical diagnosis.' });

function diagnosed(failures, reason) {
  if (!failures.some(row => row.error !== undefined)) return {
    ...unavailable(reason ?? 'native_failure_report_unavailable'),
    ...(failures.length === 0 ? {} : { failures }) };
  return { state: reason === undefined ? 'captured' : 'partial', failures,
    ...(reason === undefined ? {} : { reason,
      uncertainty: 'These diagnoses were reported; other failing causes or error relationships could not be decoded.' }) };
}

function checkoutRoot(identity) {
  const cwd = identity?.invocation?.cwd;
  const project = identity?.project;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || typeof project !== 'string') return undefined;
  return project === '.' ? cwd : path.resolve(cwd, ...project.split('/').map(() => '..'));
}

function testLocation(value, root) {
  if (typeof value !== 'string') return undefined;
  const match = /^(.*):(\d+):(\d+)$/u.exec(value);
  if (match === null) return undefined;
  let file = match[1];
  if (file.startsWith('file://')) {
    try { file = fileURLToPath(file); } catch { return undefined; }
  }
  if (root !== undefined && path.isAbsolute(file)) {
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    file = relative.split(path.sep).join('/');
  }
  return { file, line: Number(match[2]), column: Number(match[3]) };
}

function operand(node) {
  if (!isScalar(node)) return { format: 'native_yaml', display: node.toString() };
  if (node.type === 'PLAIN' && node.source === 'undefined') return { type: 'undefined' };
  if (node.type === 'PLAIN' && /^-?\d+n$/u.test(node.source)) return { type: 'bigint', value: node.source.slice(0, -1) };
  if (typeof node.value === 'number' && !Number.isFinite(node.value)) return {
    type: 'nonfinite_number', value: String(node.value) };
  if (typeof node.value === 'number' && Number.isInteger(node.value) && !Number.isSafeInteger(node.value)) {
    return { format: 'native_yaml', display: node.source };
  }
  return node.value;
}

function failureMeaning(document, name, root) {
  if (!isMap(document.contents)) return null;
  const field = key => document.get(key);
  const kind = field('failureType');
  if (typeof kind !== 'string') return null;

  if (kind === 'subtestsFailed') return { aggregate: true };
  const message = field('error');
  if (typeof message !== 'string' || message.length === 0) return null;
  const location = testLocation(field('location'), root);
  const stack = field('stack');
  const throwLocation = typeof stack !== 'string' ? undefined : reportedTestFailureLocation(undefined,
    stack.split('\n').map(line => `    at ${line.trim().replace(/^at /u, '')}`), root);
  const error = { message };
  for (const [source, target] of [['errorType', 'name'], ['code', 'code'], ['operator', 'operator']]) {
    if (typeof field(source) === 'string') error[target] = field(source);
  }
  if (throwLocation !== undefined) error.location = throwLocation;
  for (const key of ['expected', 'actual']) {
    if (document.has(key)) error[key] = operand(document.get(key, true));
  }
  return { test: { name, ...(location === undefined ? {} : { location }) },
    failure_type: kind, error };
}

function nodeTapDiagnosis(text, identity) {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  if (lines[0] !== 'TAP version 13') return unavailable('native_failure_report_unavailable');
  const failures = [];
  let incomplete = !lines.some(line => /^1\.\.\d+\s*$/u.test(line));
  let unreadable = false;
  for (let index = 1; index < lines.length; index++) {
    const verdict = /^( *)not ok \d+ - (.+)$/u.exec(lines[index]);
    if (verdict === null) continue;
    if (/ # (?:TODO|SKIP)(?:\s|$)/iu.test(verdict[2])) continue;

    const indent = `${verdict[1]}  `;
    const missing = reason => failures.push({ test: { name: verdict[2] }, diagnosis_unavailable: reason });
    if (lines[index + 1] !== `${indent}---`) {
      incomplete = true; missing('native_failure_report_incomplete'); continue;
    }
    let end = index + 2;
    while (end < lines.length && lines[end] !== `${indent}...`) end++;
    if (end === lines.length || lines.slice(index + 2, end).some(line => line !== '' && !line.startsWith(indent))) {
      incomplete = true; missing('native_failure_report_incomplete'); continue;
    }
    const document = parseDocument(lines.slice(index + 2, end).map(line => line.slice(indent.length)).join('\n'),
      { prettyErrors: false, uniqueKeys: true });

    let aliases = false;
    visit(document, { Alias() { aliases = true; } });
    if (document.errors.length || document.warnings.length || aliases) {
      unreadable = true; missing('native_failure_report_unreadable'); index = end; continue;
    }
    const meaning = failureMeaning(document, verdict[2], checkoutRoot(identity));
    if (meaning === null) { unreadable = true; missing('native_failure_report_unreadable'); }
    else if (!meaning.aggregate) failures.push(meaning);
    index = end;
  }
  return diagnosed(failures, incomplete ? 'native_failure_report_incomplete'
    : unreadable ? 'native_failure_report_unreadable' : undefined);
}

function inspectedOperand(text) {
  if (text === 'undefined') return { type: 'undefined' };
  if (text === 'null') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+n$/u.test(text)) return { type: 'bigint', value: text.slice(0, -1) };
  if (['NaN', 'Infinity', '-Infinity'].includes(text)) return { type: 'nonfinite_number', value: text };
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) {
      return Object.is(value, -0) ? { type: 'negative_zero' } : value;
    }
  }
  const quoted = /^'([^'\\]*)'$/su.exec(text);
  if (quoted !== null) return quoted[1];
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  return { format: 'node_inspect', display: text };
}

function nodeSpecDiagnosis(text, identity) {
  const marker = '\n✖ failing tests:\n';

  const at = text.lastIndexOf(marker);
  if (at < 0) return unavailable('native_failure_report_unavailable');
  const blocks = [...text.slice(at + marker.length).matchAll(
    /^test at (.+)\n✖ (.+) \([\d.]+m?s\)\n([\s\S]*?)(?=^test at |$(?![\s\S]))/gmu)];
  const failures = [];
  let incomplete = blocks.length === 0;
  for (const block of blocks) {
    const lines = block[3].trimEnd().split('\n');
    const root = checkoutRoot(identity);
    const declaration = testLocation(block[1], root);
    const subject = { name: block[2], ...(declaration === undefined ? {} : { location: declaration }) };
    const missing = () => {
      incomplete = true;
      failures.push({ test: subject, diagnosis_unavailable: 'native_failure_report_incomplete' });
    };
    const header = /^  ([A-Za-z_$][\w$.]*)(?: \[([^\]\s]+)\])?: (.*)$/u.exec(lines[0]);

    if (header === null) { missing(); continue; }
    const frame = lines.findIndex(line => /^ {6}at /u.test(line));
    if (frame < 0) { missing(); continue; }
    const message = [header[3], ...lines.slice(1, frame).map(line => line.replace(/^  /u, ''))].join('\n').trimEnd();
    const error = { name: header[1], message, ...(header[2] === undefined ? {} : { code: header[2] }) };
    const location = reportedTestFailureLocation(undefined, lines.filter(line => /^ {6}at /u.test(line))
      .map(line => line.slice(2)), root);
    if (location !== undefined) error.location = location;
    const propertyBlock = lines.some(line => /^ {6}at /u.test(line) && line.endsWith(' {'));
    if (propertyBlock && lines.at(-1) !== '  }') {
      incomplete = true;
      failures.push({ test: subject, error });
      continue;
    }
    if (!propertyBlock && lines.slice(frame).some(line => line.trim() !== '' && !/^ {6}at /u.test(line))) incomplete = true;
    for (let index = frame; index < lines.length - 1; index++) {
      const property = /^ {4}(code|operator|expected|actual): (.*)$/u.exec(lines[index]);
      if (property === null) continue;
      let end = index + 1;
      while (end < lines.length - 1 && !/^ {4}\S[^\n]*: /u.test(lines[end])) end++;
      const value = [property[2], ...lines.slice(index + 1, end)].join('\n').replace(/,$/u, '');
      const decoded = inspectedOperand(value);
      if (['code', 'operator'].includes(property[1])) {
        if (typeof decoded === 'string') error[property[1]] = decoded;
        else incomplete = true;
      } else error[property[1]] = decoded;
      index = end - 1;
    }

    const causeAt = lines.findIndex(line => /^ {4}\[cause\]: /u.test(line));
    if (causeAt >= 0) {
      const cause = /^ {4}\[cause\]: ([A-Za-z_$][\w$.]*)(?: \[([^\]\s]+)\])?: (.*)$/u.exec(lines[causeAt]);
      if (cause !== null) error.cause = { name: cause[1], message: cause[3],
        ...(cause[2] === undefined ? {} : { code: cause[2] }) };
      incomplete = true;
    }
    if (lines.some(line => /^ {4}\[errors\]:/u.test(line))) incomplete = true;
    failures.push({ test: subject, error });
  }
  return diagnosed(failures, incomplete ? 'native_failure_report_incomplete' : undefined);
}

function goDiagnosis(result) {
  const text = stripVTControlCharacters(result.run.stdout ?? '').replace(/\r\n/gu, '\n');
  const stderr = stripVTControlCharacters(result.run.stderr ?? '').replace(/\r\n/gu, '\n');
  const reports = [...text.matchAll(/^(FAIL|ok|\?)[\t ]+(\S+)[^\n]*(?:\n|$)/gmu)];
  const bindPackage = (row, name) => row.test.name === name ? row : { ...row, test: { ...row.test, package: name } };
  if (reports.length <= 1) {
    const diagnosis = goPackageDiagnosis(result, text, stderr);
    if (reports.length === 1 && result.identity?.command_harness !== undefined && diagnosis.failures) return {
      ...diagnosis, failures: diagnosis.failures.map(row => bindPackage(row, reports[0][2])) };
    return diagnosis;
  }

  const failures = [];
  let start = 0;
  let incomplete = false;
  const stderrBlocks = [...stderr.matchAll(/^# (\S+)[^\n]*\n([\s\S]*?)(?=^# |$(?![\s\S]))/gmu)];
  for (const report of reports) {
    const end = report.index + report[0].length;
    if (report[1] === 'FAIL') {
      const ownStderr = stderrBlocks.filter(block => block[1] === report[2]).map(block => block[0]).join('');
      const diagnosis = goPackageDiagnosis(result, text.slice(start, end), ownStderr);
      if (diagnosis.state !== 'captured') incomplete = true;
      const rows = diagnosis.failures ?? [{ test: { name: report[2] }, diagnosis_unavailable: diagnosis.reason }];
      failures.push(...rows.map(row => bindPackage(row, report[2])));
    }
    start = end;
  }
  if (/^--- FAIL:|^=== RUN/mu.test(text.slice(start))) incomplete = true;
  return diagnosed(failures, incomplete ? 'go_failure_attribution_incomplete' : undefined);
}

function goPackageDiagnosis(result, text, stderr) {
  const root = checkoutRoot(result.identity);
  const cwd = result.identity?.invocation?.cwd;
  const location = (file, line, column) => {

    if (!path.isAbsolute(file) && result.identity?.command_harness !== undefined) return {
      file, line: Number(line), ...(column === undefined ? {} : { column: Number(column) }), scope: 'package_relative' };
    const absolute = path.isAbsolute(file) || typeof cwd !== 'string' ? file : path.resolve(cwd, file);
    const relative = root === undefined ? absolute.replace(/^\.\//u, '') : path.relative(root, absolute).split(path.sep).join('/');
    if (relative.startsWith('../') || relative === '..') return undefined;
    return { file: relative, line: Number(line), ...(column === undefined ? {} : { column: Number(column) }) };
  };
  const sourceLine = /^(.*?\.go):(\d+)(?::(\d+))?:\s*(.*)$/u;

  if (/^FAIL[\t ]+\S+.*\[(?:build|setup) failed\]/mu.test(text)) {
    const subject = /^# (\S+)/mu.exec(stderr)?.[1] ?? /^FAIL[\t ]+(\S+)/mu.exec(text)?.[1];
    const setup = /\[setup failed\]/u.test(text);
    const failures = stderr.split('\n').flatMap(line => {
      const match = sourceLine.exec(line);
      if (match === null || /^\s/u.test(line)) return [];
      const at = location(match[1], match[2], match[3]);
      return [{ test: { name: subject }, failure_type: 'compilation',
        error: { message: match[4], ...(at === undefined ? {} : { location: at }) } }];
    });
    if (setup && failures.length === 0 && subject !== undefined) {
      const own = /^# \S+[^\n]*\n([\s\S]*?)(?=^# |$(?![\s\S]))/mu.exec(stderr)?.[1].trim();
      if (own) failures.push({ test: { name: subject }, failure_type: 'setup', error: { message: distillCorrection(own) } });
    }
    return diagnosed(failures, failures.length ? undefined : 'go_build_diagnosis_unavailable');
  }

  const verbose = /^=== RUN\s+/mu.test(text);
  const tests = new Map();
  const row = name => {
    if (!tests.has(name)) tests.set(name, { name, failed: false, messages: [] });
    return tests.get(name);
  };
  let active = null;
  for (const line of text.split('\n')) {
    const context = /^=== (RUN|CONT|NAME|PAUSE)\s+(.+?)\s*$/u.exec(line);
    if (context !== null) {
      active = context[1] === 'PAUSE' ? null : row(context[2]);
      continue;
    }
    const verdict = /^\s*--- (FAIL|PASS|SKIP): (.+?) \([\d.]+s\)\s*$/u.exec(line);
    if (verdict !== null) {
      const selected = row(verdict[2]);
      selected.failed = verdict[1] === 'FAIL';
      if (!verbose) active = selected;
      else if (active === selected) active = null;
      continue;
    }
    if (active === null || !/^ {4}/u.test(line)) continue;
    const reported = sourceLine.exec(line.trimStart());
    if (reported !== null) {
      const at = location(reported[1], reported[2], reported[3]);
      active.messages.push({ message: reported[4], ...(at === undefined ? {} : { location: at }) });
    } else if (/^ {8}/u.test(line) && active.messages.length) {
      active.messages.at(-1).message += `\n${line.slice(8)}`;
    }
  }
  const failed = [...tests.values()].filter(row => row.failed);

  const panic = /^panic: (.+)$/mu.exec(text);
  let panicked;
  if (panic !== null && /^goroutine \d+ \[/mu.test(text) && /^testing\.tRunner/mu.test(text)) {
    const frames = [...text.matchAll(/^([^\n]+)\n\s+([^\n]+\.go):(\d+)(?: \+[^\n]+)?$/gmu)];
    const matches = failed.flatMap(test => {
      const name = test.name.split('/')[0];
      const frame = frames.find(frame => frame[1].includes(`.${name}(`) || frame[1].includes(`.${name}.func`));
      const at = frame === undefined ? undefined : location(frame[2], frame[3]);
      return at === undefined ? [] : [{ test, at }];
    });
    if (matches.length === 1) panicked = matches[0];
  }
  const failures = failed.flatMap(test => {
    if (panicked?.test === test) return [{ test: { name: test.name }, failure_type: 'panic',
      error: { message: panic[1].replace(/ \[recovered(?:, repanicked)?\]$/u, ''), location: panicked.at } }];
    const message = row => {

      const reported = [...row.message.matchAll(/(\/[^\s]+\.go):(\d+)(?::(\d+))?/gu)]
        .filter(match => path.basename(match[1]) === path.basename(row.location?.file ?? '') && Number(match[2]) === row.location?.line);
      const at = reported.length === 1 ? location(reported[0][1], reported[0][2], reported[0][3]) : undefined;
      return { ...row, ...(at === undefined ? {} : { location: at }), message: distillCorrection(row.message) };
    };
    if (test.messages.length) return [{ test: { name: test.name }, failure_type: 'go_test_failure',
      error: message(test.messages[0]),
      ...(test.messages.length > 1 ? { additional_diagnostics: test.messages.slice(1).map(row =>
        message(row)),
        uncertainty: 'Go does not distinguish failure messages from logs owned by this failed test.' } : {}) }];

    if (failed.some(child => child !== test && child.name.startsWith(`${test.name}/`))) return [];
    return [{ test: { name: test.name }, diagnosis_unavailable: 'go_failure_diagnostic_unavailable' }];
  });
  if (!failures.length) return unavailable('go_failure_report_unavailable');
  const complete = /^FAIL[\t ]+\S+/mu.test(text);
  return diagnosed(failures, !complete ? 'go_failure_report_incomplete'
    : failures.some(row => row.diagnosis_unavailable) || (panic !== null && panicked === undefined)
      ? 'go_failure_attribution_incomplete' : undefined);
}

export function ordinaryTestSemanticDiagnosis(result) {
  if (result === null || result === undefined || result.ok === true) return null;
  if (result.run?.ran === false && result.run.blocker_code === 'test_proof_native_runner_launch_failed' &&
      result.identity?.invocation !== undefined) {
    const { command, args, cwd } = result.identity.invocation;
    return diagnosed([{ operation: { command, arguments: args, cwd: result.identity.command_harness?.cwd ?? cwd }, failure_type: 'launch',
      error: { code: result.run.blocker_code, message: result.run.blocker_message ?? result.run.spawn_error },
      stopping_condition: 'The command did not start. Correct the launch prerequisite before an explicit retry; the reported error alone may not identify which prerequisite is missing.' }]);
  }
  if (result.status !== 'executed' || result.run?.ran !== true) return null;
  if (result.run.timed_out === true || result.run.cancelled === true) return unavailable('execution_interrupted');
  if (result.run.output_truncated === true) return unavailable('native_failure_capture_incomplete');
  const command = result.identity?.command_harness?.argv;
  if (result.identity?.runner === 'go-test' || (Array.isArray(command) &&
      path.basename(command[0] ?? '') === 'go' && command[1] === 'test')) return goDiagnosis(result);
  const nodeCommand = Array.isArray(command) && ['node', 'nodejs'].includes(path.basename(command[0] ?? '')) &&
    command[1] === '--test';
  if (result.identity?.runner !== 'node-test' && !nodeCommand) return unavailable('native_failure_report_unsupported');
  if (typeof result.run.stdout !== 'string' || result.run.stdout.length === 0) return unavailable('native_failure_capture_unavailable');
  const text = stripVTControlCharacters(result.run.stdout).replace(/\r\n/gu, '\n');
  return text.startsWith('TAP version 13\n') ? nodeTapDiagnosis(text, result.identity) : nodeSpecDiagnosis(text, result.identity);
}
