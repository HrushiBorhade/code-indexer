import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Chunk } from './types.ts';
import { fallbackChunk } from './fallback.ts';
import { createLogger } from '../utils/logger.ts';

const log = createLogger('chunker');

// --- WASM initialization ---
// web-tree-sitter types use `declare module` pattern which doesn't play well
// with nodenext resolution. We use a typed wrapper to keep things clean.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ParserClass: any;
let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized) return;
  const mod = await import('web-tree-sitter');
  ParserClass = mod.default;
  await ParserClass.init();
  initialized = true;
}

// --- Grammar loading (WASM files from tree-sitter-wasms package) ---

const require = createRequire(import.meta.url);
const wasmsDir = resolve(require.resolve('tree-sitter-wasms/package.json'), '..', 'out');

const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  go: 'tree-sitter-go.wasm',
  css: 'tree-sitter-css.wasm',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const languages = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLanguage(language: string): Promise<any | undefined> {
  if (languages.has(language)) return languages.get(language)!;

  const file = GRAMMAR_FILES[language];
  if (!file) return undefined;

  const wasmPath = resolve(wasmsDir, file);
  const lang = await ParserClass.Language.load(wasmPath);
  languages.set(language, lang);
  return lang;
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

// --- AST chunking (async — requires WASM init + language loading) ---

async function chunkAST(source: string, filePath: string, language: string): Promise<Chunk[]> {
  await ensureInit();

  const lang = await getLanguage(language);
  if (!lang) {
    log.warn(`No tree-sitter grammar for "${language}", using fallback: ${filePath}`);
    return [fallbackChunk(source, filePath, language)];
  }

  const nodeTypes = AST_NODE_TYPES[language];
  if (!nodeTypes) {
    log.warn(`No AST node types configured for "${language}", using fallback: ${filePath}`);
    return [fallbackChunk(source, filePath, language)];
  }

  const parser = new ParserClass();
  parser.setLanguage(lang);

  try {
    const tree = parser.parse(source);

    try {
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
        log.warn(`AST parsed but found 0 matching nodes for "${language}" in: ${filePath}`);
        return [fallbackChunk(source, filePath, language)];
      }

      return chunks;
    } finally {
      tree.delete();
    }
  } catch (err: unknown) {
    log.error(
      `tree-sitter parse failed for ${filePath}: ${err instanceof Error ? err.message : err}`,
    );
    return [fallbackChunk(source, filePath, language)];
  } finally {
    parser.delete();
  }
}

export { chunkAST };
