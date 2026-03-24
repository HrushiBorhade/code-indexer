import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET!;

async function uploadBuffer(key: string, body: Buffer, contentType = 'application/octet-stream') {
  const client = createR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function uploadFile(key: string, filePath: string) {
  const body = await readFile(filePath);
  await uploadBuffer(key, body);
}

async function uploadRepoFiles(
  repoId: string,
  files: string[],
  cloneDir: string,
  concurrency = 20,
) {
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (file) => {
        const relativePath = path.relative(cloneDir, file);
        await uploadFile(`repos/${repoId}/files/${relativePath}`, file);
      }),
    );
  }
}

function buildFileTree(files: string[], cloneDir: string): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const file of files) {
    const rel = path.relative(cloneDir, file);
    const parts = rel.split(path.sep);
    let node = tree as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = (node[parts[i]] as Record<string, unknown>) || {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = null; // leaf = file
  }
  return tree;
}

export { uploadBuffer, uploadFile, uploadRepoFiles, buildFileTree, createR2Client };
