/**
 * Storage provider interface — the app depends on THIS, never on a concrete SDK.
 *
 * Reports and intake files are stored behind signed URLs, never public hosting
 * (Security requirement: replaces the prototype's tmpfiles.org). A local-fs adapter
 * backs development; swapping to Cloudflare R2 / S3 later is adding a new adapter and
 * a config switch — no change to callers. Postgres stores only the pointer
 * (`report.storage_key`), not the blob.
 */
import 'server-only';

export interface PutParams {
  /** Stable storage key, e.g. "reports/<runId>/site-intelligence.md". */
  key: string;
  body: string | Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  /** Store an object; returns the key it was stored under. */
  put(params: PutParams): Promise<{ key: string }>;
  /** Read an object back (used by the signed-download route after token check). */
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  /**
   * Produce a time-limited signed URL the browser can use to download the object.
   * For local-fs this points at our own /api/files route with an HMAC token; for
   * S3/R2 it would be a presigned bucket URL.
   */
  signedUrl(key: string, opts?: { expiresInSeconds?: number; download?: boolean }): Promise<string>;
}
