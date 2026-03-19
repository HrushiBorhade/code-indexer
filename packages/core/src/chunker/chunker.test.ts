import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chunkFile } from './index.ts';
import type { Chunk } from './types.ts';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), 'chunker-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeAndChunk(filename: string, content: string): Promise<Chunk[]> {
  const filePath = path.join(testDir, filename);
  await writeFile(filePath, content);
  return chunkFile(filePath);
}

// ─── AST: TypeScript ────────────────────────────────────

describe('AST chunking — TypeScript', () => {
  it('chunks function declarations', async () => {
    const chunks = await writeAndChunk(
      'math.ts',
      `function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('function add');
    expect(chunks[1].content).toContain('function subtract');
    expect(chunks[0].type).toBe('ast');
    expect(chunks[0].language).toBe('typescript');
  });

  it('chunks class, interface, type alias, enum', async () => {
    const chunks = await writeAndChunk(
      'types.ts',
      `class User {
  name: string;
  constructor(name: string) { this.name = name; }
}

interface Config {
  port: number;
  host: string;
}

type Status = 'active' | 'inactive';

enum Direction {
  Up, Down, Left, Right
}`,
    );

    expect(chunks).toHaveLength(4);
    expect(chunks[0].content).toContain('class User');
    expect(chunks[1].content).toContain('interface Config');
    expect(chunks[2].content).toContain('type Status');
    expect(chunks[3].content).toContain('enum Direction');
  });

  it('chunks export statements', async () => {
    const chunks = await writeAndChunk(
      'lib.ts',
      `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export const VERSION = '1.0.0';`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('export function greet');
    expect(chunks[1].content).toContain('export const VERSION');
  });

  it('provides correct 1-based line numbers', async () => {
    const chunks = await writeAndChunk(
      'lines.ts',
      `function first() {
  return 1;
}

function second() {
  return 2;
}`,
    );

    expect(chunks[0].lineStart).toBe(1);
    expect(chunks[0].lineEnd).toBe(3);
    expect(chunks[1].lineStart).toBe(5);
    expect(chunks[1].lineEnd).toBe(7);
  });

  it('falls back to whole file when no recognized nodes', async () => {
    const chunks = await writeAndChunk('comment.ts', '// just a comment\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('// just a comment');
  });

  it('returns empty array for empty files', async () => {
    const chunks = await writeAndChunk('empty.ts', '');
    expect(chunks).toHaveLength(0);
  });

  it('includes filePath on every chunk', async () => {
    const chunks = await writeAndChunk('paths.ts', 'function foo() { return 1; }');
    for (const chunk of chunks) {
      expect(chunk.filePath).toBe(path.join(testDir, 'paths.ts'));
    }
  });
});

// ─── AST: TSX ───────────────────────────────────────────

describe('AST chunking — TSX', () => {
  it('chunks JSX components correctly', async () => {
    const chunks = await writeAndChunk(
      'App.tsx',
      `export function App() {
  return <div>Hello</div>;
}

export const Greeting = ({ name }: { name: string }) => {
  return <h1>Hello, {name}</h1>;
};`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('export function App');
    expect(chunks[0].content).toContain('<div>');
    expect(chunks[0].language).toBe('tsx');
    expect(chunks[0].type).toBe('ast');
  });
});

// ─── AST: JavaScript ────────────────────────────────────

describe('AST chunking — JavaScript', () => {
  it('chunks functions and classes', async () => {
    const chunks = await writeAndChunk(
      'app.js',
      `function start() {
  console.log('started');
}

class App {
  run() { return true; }
}`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('function start');
    expect(chunks[1].content).toContain('class App');
    expect(chunks[0].language).toBe('javascript');
  });

  it('chunks .mjs files', async () => {
    const chunks = await writeAndChunk('util.mjs', 'export function helper() { return 42; }');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].language).toBe('javascript');
  });
});

// ─── AST: Python ────────────────────────────────────────

describe('AST chunking — Python', () => {
  it('chunks function and class definitions', async () => {
    const chunks = await writeAndChunk(
      'app.py',
      `def greet(name):
    return f"Hello, {name}"

class User:
    def __init__(self, name):
        self.name = name`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('def greet');
    expect(chunks[1].content).toContain('class User');
    expect(chunks[0].language).toBe('python');
  });

  it('chunks decorated definitions', async () => {
    const chunks = await writeAndChunk(
      'routes.py',
      `@app.route("/")
def index():
    return "home"

@app.route("/about")
def about():
    return "about"`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('@app.route("/")');
    expect(chunks[1].content).toContain('@app.route("/about")');
  });
});

// ─── AST: Rust ──────────────────────────────────────────

describe('AST chunking — Rust', () => {
  it('chunks functions, structs, enums, traits', async () => {
    const chunks = await writeAndChunk(
      'lib.rs',
      `fn add(a: i32, b: i32) -> i32 {
    a + b
}

struct Point {
    x: f64,
    y: f64,
}

enum Color {
    Red,
    Green,
    Blue,
}

trait Drawable {
    fn draw(&self);
}`,
    );

    expect(chunks).toHaveLength(4);
    expect(chunks[0].content).toContain('fn add');
    expect(chunks[1].content).toContain('struct Point');
    expect(chunks[2].content).toContain('enum Color');
    expect(chunks[3].content).toContain('trait Drawable');
    expect(chunks[0].language).toBe('rust');
  });

  it('chunks impl blocks', async () => {
    const chunks = await writeAndChunk(
      'point.rs',
      `struct Point { x: f64, y: f64 }

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }
}`,
    );

    expect(chunks.some((c) => c.content.includes('impl Point'))).toBe(true);
  });
});

// ─── AST: Go ────────────────────────────────────────────

describe('AST chunking — Go', () => {
  it('chunks function and type declarations', async () => {
    const chunks = await writeAndChunk(
      'main.go',
      `package main

func add(a int, b int) int {
    return a + b
}

type User struct {
    Name string
    Age  int
}`,
    );

    expect(chunks.some((c) => c.content.includes('func add'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('type User'))).toBe(true);
    expect(chunks[0].language).toBe('go');
  });
});

// ─── AST: CSS ───────────────────────────────────────────

describe('AST chunking — CSS', () => {
  it('chunks rule sets', async () => {
    const chunks = await writeAndChunk(
      'style.css',
      `body {
  margin: 0;
  padding: 0;
}

.container {
  max-width: 1200px;
}`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('body');
    expect(chunks[1].content).toContain('.container');
    expect(chunks[0].language).toBe('css');
  });
});

// ─── Text: Markdown ─────────────────────────────────────

describe('Text chunking — Markdown', () => {
  it('splits on ## headings', async () => {
    const chunks = await writeAndChunk(
      'doc.md',
      `# Title

Introduction text.

## Installation

npm install foo

## Usage

import foo from 'foo'`,
    );

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain('Introduction text');
    expect(chunks[1].content).toContain('npm install foo');
  });

  it('handles markdown with no ## headings', async () => {
    const chunks = await writeAndChunk('simple.md', '# Just a title\n\nSome text.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Just a title');
  });

  it('sets type to text and language to markdown', async () => {
    const chunks = await writeAndChunk('type.md', '## Section\n\nContent');
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].language).toBe('markdown');
  });
});

// ─── Text: JSON ─────────────────────────────────────────

describe('Text chunking — JSON', () => {
  it('returns single chunk for small files', async () => {
    const chunks = await writeAndChunk(
      'small.json',
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('"name"');
  });

  it('splits large files by top-level keys', async () => {
    const largeObj: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 20; i++) {
      largeObj[`section${i}`] = { value: i };
    }
    const chunks = await writeAndChunk('large.json', JSON.stringify(largeObj, null, 2));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles invalid JSON gracefully', async () => {
    const chunks = await writeAndChunk('bad.json', '{ not valid json }}}');
    expect(chunks).toHaveLength(1);
  });
});

// ─── Text: YAML ─────────────────────────────────────────

describe('Text chunking — YAML', () => {
  it('returns single chunk for small files', async () => {
    const chunks = await writeAndChunk('small.yaml', 'name: test\nversion: 1.0.0\n');
    expect(chunks).toHaveLength(1);
  });

  it('splits large files on top-level keys', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`section${i}:`);
      lines.push(`  value: ${i}`);
      lines.push(`  nested:`);
      lines.push(`    deep: true`);
    }
    const chunks = await writeAndChunk('large.yaml', lines.join('\n'));
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ─── Text: TOML ─────────────────────────────────────────

describe('Text chunking — TOML', () => {
  it('returns single chunk for small files', async () => {
    const chunks = await writeAndChunk('config.toml', 'name = "test"\nversion = "1.0.0"\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].language).toBe('toml');
  });
});

// ─── Text: SQL ──────────────────────────────────────────

describe('Text chunking — SQL', () => {
  it('splits on semicolons', async () => {
    const chunks = await writeAndChunk(
      'schema.sql',
      `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id)
);`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('CREATE TABLE users');
    expect(chunks[1].content).toContain('CREATE TABLE orders');
  });
});

// ─── Text: GraphQL ──────────────────────────────────────

describe('Text chunking — GraphQL', () => {
  it('splits on type definitions', async () => {
    const chunks = await writeAndChunk(
      'schema.graphql',
      `type User {
  id: ID!
  name: String!
  email: String!
}

type Post {
  id: ID!
  title: String!
  author: User!
}`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('type User');
    expect(chunks[1].content).toContain('type Post');
    expect(chunks[0].language).toBe('graphql');
  });

  it('splits on query and mutation', async () => {
    const chunks = await writeAndChunk(
      'operations.graphql',
      `query GetUser($id: ID!) {
  user(id: $id) {
    name
    email
  }
}

mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    name
  }
}`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('query GetUser');
    expect(chunks[1].content).toContain('mutation CreateUser');
  });

  it('handles input, enum, and interface', async () => {
    const chunks = await writeAndChunk(
      'types.graphql',
      `input CreateUserInput {
  name: String!
  email: String!
}

enum Role {
  ADMIN
  USER
  GUEST
}

interface Node {
  id: ID!
}`,
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toContain('input CreateUserInput');
    expect(chunks[1].content).toContain('enum Role');
    expect(chunks[2].content).toContain('interface Node');
  });

  it('chunks .gql files too', async () => {
    const chunks = await writeAndChunk('query.gql', 'query Foo { bar }');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].language).toBe('graphql');
  });
});

// ─── Edge cases ─────────────────────────────────────────

describe('chunkFile — edge cases', () => {
  it('returns empty array for unsupported extensions', async () => {
    const chunks = await writeAndChunk('image.png', 'fake image data');
    expect(chunks).toHaveLength(0);
  });

  it('returns empty array for empty files', async () => {
    const chunks = await writeAndChunk('empty.py', '');
    expect(chunks).toHaveLength(0);
  });
});
