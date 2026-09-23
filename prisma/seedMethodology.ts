/**
 * Refresh ONLY the methodology corpus (doc_chunk rows with source_table='method') that the
 * AI retrieve step reads — safe to run against Neon at any time.
 *
 *   npm run db:seed-methodology
 *
 * Use this after editing prisma/methodologyChunks.ts. Do NOT use `npm run db:seed` on a shared
 * database for this: the full seed also resets demo intakes/outlets and sample lease comps.
 * Idempotent: upserts by (source_table, source_id, chunk_index).
 */
import 'dotenv/config';
import { seedMethodologyChunks } from './methodologyChunks';

seedMethodologyChunks()
  .then((n) => {
    console.log(`methodology chunks upserted: ${n}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
