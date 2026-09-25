

import { applyEdits, assertDistinctReplacement, namedChildren, parseSource, probeFacts, probeToken,
  unsupported } from "./index.mjs";

export const RUST_OBSERVER_MODULE = "__launcher_test_proof";
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const INTEGER_SUFFIX_RE = /(?:[iu](?:8|16|32|64|128|size))$/u;
const FLOAT_SUFFIX_RE = /(?:f32|f64)$/u;

function rustString(value) {
  let text = "\"";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character === "\"") text += "\\\"";
    else if (character === "\\") text += "\\\\";
    else if (character === "\n") text += "\\n";
    else if (character === "\r") text += "\\r";
    else if (character === "\t") text += "\\t";
    else if (code < 0x20 || code === 0x7f || (code >= 0x2028 && code <= 0x2029)) {
      text += `\\u{${code.toString(16)}}`;
    } else text += character;
  }
  return `${text}"`;
}

function literalValue(node) {
  switch (node.type) {
    case "integer_literal": {
      const suffix = INTEGER_SUFFIX_RE.exec(node.text)?.[0] ?? "";
      const digits = node.text.slice(0, node.text.length - suffix.length).replaceAll("_", "");
      const value = Number(digits);
      if (!Number.isSafeInteger(value)) unsupported("return_literal_unsupported");
      return { value, kind: "integer", suffix };
    }
    case "float_literal": {
      const suffix = FLOAT_SUFFIX_RE.exec(node.text)?.[0] ?? "";
      const value = Number(node.text.slice(0, node.text.length - suffix.length).replaceAll("_", ""));
      if (!Number.isFinite(value)) unsupported("return_literal_unsupported");
      return { value, kind: "float", suffix };
    }
    case "string_literal":
      if (node.text.includes("\\") || !node.text.startsWith("\"")) unsupported("return_literal_unsupported");
      return { value: node.text.slice(1, -1), kind: "string", suffix: "" };
    case "boolean_literal":
      return { value: node.text === "true", kind: "boolean", suffix: "" };
    case "unary_expression": {
      const operand = namedChildren(node)[0];
      if (!node.text.startsWith("-") || !["integer_literal", "float_literal"].includes(operand?.type)) {
        unsupported("return_literal_unsupported");
      }
      const inner = literalValue(operand);
      return { ...inner, value: -inner.value };
    }
    default:
      return unsupported("return_literal_unsupported");
  }
}

const compatible = (original, replacement) => original === replacement ||
  (original === "float" && replacement === "integer");

function rustLiteral(value, original) {
  if (typeof value === "string") return rustString(value);
  if (typeof value === "boolean") return String(value);
  const number = original.kind === "float" && Number.isInteger(value) ? `${value}.0` : String(value);
  return value < 0 ? `-${number.slice(1)}${original.suffix}` : `${number}${original.suffix}`;
}

function modifiers(node) {
  const found = node.children.find(({ type }) => type === "function_modifiers");
  return found === undefined ? [] : found.children.map(({ type }) => type);
}

function mutationTarget(tree, functionName) {
  const declarations = namedChildren(tree.rootNode).filter((node) =>
    node.type === "function_item" && node.childForFieldName("name")?.text === functionName);
  if (declarations.length === 0) unsupported("function_absent");
  if (declarations.length > 1) unsupported("function_not_unique");
  const [declaration] = declarations;
  if (modifiers(declaration).some((type) => ["async", "const"].includes(type))) {
    unsupported("function_not_synchronous");
  }
  if (declaration.childForFieldName("type_parameters") !== null) unsupported("function_generic");
  const body = namedChildren(declaration.childForFieldName("body"));
  if (body.length !== 1) unsupported("body_not_single_scalar_return");
  let literal = body[0];
  if (literal.type === "expression_statement") {
    const [returned] = namedChildren(literal);
    const values = returned?.type === "return_expression" ? namedChildren(returned) : [];
    if (values.length !== 1) unsupported("body_not_single_scalar_return");
    [literal] = values;
  }
  return { declaration, literal };
}

function collectFunctions(node, prefix = [], found = []) {
  for (const child of namedChildren(node)) {
    if (child.type === "function_item") {
      const body = child.childForFieldName("body");
      if (body !== null && !modifiers(child).includes("const")) {
        found.push({ node: child, body, name: child.childForFieldName("name").text,
          line: child.startPosition.row + 1 });
      }
    } else if (child.type === "impl_item" || child.type === "trait_item") {
      const list = child.childForFieldName("body");
      if (list !== null) collectFunctions(list, prefix, found);
    } else if (child.type === "mod_item") {
      const list = child.childForFieldName("body");
      if (list !== null) collectFunctions(list, [...prefix, child.childForFieldName("name").text], found);
    }
  }
  return found;
}

export async function instrumentRustModule({ source, modulePath, mutation = null }) {
  const tree = await parseSource("rust", source);
  const edits = [];
  let mutated = null;
  let mutatedId = null;
  if (mutation !== null) {
    const target = mutationTarget(tree, mutation.function_name);
    const original = literalValue(target.literal);
    const replacementKind = assertDistinctReplacement({ originalKind: original.kind,
      originalValue: original.value, replacement: mutation.replacement, compatible });
    edits.push({ index: target.literal.startIndex,
      remove: target.literal.endIndex - target.literal.startIndex,
      insert: rustLiteral(mutation.replacement, original) });
    mutatedId = target.declaration.id;
    mutated = { function_name: mutation.function_name, line: target.declaration.startPosition.row + 1,
      original: original.value, original_kind: original.kind, replacement: mutation.replacement,
      replacement_kind: replacementKind };
  }
  const functions = collectFunctions(tree.rootNode);
  const probes = functions.map((fn) => {
    const token = probeToken();
    edits.push({ index: fn.body.startIndex + 1,
      insert: ` crate::${RUST_OBSERVER_MODULE}::reach(${rustString(token)});` });
    return probeFacts(token, fn.name, fn.line, fn.node.id === mutatedId);
  });
  return { edits, functions: functions.map(({ name, line }) => ({ name, line })), probes,
    mutation: mutated, source, module_path: modulePath };
}

function attributes(node) {
  const found = [];
  for (let sibling = node.previousNamedSibling; sibling !== null; sibling = sibling.previousNamedSibling) {
    if (sibling.type === "attribute_item") found.push(sibling);
    else if (!["line_comment", "block_comment"].includes(sibling.type)) break;
  }
  return found.map((attribute) => namedChildren(attribute)[0]?.text ?? "");
}

function collectTests(node, prefix = [], found = []) {
  for (const child of namedChildren(node)) {
    if (child.type === "function_item") {
      const attrs = attributes(child);
      if (!attrs.includes("test")) continue;
      const name = child.childForFieldName("name").text;
      const eligible = attrs.every((attr) => attr === "test" || attr === "ignore" ||
          /^allow\(|^cfg_attr\(|^doc\b/u.test(attr)) &&
        modifiers(child).length === 0 && child.childForFieldName("return_type") === null &&
        namedChildren(child.childForFieldName("parameters")).length === 0 &&
        IDENTIFIER_RE.test(name);
      found.push({ node: child, path: [...prefix, name], eligible });
    } else if (child.type === "mod_item") {
      const list = child.childForFieldName("body");
      if (list !== null) collectTests(list, [...prefix, child.childForFieldName("name").text], found);
    }
  }
  return found;
}

export async function instrumentRustTestFile({ source, selected, file }) {
  const tree = await parseSource("rust", source);
  const tests = collectTests(tree.rootNode);
  const selectedPath = selected.join("::");
  const eligible = tests.filter(({ eligible: ok }) => ok);
  if (!eligible.some(({ path }) => path.join("::") === selectedPath)) {
    unsupported(tests.some(({ path }) => path.join("::") === selectedPath)
      ? "selected_test_shape_unsupported" : "selected_test_not_observable", { test: selectedPath });
  }
  const edits = eligible.filter(({ path }) => path.join("::") === selectedPath).map(({ node, path }) => ({
    index: node.childForFieldName("body").startIndex + 1,
    insert: ` let _launcher_test_proof_guard = crate::${RUST_OBSERVER_MODULE}::enter(` +
      `${rustString(file)}, ${rustString(path.join("::"))});`
  }));
  return { edits, tests: eligible.map(({ path }) => path) };
}

export function finishRustFile({ source, edits, crateRoot, channel, nonce, sourceId }) {
  const edited = applyEdits(source, edits);
  if (!crateRoot) return edited;
  return `${edited}${edited.endsWith("\n") ? "" : "\n"}${rustObserverModule({ channel, nonce, sourceId })}`;
}

function rustObserverModule({ channel, nonce, sourceId }) {
  return `
#[doc(hidden)]
#[allow(dead_code, unused, clippy::all)]
pub mod ${RUST_OBSERVER_MODULE} {
    use std::io::Write as _;

    const CHANNEL: &str = ${rustString(channel)};
    const NONCE: &str = ${rustString(nonce)};
    const SOURCE: &str = ${rustString(sourceId)};
    static SEQUENCE: std::sync::Mutex<u64> = std::sync::Mutex::new(0);

    thread_local! {
        static PANIC: std::cell::RefCell<Option<(bool, String)>> = const { std::cell::RefCell::new(None) };
    }

    fn quote(text: &str) -> String {
        let mut quoted = String::from("\\"");
        for character in text.chars() {
            match character {
                '"' => quoted.push_str("\\\\\\""),
                '\\\\' => quoted.push_str("\\\\\\\\"),
                '\\n' => quoted.push_str("\\\\n"),
                '\\r' => quoted.push_str("\\\\r"),
                '\\t' => quoted.push_str("\\\\t"),
                c if (c as u32) < 0x20 => quoted.push_str(&format!("\\\\u{:04x}", c as u32)),
                c => quoted.push(c),
            }
        }
        quoted.push('"');
        quoted
    }

    fn emit(body: String) {
        let mut sequence = match SEQUENCE.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let line = format!("{{\\"v\\":1,\\"nonce\\":{},\\"src\\":{},\\"seq\\":{},{}}}\\n",
            quote(NONCE), quote(SOURCE), *sequence, body);
        if let Ok(mut file) = std::fs::OpenOptions::new().append(true).open(CHANNEL) {
            if file.write_all(line.as_bytes()).is_ok() {
                *sequence += 1;
            }
        }
    }

    fn test_path(path: &str) -> String {
        let parts: Vec<String> = path.split("::").map(quote).collect();
        format!("[{}]", parts.join(","))
    }

    pub fn reach(token: &str) {
        emit(format!("\\"kind\\":\\"reach\\",\\"token\\":{}", quote(token)));
    }

    pub struct Guard {
        file: &'static str,
        path: &'static str,
        active: bool,
    }

    static ENTERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn enter(file: &'static str, path: &'static str) -> Guard {
        if ENTERED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Guard { file, path, active: false };
        }
        static HOOK: std::sync::Once = std::sync::Once::new();
        HOOK.call_once(|| {
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let message = if let Some(text) = info.payload().downcast_ref::<&str>() {
                    text.to_string()
                } else if let Some(text) = info.payload().downcast_ref::<String>() {
                    text.clone()
                } else {
                    String::new()
                };
                let assertion = message.starts_with("assertion");
                PANIC.with(|cell| *cell.borrow_mut() = Some((assertion, message)));
                previous(info);
            }));
        });
        PANIC.with(|cell| *cell.borrow_mut() = None);
        emit(format!("\\"kind\\":\\"test_start\\",\\"file\\":{},\\"test\\":{}", quote(file), test_path(path)));
        Guard { file, path, active: true }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            if !self.active {
                return;
            }
            let failed = std::thread::panicking();
            let (assertion, message) = PANIC.with(|cell| cell.borrow().clone())
                .unwrap_or((false, String::new()));
            let error = if failed {
                format!("{{\\"name\\":\\"panic\\",\\"message\\":{},\\"assertion\\":{}}}", quote(&message), assertion)
            } else {
                String::from("null")
            };
            emit(format!("\\"kind\\":\\"test_result\\",\\"file\\":{},\\"test\\":{},\\"outcome\\":{},\\"assertion_failure\\":{},\\"error\\":{}",
                quote(self.file), test_path(self.path), quote(if failed { "failed" } else { "passed" }),
                failed && assertion, error));
        }
    }
}
`;
}
