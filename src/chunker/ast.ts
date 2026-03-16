import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import Rust from 'tree-sitter-rust';
import Go from 'tree-sitter-go';
import CSS from 'tree-sitter-css';
import type { Chunk } from './types.ts';
import { fallbackChunk } from './fallback.ts';

// --- Parser cache (one parser per language, reused) ---

const parsers = new Map<string, Parser>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GRAMMARS: Record<string, any> = {
  typescript: TypeScript.typescript,
  tsx: TypeScript.tsx,
  javascript: JavaScript,
  python: Python,
  rust: Rust,
  go: Go,
  css: CSS,
};

function getParser(language: string): Parser | undefined {
  if (parsers.has(language)) return parsers.get(language)!;

  const grammar = GRAMMARS[language];
  if (!grammar) return undefined;

  const parser = new Parser();
  parser.setLanguage(grammar);
  parsers.set(language, parser);
  return parser;
}

// --- Top-level node types to extract per language ---

const TS_NODE_TYPES = new Set([
  'function_declaration',
  'class_declaration',
  'lexical_declaration',
  'export_statement',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
]);

const AST_NODE_TYPES: Record<string, Set<string>> = {
  typescript: TS_NODE_TYPES,
  tsx: TS_NODE_TYPES,
  javascript: new Set([
    'function_declaration',
    'class_declaration',
    'lexical_declaration',
    'export_statement',
  ]),
  python: new Set(['function_definition', 'class_definition', 'decorated_definition']),
  rust: new Set(['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item']),
  go: new Set(['function_declaration', 'method_declaration', 'type_declaration']),
  css: new Set(['rule_set', 'media_statement', 'keyframes_statement']),
};

// --- AST chunking ---

function chunkAST(source: string, filePath: string, language: string): Chunk[] {
  const parser = getParser(language);
  if (!parser) {
    console.warn(`[chunker] No tree-sitter grammar for "${language}", using fallback: ${filePath}`);
    return [fallbackChunk(source, filePath, language)];
  }

  const nodeTypes = AST_NODE_TYPES[language];
  if (!nodeTypes) {
    console.warn(
      `[chunker] No AST node types configured for "${language}", using fallback: ${filePath}`,
    );
    return [fallbackChunk(source, filePath, language)];
  }

  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (err: unknown) {
    console.error(
      `[chunker] tree-sitter parse failed for ${filePath}: ${err instanceof Error ? err.message : err}`,
    );
    return [fallbackChunk(source, filePath, language)];
  }

  const chunks: Chunk[] = [];

  for (const node of tree.rootNode.children) {
    if (!nodeTypes.has(node.type)) continue;

    const content = node.text.trim();
    if (content.length === 0) continue;

    chunks.push({
      content,
      filePath,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      language,
      type: 'ast',
    });
  }

  if (chunks.length === 0 && source.trim().length > 0) {
    console.warn(
      `[chunker] AST parsed but found 0 matching nodes for "${language}" in: ${filePath}`,
    );
    return [fallbackChunk(source, filePath, language)];
  }

  return chunks;
}

export { chunkAST };
