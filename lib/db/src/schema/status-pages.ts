import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const statusPagesTable = pgTable(
  "status_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull().default("System status"),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("status_pages_owner_id_unique").on(table.ownerId),
    uniqueIndex("status_pages_slug_unique").on(table.slug),
    index("status_pages_owner_idx").on(table.ownerId),
  ],
);

export const insertStatusPageSchema = createInsertSchema(statusPagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStatusPage = z.infer<typeof insertStatusPageSchema>;
export type StatusPage = typeof statusPagesTable.$inferSelect;
