import { pgTable, text, integer, timestamp, uuid, real, jsonb, boolean } from "drizzle-orm/pg-core";

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

// Research sessions - one per research execution
export const researchSessions = pgTable("research_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Links (userId for legacy, chatSessionId for new)
  userId: uuid("user_id").references(() => users.id),
  chatSessionId: uuid("chat_session_id").references(() => chatSessions.id, { onDelete: 'cascade' }),

  // Research brief
  objective: text("objective").notNull(),
  successCriteria: text("success_criteria"),
  stoppingConditions: text("stopping_conditions"),

  // Legacy fields
  document: text("document").default(""),
  conversationHistory: jsonb("conversation_history").default([]),

  // Outcome
  status: text("status").notNull().default("active"),
  // Values: 'active' | 'running' | 'completed' | 'stopped' | 'error'
  confidenceLevel: text("confidence_level"),
  // Values: 'low' | 'medium' | 'high'
  finalAnswer: text("final_answer"),

  // Metrics
  creditsUsed: integer("credits_used").notNull().default(0),
  totalSteps: integer("total_steps").default(0),
  totalCost: real("total_cost").default(0),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at")
});

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;

// Search queries - each query executed during research
export const searchQueries = pgTable("search_queries", {
  id: uuid("id").defaultRandom().primaryKey(),
  researchSessionId: uuid("research_session_id").notNull().references(() => researchSessions.id, { onDelete: 'cascade' }),

  // Query details
  query: text("query").notNull(),
  queryNormalized: text("query_normalized").notNull(), // lowercase, trimmed for dedup
  purpose: text("purpose"),

  // Results
  answer: text("answer"),
  sources: jsonb("sources").default([]),
  // Array of { url: string, title: string }

  // Quality signals
  wasUseful: boolean("was_useful"), // null = not rated, true/false = rated

  // Cycle tracking
  cycleNumber: integer("cycle_number").default(1),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export type SearchQuery = typeof searchQueries.$inferSelect;
export type NewSearchQuery = typeof searchQueries.$inferInsert;

// LLM Calls - tracks every LLM call for evaluation
export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Context
  chatSessionId: uuid("chat_session_id").references(() => chatSessions.id, { onDelete: 'cascade' }),
  agentName: text("agent_name").notNull(),
  // Values: 'intake' | 'brain_evaluate' | 'brain_finish' | 'researcher_evaluate' | 'researcher_finish' | 'web_search'

  // The call itself
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  input: jsonb("input").notNull(), // messages or prompt sent
  output: jsonb("output").notNull(), // response received

  // Metadata
  durationMs: integer("duration_ms"),
  tokenCount: integer("token_count"),

  // Evaluation (filled in later by eval function)
  evaluated: boolean("evaluated").default(false),
  evaluationBatchId: uuid("evaluation_batch_id").references(() => llmEvaluations.id),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;

// LLM Evaluations - batch evaluations of LLM calls
export const llmEvaluations = pgTable("llm_evaluations", {
  id: uuid("id").defaultRandom().primaryKey(),

  // What was evaluated
  agentName: text("agent_name").notNull(),
  callCount: integer("call_count").notNull(),

  // Evaluation results
  scores: jsonb("scores").notNull(),
  // { specificity: number, relevance: number, atomicity: number, overall: number }

  insights: text("insights"), // LLM-generated observations
  recommendations: text("recommendations"), // What to improve
  reasoning: jsonb("reasoning"), // Per-metric reasoning { metricName: "why this score" }

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LlmEvaluation = typeof llmEvaluations.$inferSelect;
export type NewLlmEvaluation = typeof llmEvaluations.$inferInsert;

// Agents - registered agents for evaluation
export const agents = pgTable("agents", {
  id: text("id").primaryKey(), // User-defined ID like 'my_custom_agent'
  name: text("name").notNull(),
  description: text("description").notNull(),
  model: text("model"),
  // Evaluation settings
  evalBatchSize: integer("eval_batch_size").notNull().default(3),
  criteria: jsonb("criteria").default([]),
  // Array of { name: string, description: string }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
