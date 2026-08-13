-- Add requirements JSONB to franchisor for the franchise-template auto-prefill.
ALTER TABLE "franchisor" ADD COLUMN "requirements" JSONB;
