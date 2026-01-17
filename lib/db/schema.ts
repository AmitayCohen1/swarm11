import { pgTable, text, integer, timestamp, uuid, real, jsonb } from "drizzle-orm/pg-core";

// Users table - tracks credits and user info
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  credits: integer("credits").notNull().default(5000), // Start with 5000 free credits for POC
  lifetimeCreditsUsed: integer("lifetime_credits_used").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Research sessions table - tracks research sessions
export const researchSessions = pgTable("research_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  objective: text("objective").notNull(),
  document: text("document").default(""),
  status: text("status").notNull().default("active"), // "active" | "completed" | "stopped" | "insufficient_credits"
  creditsUsed: integer("credits_used").notNull().default(0),
  conversationHistory: jsonb("conversation_history").default([]), // Full agent conversation
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Tool calls table - tracks individual web searches
export const toolCalls = pgTable("tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => researchSessions.id),
  toolName: text("tool_name").notNull(), // "web_search"
  input: jsonb("input").notNull(), // { query: "..." }
  output: jsonb("output"), // Search results
  creditsUsed: integer("credits_used").notNull().default(1), // ~0.5 credits per search
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// Type exports for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;

export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;

// Autonomous sessions table - AI SDK v6 ToolLoopAgent pattern
export const autonomousSessions = pgTable("autonomous_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),

  objective: text("objective").notNull(),
  brain: text("brain").default(""),

  status: text("status").notNull().default("active"),

  queriesExecuted: integer("queries_executed").notNull().default(0),
  maxQueries: integer("max_queries").notNull().default(20),

  creditsUsed: integer("credits_used").notNull().default(0),

  iterationCount: integer("iteration_count").default(0),
  lastReasoning: jsonb("last_reasoning"),

  pendingQuestion: jsonb("pending_question"),
  pendingResponse: text("pending_response"),

  finalReport: text("final_report"),
  stopReason: text("stop_reason"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at")
});

export type AutonomousSession = typeof autonomousSessions.$inferSelect;
export type NewAutonomousSession = typeof autonomousSessions.$inferInsert;

// Chat sessions table - orchestrator pattern with shared brain
export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),

  // Conversation history (all messages: user, assistant, research)
  messages: jsonb("messages").default([]).notNull(),

  // Shared brain - accumulated research knowledge
  brain: text("brain").default(""),

  // Status
  status: text("status").notNull().default("active"),
  // Values: 'active' | 'researching' | 'completed'

  // Credits tracking
  creditsUsed: integer("credits_used").notNull().default(0),

  // Research state (when research agent is running)
  currentResearch: jsonb("current_research"),
  // { objective: string, questionsPlanned: string[], progress: number }

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
