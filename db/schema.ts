import { sqliteTable, text, integer, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const usage = sqliteTable("ai_usage", {
  userId: text("user_id").notNull(),
  period: text("period").notNull(),
  spent: integer("spent").notNull().default(0),
  images: integer("images").notNull().default(0),
}, table => [primaryKey({ columns: [table.userId, table.period] })]);

export const imageTickets = sqliteTable("ai_image_tickets", {
  ticket: text("ticket").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  imageId: text("image_id"),
});

// Entitlements belong to the Firebase account used to sign in to KapaniGPT.
// A Kapani wallet is only a temporary payment source, never the subscription owner.
export const subscriptions = sqliteTable("ai_subscriptions", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// The opening offer is owned by a Firebase user and can only be claimed once.
// Separate rows keep paid subscriptions intact and let active paid users
// redeem now while their Plus week begins after their current plan expires.
export const openingPromoClaims = sqliteTable("ai_opening_promo_claims", {
  userId: text("user_id").primaryKey(),
  claimedAt: integer("claimed_at").notNull(),
  startsAt: integer("starts_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// Keep the same Supabase payment UUID across retries, including after a lost
// response. There can be only one unresolved charge per Firebase account.
export const subscriptionCheckouts = sqliteTable("ai_subscription_checkouts", {
  userId: text("user_id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  plan: text("plan").notNull(),
  payerUid: text("payer_uid").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  balanceAfter: integer("balance_after"),
  expiresAt: integer("expires_at"),
});

export const userPreferences = sqliteTable("ai_user_preferences", {
  userId: text("user_id").primaryKey(),
  about: text("about").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  tone: text("tone").notNull().default("balanced"),
  historyEnabled: integer("history_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull(),
});

// Purchased, non-expiring usage credits belong to a Firebase KapaniGPT UID.
export const tokenWallets = sqliteTable("ai_token_wallets", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

// Permanently retain payment identifiers so a token receipt cannot be reused
// as a subscription purchase, even after a newer pack is bought.
export const tokenCheckouts = sqliteTable("ai_token_checkouts", {
  paymentId: text("payment_id").primaryKey(),
  userId: text("user_id").notNull(),
  pack: text("pack").notNull(),
  payerUid: text("payer_uid").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  bankBalanceAfter: integer("bank_balance_after"),
  tokensAfter: integer("tokens_after"),
}, table => [uniqueIndex("ai_token_only_one_pending_per_user").on(table.userId).where(sql`status = 'pending'`)]);
