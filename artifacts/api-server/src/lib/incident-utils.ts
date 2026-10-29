import { and, asc, eq } from "drizzle-orm";
import {
  db,
  incidentEventsTable,
  incidentsTable,
  monitorsTable,
} from "@workspace/db";

export async function getIncidentResponse(
  ownerId: string,
  incidentId: string,
): Promise<{
  id: string;
  monitorId: string;
  monitorName: string;
  state: string;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  durationSeconds: number | null;
  events: Array<{
    id: string;
    type: string;
    message: string;
    actorLabel: string | null;
    createdAt: Date;
  }>;
} | null> {
  const [row] = await db
    .select({
      incident: incidentsTable,
      monitorName: monitorsTable.name,
    })
    .from(incidentsTable)
    .innerJoin(monitorsTable, eq(incidentsTable.monitorId, monitorsTable.id))
    .where(
      and(
        eq(incidentsTable.id, incidentId),
        eq(incidentsTable.ownerId, ownerId),
      ),
    );
  if (!row) return null;

  const events = await db
    .select()
    .from(incidentEventsTable)
    .where(eq(incidentEventsTable.incidentId, incidentId))
    .orderBy(asc(incidentEventsTable.createdAt));
  return {
    id: row.incident.id,
    monitorId: row.incident.monitorId,
    monitorName: row.monitorName,
    state: row.incident.state,
    detectedAt: row.incident.detectedAt,
    acknowledgedAt: row.incident.acknowledgedAt,
    resolvedAt: row.incident.resolvedAt,
    durationSeconds:
      row.incident.resolvedAt === null
        ? null
        : Math.max(
            0,
            Math.floor(
              (row.incident.resolvedAt.getTime() -
                row.incident.detectedAt.getTime()) /
                1000,
            ),
          ),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      actorLabel: event.actorUserId ? "Account owner" : "PulseWatch",
      createdAt: event.createdAt,
    })),
  };
}

export function incidentDurationSeconds(
  detectedAt: Date,
  resolvedAt: Date | null,
): number | null {
  if (resolvedAt === null) return null;
  return Math.max(
    0,
    Math.floor((resolvedAt.getTime() - detectedAt.getTime()) / 1000),
  );
}
