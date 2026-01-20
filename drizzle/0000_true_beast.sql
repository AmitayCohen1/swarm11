CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brain" text DEFAULT '',
	"status" text DEFAULT 'active' NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"current_research" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_session_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"success_criteria" text,
	"stopping_conditions" text,
	"status" text DEFAULT 'running' NOT NULL,
	"confidence_level" text,
	"final_answer" text,
	"total_steps" integer DEFAULT 0,
	"total_cost" real DEFAULT 0,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_session_id" uuid NOT NULL,
	"query" text NOT NULL,
	"query_normalized" text NOT NULL,
	"purpose" text,
	"answer" text,
	"sources" jsonb DEFAULT '[]'::jsonb,
	"was_useful" boolean,
	"cycle_number" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"credits" integer DEFAULT 5000 NOT NULL,
	"lifetime_credits_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;