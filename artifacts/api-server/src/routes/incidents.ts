import { and, count, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AcknowledgeIncidentParams,
  AcknowledgeIncidentResponse,
  GetIncidentParams,
  GetIncidentResponse,
  InvestigateIncidentBody,
  InvestigateIncidentParams,
  InvestigateIncidentResponse,
  ListIncidentsQueryParams,
  ListIncidentsResponse,
  ResolveIncidentBody,
  ResolveIncidentParams,
  ResolveIncidentResponse,
} from "@workspace/api-zod";
import {
  db,
  incidentEventsTable,
  incidentsTable,
  monitorsTable,
} from "@workspace/db";
import {
  getIncidentResponse,
  incidentDurationSeconds,
} from "../lib/incident-utils";

const router: IRouter = Router();

router.get("/incidents", async (req, res): Promise<void> => {
  const parsed = ListIncidentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { state, page, pageSize } = parsed.data;
  const conditions = [eq(incidentsTable.ownerId, req.userId!)];
  if (state !== "all") conditions.push(eq(incidentsTable.state, state));
  const filters = and(...conditions);
  const [totalRow] = await db
    .select({ total: count() })
    .from(incidentsTable)
    .where(filters);
  const rows = await db
    .select({
      incident: incidentsTable,
      monitorName: monitorsTable.name,
    })
    .from(incidentsTable)
    .innerJoin(monitorsTable, eq(incidentsTable.monitorId, monitorsTable.id))
    .where(filters)
    .orderBy(desc(incidentsTable.detectedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const incidentIds = rows.map(({ incident }) => incident.id);
  const eventRows =
    incidentIds.length === 0
      ? []
      : await db
          .select()
          .from(incidentEventsTable)
          .where(inArray(incidentEventsTable.incidentId, incidentIds))
          .orderBy(incidentEventsTable.createdAt);
  const eventMap = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    const list = eventMap.get(event.incidentId) ?? [];
    list.push(event);
    eventMap.set(event.incidentId, list);
  }

  res.json(
    ListIncidentsResponse.parse({
      items: rows.map(({ incident, monitorName }) => ({
        id: incident.id,
        monitorId: incident.monitorId,
        monitorName,
        state: incident.state,
        detectedAt: incident.detectedAt,
        acknowledgedAt: incident.acknowledgedAt,
        resolvedAt: incident.resolvedAt,
        durationSeconds: incidentDurationSeconds(
          incident.detectedAt,
          incident.resolvedAt,
        ),
        events: (eventMap.get(incident.id) ?? []).map((event) => ({
          id: event.id,
          type: event.type,
          message: event.message,
          actorLabel: event.actorUserId ? "Account owner" : "PulseWatch",
          createdAt: event.createdAt,
        })),
      })),
      page,
      pageSize,
      total: totalRow.total,
    }),
  );
});

router.get("/incidents/:incidentId", async (req, res): Promise<void> => {
  const params = GetIncidentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const incident = await getIncidentResponse(req.userId!, params.data.incidentId);
  if (!incident) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json(GetIncidentResponse.parse(incident));
});

router.post(
  "/incidents/:incidentId/acknowledge",
  async (req, res): Promise<void> => {
    const params = AcknowledgeIncidentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const changed = await db.transaction(async (tx) => {
      const [incident] = await tx
        .select()
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.id, params.data.incidentId),
            eq(incidentsTable.ownerId, req.userId!),
          ),
        )
        .for("update");
      if (!incident) return "missing" as const;
      if (incident.state === "resolved") return "resolved" as const;
      if (incident.state !== "open") return "unchanged" as const;

      const now = new Date();
      await tx
        .update(incidentsTable)
        .set({ state: "acknowledged", acknowledgedAt: now })
        .where(eq(incidentsTable.id, incident.id));
      await tx.insert(incidentEventsTable).values({
        incidentId: incident.id,
        type: "acknowledged",
        actorUserId: req.userId!,
        message: "Incident acknowledged by an account owner.",
      });
      return "changed" as const;
    });

    if (changed === "missing") {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    if (changed === "resolved") {
      res.status(409).json({ error: "Resolved incidents cannot be changed." });
      return;
    }
    const incident = await getIncidentResponse(req.userId!, params.data.incidentId);
    res.json(AcknowledgeIncidentResponse.parse(incident));
  },
);

router.post(
  "/incidents/:incidentId/investigate",
  async (req, res): Promise<void> => {
    const params = InvestigateIncidentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = InvestigateIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [incident] = await tx
        .select()
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.id, params.data.incidentId),
            eq(incidentsTable.ownerId, req.userId!),
          ),
        )
        .for("update");
      if (!incident) return "missing" as const;
      if (incident.state === "resolved") return "resolved" as const;

      await tx
        .update(incidentsTable)
        .set({ state: "investigating" })
        .where(eq(incidentsTable.id, incident.id));
      await tx.insert(incidentEventsTable).values({
        incidentId: incident.id,
        type: "investigating",
        actorUserId: req.userId!,
        message: parsed.data.message,
      });
      return "updated" as const;
    });

    if (result === "missing") {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    if (result === "resolved") {
      res.status(409).json({ error: "Resolved incidents cannot be changed." });
      return;
    }
    const incident = await getIncidentResponse(req.userId!, params.data.incidentId);
    res.json(InvestigateIncidentResponse.parse(incident));
  },
);

router.post(
  "/incidents/:incidentId/resolve",
  async (req, res): Promise<void> => {
    const params = ResolveIncidentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    let message: string | undefined;
    if (req.body !== undefined) {
      const parsed = ResolveIncidentBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      message = parsed.data.message;
    }

    const result = await db.transaction(async (tx) => {
      const [incident] = await tx
        .select()
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.id, params.data.incidentId),
            eq(incidentsTable.ownerId, req.userId!),
          ),
        )
        .for("update");
      if (!incident) return "missing" as const;
      if (incident.state === "resolved") return "unchanged" as const;

      const now = new Date();
      await tx
        .update(incidentsTable)
        .set({ state: "resolved", resolvedAt: now })
        .where(eq(incidentsTable.id, incident.id));
      await tx.insert(incidentEventsTable).values({
        incidentId: incident.id,
        type: "resolved",
        actorUserId: req.userId!,
        message: message ?? "Incident resolved by an account owner.",
      });
      return "updated" as const;
    });

    if (result === "missing") {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const incident = await getIncidentResponse(req.userId!, params.data.incidentId);
    res.json(ResolveIncidentResponse.parse(incident));
  },
);

export default router;
