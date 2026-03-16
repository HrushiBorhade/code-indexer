import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { getLanguage } from './languages.ts';
import { createLogger } from '../utils/logger.ts';
import type { CodeSearchResult } from './search.ts';

const log = createLogger('grep');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

interface RipgrepMatch {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

async function grepSearch(
  query: string,
  rootDir: string,
  limit: number = 10,
): Promise<CodeSearchResult[]> {
  log.info(`Grep searching for: "${query}" (limit: ${limit})`);

  const resolvedDir = path.resolve(rootDir);

  let stdout: string;
  try {
    const result = await execFileAsync(
      'rg',
      [
        '--json',
        '--fixed-strings', // treat query as literal, not regex
        '--max-count',
        String(limit * 3), // per-file limit, overfetch for grouping
        '--no-heading',
        '--smart-case',
        '--',
        query,
        resolvedDir,
      ],
      { maxBuffer: MAX_BUFFER },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const exitCode = (err as { code?: number }).code;

    // ripgrep exit code 1 = no matches (not an error)
    if (exitCode === 1) {
      log.info('No grep results found');
      return [];
    }

    // ripgrep not installed or other error
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT')) {
      log.error('ripgrep (rg) not found. Install it: brew install ripgrep');
    } else {
      log.error(`Grep failed: ${message}`);
    }
    return [];
  }

  if (!stdout.trim()) return [];

  // Parse ripgrep JSON lines
  const matches: RipgrepMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type: string };
      if (parsed.type === 'match') {
        matches.push(parsed as RipgrepMatch);
      }
    } catch {
      // skip malformed lines (e.g., summary lines)
    }
  }

  if (matches.length === 0) return [];

  // Group consecutive matches by file into chunks
  const results = groupMatchesIntoResults(matches);

  log.info(`Found ${results.length} grep results`);
  return results.slice(0, limit);
}

function groupMatchesIntoResults(matches: RipgrepMatch[]): CodeSearchResult[] {
  // Group matches by file
  const byFile = new Map<string, RipgrepMatch[]>();
  for (const m of matches) {
    const filePath = m.data.path.text;
    const existing = byFile.get(filePath) ?? [];
    existing.push(m);
    byFile.set(filePath, existing);
  }

  const results: CodeSearchResult[] = [];

  for (const [filePath, fileMatches] of byFile) {
    // Sort by line number
    fileMatches.sort((a, b) => a.data.line_number - b.data.line_number);

    // Group consecutive lines into ranges (within 5 lines of each other)
    const groups: RipgrepMatch[][] = [];
    let currentGroup: RipgrepMatch[] = [fileMatches[0]];

    for (let i = 1; i < fileMatches.length; i++) {
      const prev = currentGroup[currentGroup.length - 1];
      const curr = fileMatches[i];
      if (curr.data.line_number - prev.data.line_number <= 5) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    groups.push(currentGroup);

    // Convert each group to a result
    for (const group of groups) {
      const lineStart = group[0].data.line_number;
      const lineEnd = group[group.length - 1].data.line_number;
      const code = group.map((m) => m.data.lines.text.replace(/\n$/, '')).join('\n');
      const lang = getLanguage(filePath);

      results.push({
        filePath,
        lineStart,
        lineEnd,
        language: lang?.name ?? 'unknown',
        score: 1.0, // grep matches are scored by rank in RRF, not by similarity
        code,
      });
    }
  }

  return results;
}

export { grepSearch };
