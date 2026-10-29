import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { monitorsTable } from "./monitors";

export const checkResultsTable = pgTable(
  "check_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitorsTable.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    state: text("state").notNull(),
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms"),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("check_results_monitor_checked_at_idx").on(
      table.monitorId,
      table.checkedAt,
    ),
  ],
);

export const insertCheckResultSchema = createInsertSchema(checkResultsTable).omit({
  id: true,
  checkedAt: true,
});

export type InsertCheckResult = z.infer<typeof insertCheckResultSchema>;
export type CheckResult = typeof checkResultsTable.$inferSelect;
