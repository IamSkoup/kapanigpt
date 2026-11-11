import { pgTable, text, bigint, integer, boolean, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const millis = (name: string) => bigint(name, { mode: "number" });

export const usage = pgTable("ai_usage", {
  userId: text("user_id").notNull(),
  period: text("period").notNull(),
  spent: integer("spent").notNull().default(0),
  images: integer("images").notNull().default(0),
}, table => [primaryKey({ columns: [table.userId, table.period] })]);

export const imageTickets = pgTable("ai_image_tickets", {
  ticket: text("ticket").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: millis("created_at").notNull(),
  imageId: text("image_id"),
});

export const subscriptions = pgTable("ai_subscriptions", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull(),
  expiresAt: millis("expires_at").notNull(),
  updatedAt: millis("updated_at").notNull(),
});

export const openingPromoClaims = pgTable("ai_opening_promo_claims", {
  userId: text("user_id").primaryKey(),
  claimedAt: millis("claimed_at").notNull(),
  startsAt: millis("starts_at").notNull(),
  expiresAt: millis("expires_at").notNull(),
});

export const subscriptionCheckouts = pgTable("ai_subscription_checkouts", {
  userId: text("user_id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  plan: text("plan").notNull(),
  payerUid: text("payer_uid").notNull(),
  status: text("status").notNull(),
  createdAt: millis("created_at").notNull(),
  completedAt: millis("completed_at"),
  balanceAfter: integer("balance_after"),
  expiresAt: millis("expires_at"),
});

export const userPreferences = pgTable("ai_user_preferences", {
  userId: text("user_id").primaryKey(),
  about: text("about").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  tone: text("tone").notNull().default("balanced"),
  historyEnabled: boolean("history_enabled").notNull().default(true),
  updatedAt: millis("updated_at").notNull(),
});

export const tokenWallets = pgTable("ai_token_wallets", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  updatedAt: millis("updated_at").notNull(),
});

export const tokenCheckouts = pgTable("ai_token_checkouts", {
  paymentId: text("payment_id").primaryKey(),
  userId: text("user_id").notNull(),
  pack: text("pack").notNull(),
  payerUid: text("payer_uid").notNull(),
  status: text("status").notNull(),
  createdAt: millis("created_at").notNull(),
  completedAt: millis("completed_at"),
  bankBalanceAfter: integer("bank_balance_after"),
  tokensAfter: integer("tokens_after"),
}, table => [uniqueIndex("ai_token_only_one_pending_per_user").on(table.userId).where(sql`status = 'pending'`)]);

// The owner-supplied knowledge base is private; never ship it in public Git.
export const siteSettings = pgTable("ai_site_settings", {
  key: text("setting_key").primaryKey(),
  value: text("setting_value").notNull(),
  updatedAt: millis("updated_at").notNull(),
});
