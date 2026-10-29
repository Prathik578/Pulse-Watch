import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const monitorsTable = pgTable(
  "monitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    method: text("method").notNull().default("GET"),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    expectedStatusCodes: integer("expected_status_codes")
      .array()
      .notNull()
      .default(sql`ARRAY[200]::integer[]`),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    isPaused: boolean("is_paused").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    status: text("status").notNull().default("unknown"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastHttpStatus: integer("last_http_status"),
    lastLatencyMs: integer("last_latency_ms"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkLeaseUntil: timestamp("check_lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("monitors_owner_status_idx").on(table.ownerId, table.status),
    index("monitors_due_idx")
      .on(table.nextCheckAt)
      .where(sql`${table.isPaused} = false`),
    index("monitors_public_owner_idx").on(table.ownerId, table.isPublic),
  ],
);

export const insertMonitorSchema = createInsertSchema(monitorsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMonitor = z.infer<typeof insertMonitorSchema>;
export type Monitor = typeof monitorsTable.$inferSelect;
