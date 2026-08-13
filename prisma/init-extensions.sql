-- Extensions BSA depends on. Run automatically by docker-compose on first boot,
-- and applied by the first Prisma migration so neon.tech gets them too.
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: embeddings for retrieve-then-generate
CREATE EXTENSION IF NOT EXISTS postgis;     -- geography type + geo math for trade-area overlap
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram index for POI name search
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email uniqueness
