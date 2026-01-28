ALTER TABLE "agents"
ADD COLUMN IF NOT EXISTS "eval_batch_size" integer DEFAULT 3 NOT NULL;

