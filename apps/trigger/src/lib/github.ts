import { createSign, createPrivateKey } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extract } from 'tar';

function createAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString('base64url');
  const key = createPrivateKey(privateKey);
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function getInstallationToken(installationId: number, appJwt: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CodeIndexer/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function downloadAndExtractTarball(
  fullName: string,
  ref: string,
  token: string,
  destDir: string,
  tarballPath: string,
): Promise<string> {
  // Use redirect: 'manual' to capture the SHA from the redirect Location URL
  // GitHub returns 302 → codeload.github.com/.../{sha}.tar.gz
  const headRes = await fetch(`https://api.github.com/repos/${fullName}/tarball/${ref}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CodeIndexer/1.0',
    },
    redirect: 'manual',
  });

  const location = headRes.headers.get('location') ?? '';
  const shaMatch =
    location.match(/\/([a-f0-9]{40})\.tar\.gz/) ?? location.match(/\/([a-f0-9]{7,40})/);
  const headSha = shaMatch?.[1] ?? 'unknown';

  if (!location) throw new Error(`Tarball download failed: no redirect (status ${headRes.status})`);

  // Follow the redirect and save tarball to disk
  const res = await fetch(location);
  if (!res.ok) throw new Error(`Tarball download failed: ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tarballPath));

  // Extract tarball with strip: 1 to remove GitHub's wrapper directory
  await mkdir(destDir, { recursive: true });
  await extract({ file: tarballPath, cwd: destDir, strip: 1 });

  return headSha;
}

export { createAppJWT, getInstallationToken, downloadAndExtractTarball };
