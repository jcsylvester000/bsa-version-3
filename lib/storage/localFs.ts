/**
 * Local filesystem storage adapter — development backing for the StorageProvider.
 * Files live under a storage root (default: .storage/ in the project, git-ignored).
 * signedUrl() returns a link to our own /api/files route carrying an HMAC token,
 * so downloads are access-controlled exactly like a presigned bucket URL.
 */
import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageProvider, PutParams } from './provider';
import { signKey } from './signtoken';

const ROOT = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), '.storage');

function safeResolve(key: string): string {
  // Prevent path traversal: normalise and ensure the result stays under ROOT.
  const target = path.resolve(ROOT, key);
  const rootResolved = path.resolve(ROOT);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error('Invalid storage key.');
  }
  return target;
}

export class LocalFsProvider implements StorageProvider {
  readonly name = 'local-fs';

  async put({ key, body, contentType }: PutParams): Promise<{ key: string }> {
    const file = safeResolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    // Store the content type alongside so get() can return it.
    await fs.writeFile(`${file}.meta`, contentType, 'utf8');
    return { key };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const file = safeResolve(key);
      const body = await fs.readFile(file);
      const contentType = await fs.readFile(`${file}.meta`, 'utf8').catch(() => 'application/octet-stream');
      return { body, contentType };
    } catch {
      return null;
    }
  }

  async signedUrl(key: string, opts?: { expiresInSeconds?: number; download?: boolean }): Promise<string> {
    const expiresIn = opts?.expiresInSeconds ?? 300; // 5 min default
    // Date.now is fine here (runtime, not a workflow script).
    const token = signKey(key, expiresIn, Math.floor(Date.now() / 1000));
    const params = new URLSearchParams({ key, exp: String(token.exp), sig: token.sig });
    if (opts?.download) params.set('dl', '1');
    return `/api/files?${params.toString()}`;
  }
}
