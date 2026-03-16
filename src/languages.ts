import path from 'node:path';

interface LanguageEntry {
  name: string;
  type: 'ast' | 'text';
  extensions: string[];
}

const LANGUAGES: LanguageEntry[] = [
  { name: 'typescript', type: 'ast', extensions: ['.ts'] },
  { name: 'tsx', type: 'ast', extensions: ['.tsx'] },
  { name: 'javascript', type: 'ast', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { name: 'python', type: 'ast', extensions: ['.py'] },
  { name: 'rust', type: 'ast', extensions: ['.rs'] },
  { name: 'go', type: 'ast', extensions: ['.go'] },
  { name: 'css', type: 'ast', extensions: ['.css'] },
  { name: 'graphql', type: 'text', extensions: ['.graphql', '.gql'] },
  { name: 'markdown', type: 'text', extensions: ['.md', '.mdx'] },
  { name: 'json', type: 'text', extensions: ['.json'] },
  { name: 'yaml', type: 'text', extensions: ['.yaml', '.yml'] },
  { name: 'toml', type: 'text', extensions: ['.toml'] },
  { name: 'sql', type: 'text', extensions: ['.sql'] },
];

const LANGUAGE_MAP = new Map<string, LanguageEntry>();

for (const entry of LANGUAGES) {
  for (const extension of entry.extensions) {
    LANGUAGE_MAP.set(extension, entry);
  }
}

const AST_LANGUAGES = new Set(LANGUAGES.filter((l) => l.type === 'ast').map((l) => l.name));

const TEXT_LANGUAGES = new Set(LANGUAGES.filter((l) => l.type === 'text').map((l) => l.name));

function getLanguage(filepath: string): LanguageEntry | undefined {
  const extension = path.extname(filepath);
  return LANGUAGE_MAP.get(extension);
}

function getSupportedExtensions(): string[] {
  return [...LANGUAGE_MAP.keys()];
}

export { LANGUAGE_MAP, AST_LANGUAGES, TEXT_LANGUAGES, getLanguage, getSupportedExtensions };
export type { LanguageEntry };
