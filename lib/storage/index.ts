/**
 * Storage provider selector. STORAGE_PROVIDER=local (default) needs no cloud keys.
 * An S3/R2 adapter drops in behind the same StorageProvider interface later.
 */
import 'server-only';
import type { StorageProvider } from './provider';
import { LocalFsProvider } from './localFs';

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (cached) return cached;
  const which = process.env.STORAGE_PROVIDER ?? 'local';
  switch (which) {
    // case 's3': cached = new S3Provider(); break;   // drops in later (R2 or AWS)
    case 'local':
    default:
      cached = new LocalFsProvider();
  }
  return cached;
}

export type { StorageProvider } from './provider';
