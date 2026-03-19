interface Chunk {
  content: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: string;
  type: 'ast' | 'text';
}

export type { Chunk };
