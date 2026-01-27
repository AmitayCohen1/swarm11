CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"model" text,
	"criteria" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_session_id" uuid,
	"agent_name" text NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"duration_ms" integer,
	"token_count" integer,
	"evaluated" boolean DEFAULT false,
	"evaluation_batch_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"call_count" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"insights" text,
	"recommendations" text,
	"reasoning" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_sessions" ALTER COLUMN "chat_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "research_sessions" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "research_sessions" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "document" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "conversation_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "credits_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_evaluation_batch_id_llm_evaluations_id_fk" FOREIGN KEY ("evaluation_batch_id") REFERENCES "public"."llm_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;