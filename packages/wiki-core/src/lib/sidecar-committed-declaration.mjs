import { Parser } from "web-tree-sitter";
import { loadTreeSitterProvider, providerDescriptorForLanguage } from "./sidecar-graph-import-facts.mjs";
import { sidecarLanguageForPath } from "./sidecar-language-descriptions.mjs";

export async function resolveCommittedSourceSymbol({ path: sourcePath, symbol, source_text }) {
  const provider = await loadTreeSitterProvider();
  const languageKey = sidecarLanguageForPath(sourcePath);
  const language = provider.languages?.get(languageKey);
  if (!provider.available || !language) return { state: 'unavailable', code: 'description_symbol_parser_unavailable',
    reason: provider.reason ?? 'unsupported_language' };
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source_text);
    if (!tree || tree.rootNode.hasError) return { state: 'unavailable', code: 'description_source_parse_error' };
    const candidates = [];
    const unsupportedBindings = [];
    const declarationTypes = new Set(['function_declaration', 'generator_function_declaration', 'class_declaration',
      'variable_declarator', 'method_definition', 'field_definition', 'function_definition', 'class_definition', 'assignment',
      'method_declaration', 'type_spec', 'var_spec', 'const_spec', 'function_item', 'struct_item', 'enum_item',
      'const_item', 'static_item', 'type_item', 'mod_item']);
    const staticValue = node => {
      if (!node) return false;
      if (['number', 'integer', 'float', 'string', 'true', 'false', 'null', 'none', 'boolean_literal',
        'integer_literal', 'float_literal', 'string_literal'].includes(node.type)) return true;
      if (['array', 'list', 'tuple', 'object', 'dictionary', 'pair', 'parenthesized_expression'].includes(node.type))
        return node.namedChildren.every(child => child.type === 'property_identifier' || staticValue(child));
      if (node.type === 'unary_expression') return /^[-+]\s*\d/u.test(node.text) && node.namedChildren.every(staticValue);
      return false;
    };
    const visit = (node, owners = []) => {
      const nameNode = declarationTypes.has(node.type) ? node.childForFieldName('name') ?? node.childForFieldName('left') : null;
      const name = nameNode && ['identifier', 'type_identifier', 'property_identifier', 'field_identifier'].includes(nameNode.type) ? nameNode.text : null;
      const qualified = name === null ? owners : [...owners, name];
      if (['object_pattern', 'array_pattern', 'import_specifier', 'namespace_import', 'export_specifier'].includes(node.type) &&
        node.namedChildren.some(child => child.text === symbol)) unsupportedBindings.push(node.text);
      if (name !== null && (symbol === name || symbol === qualified.join('.') || symbol === qualified.join('::'))) {
        const value = node.childForFieldName('value') ?? node.childForFieldName('right');
        let statement = node.type === 'variable_declarator' ? node.parent : node;
        if (statement.parent?.type === 'export_statement') statement = statement.parent;
        const callable = ['function_declaration', 'generator_function_declaration', 'function_definition', 'function_item',
          'method_definition', 'method_declaration'].includes(node.type) || ['arrow_function', 'function_expression'].includes(value?.type);
        const meanings = ['subject', 'object'];
        if (callable) meanings.push('behavior');
        if (staticValue(value)) meanings.push('value', 'structure');
        if (staticValue(value) && ['array', 'list', 'tuple'].includes(value.type)) meanings.push('population');
        candidates.push({ path: sourcePath, symbol: qualified.join('.'), declaration_kind: node.type,
          name_line: nameNode.startPosition.row + 1,
          start_line: statement.startPosition.row + 1, end_line: statement.endPosition.row + 1,
          source_text: statement.text, defined_meanings: meanings });
      }
      for (const child of node.namedChildren) visit(child, qualified);
    };
    visit(tree.rootNode);
    const provenance = providerDescriptorForLanguage(languageKey);
    if (!candidates.length && unsupportedBindings.length) return { state: 'unavailable', code: 'description_symbol_binding_unsupported',
      bindings: unsupportedBindings, provider: provenance };
    return candidates.length === 1 ? { state: 'resolved', definition: candidates[0], provider: provenance }
      : { state: candidates.length ? 'ambiguous' : 'missing',
        code: candidates.length ? 'description_symbol_ambiguous' : 'description_symbol_missing', candidates, provider: provenance };
  } finally {
    tree?.delete();
    parser.delete();
  }
}
