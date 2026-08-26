-- AlterEnum
-- Adds the `analysis` value to ModuleKind so the AI Analysis Report can be persisted
-- as a per-site module_result (module = 'analysis'). Additive + idempotent: safe to run
-- on neon and docker whether or not the value already exists. PostgreSQL 12+ permits
-- ADD VALUE inside the migration transaction because the new value is not used here.
ALTER TYPE "ModuleKind" ADD VALUE IF NOT EXISTS 'analysis';
