import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { incidentsTable } from "./incidents";

export const incidentEventsTable = pgTable(
  "incident_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidentsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    actorUserId: text("actor_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("incident_events_incident_created_idx").on(table.incidentId, table.createdAt)],
);

export const insertIncidentEventSchema = createInsertSchema(
  incidentEventsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertIncidentEvent = z.infer<typeof insertIncidentEventSchema>;
export type IncidentEvent = typeof incidentEventsTable.$inferSelect;
