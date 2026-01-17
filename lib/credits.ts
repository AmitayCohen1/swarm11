import { db } from './db';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';

/**
 * Check if user has enough credits
 */
export async function hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  return user.credits >= amount;
}

/**
 * Deduct credits from user account
 * @throws Error if insufficient credits
 */
export async function deductCredits(userId: string, amount: number): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  if (user.credits < amount) {
    throw new Error('Insufficient credits');
  }

  await db
    .update(users)
    .set({
      credits: user.credits - amount,
      lifetimeCreditsUsed: user.lifetimeCreditsUsed + amount,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Add credits to user account (after purchase)
 */
export async function addCredits(userId: string, amount: number): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  await db
    .update(users)
    .set({
      credits: user.credits + amount,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Get user's credit balance
 */
export async function getCreditBalance(userId: string): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  return user.credits;
}

/**
 * Create or get user (called after Clerk sign-up)
 * Returns the full user object
 */
export async function getOrCreateUser(clerkId: string, email: string | null) {
  // Check if user exists
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (existingUser) {
    return existingUser;
  }

  // Create new user with 5000 free credits
  const [newUser] = await db
    .insert(users)
    .values({
      clerkId,
      email: email || `${clerkId}@placeholder.com`,
      credits: 5000, // 5000 free credits to start (for POC)
      lifetimeCreditsUsed: 0,
    })
    .returning();

  return newUser;
}
