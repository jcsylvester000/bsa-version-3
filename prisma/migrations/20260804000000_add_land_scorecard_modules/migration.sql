-- Add Land & Traffic (F4) and Self-Serve Scorecard (F9) module kinds.
ALTER TYPE "ModuleKind" ADD VALUE IF NOT EXISTS 'land';
ALTER TYPE "ModuleKind" ADD VALUE IF NOT EXISTS 'scorecard';
