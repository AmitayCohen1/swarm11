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

// Type exports for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

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
