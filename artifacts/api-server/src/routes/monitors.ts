import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CheckMonitorNowParams,
  CheckMonitorNowResponse,
  CreateMonitorBody,
  CreateMonitorResponse,
  SeedDemoMonitorsResponse,
  DeleteMonitorParams,
  GetMonitorParams,
  GetMonitorResponse,
  ListMonitorChecksQueryParams,
  ListMonitorChecksResponse,
  ListMonitorsQueryParams,
  ListMonitorsResponse,
  PauseMonitorParams,
  PauseMonitorResponse,
  ResumeMonitorParams,
  ResumeMonitorResponse,
  UpdateMonitorBody,
  UpdateMonitorParams,
  UpdateMonitorResponse,
} from "@workspace/api-zod";
import {
  checkResultsTable,
  db,
  incidentEventsTable,
  incidentsTable,
  monitorsTable,
} from "@workspace/db";
import { validateMonitorUrl } from "../lib/ssrf";
import { toMonitorResponse, uptimeByMonitor } from "../lib/monitor-utils";

const router: IRouter = Router();

router.get("/monitors", async (req, res): Promise<void> => {
  const parsed = ListMonitorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, search } = parsed.data;
  const conditions = [eq(monitorsTable.ownerId, req.userId!)];
  if (status === "paused") {
    conditions.push(eq(monitorsTable.isPaused, true));
  } else if (status !== "all") {
    conditions.push(eq(monitorsTable.isPaused, false));
    conditions.push(eq(monitorsTable.status, status));
  }
  if (search?.trim()) {
    conditions.push(ilike(monitorsTable.name, `%${search.trim()}%`));
  }

  const monitors = await db
    .select()
    .from(monitorsTable)
    .where(and(...conditions))
    .orderBy(asc(monitorsTable.name));
  const uptime = await uptimeByMonitor(
    req.userId!,
    monitors.map((monitor) => monitor.id),
  );
  res.json(
    ListMonitorsResponse.parse(
      monitors.map((monitor) =>
        toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0),
      ),
    ),
  );
});

router.post("/dev/seed", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.sendStatus(404);
    return;
  }

  const existing = await db
    .select()
    .from(monitorsTable)
    .where(
      and(
        eq(monitorsTable.ownerId, req.userId!),
        eq(monitorsTable.isDemo, true),
      ),
    )
    .orderBy(asc(monitorsTable.name));
  if (existing.length > 0) {
    const uptime = await uptimeByMonitor(
      req.userId!,
      existing.map((monitor) => monitor.id),
    );
    res.json(
      SeedDemoMonitorsResponse.parse({
        created: 0,
        message: "Sample monitors already exist. Their results are live checks.",
        monitors: existing.map((monitor) =>
          toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0),
        ),
      }),
    );
    return;
  }

  const sampleDefinitions = [
    {
      name: "Sample · Website",
      url: "https://example.com/",
      method: "GET" as const,
      intervalSeconds: 60,
      timeoutMs: 10000,
      expectedStatusCodes: [200],
      failureThreshold: 3,
      isDemo: true,
      nextCheckAt: new Date(),
    },
    {
      name: "Sample · Documentation",
      url: "https://www.wikipedia.org/",
      method: "GET" as const,
      intervalSeconds: 300,
      timeoutMs: 10000,
      expectedStatusCodes: [200],
      failureThreshold: 3,
      isDemo: true,
      nextCheckAt: new Date(),
    },
    {
      name: "Sample · Public API",
      url: "https://api.github.com/",
      method: "GET" as const,
      intervalSeconds: 300,
      timeoutMs: 10000,
      expectedStatusCodes: [200],
      failureThreshold: 2,
      isDemo: true,
      nextCheckAt: new Date(),
    },
  ];

  try {
    for (const sample of sampleDefinitions) {
      await validateMonitorUrl(sample.url);
    }
  } catch {
    res
      .status(503)
      .json({ error: "Sample endpoints could not be validated right now." });
    return;
  }

  const created = await db
    .insert(monitorsTable)
    .values(
      sampleDefinitions.map((sample) => ({
        ...sample,
        ownerId: req.userId!,
      })),
    )
    .returning();
  res.status(201).json(
    SeedDemoMonitorsResponse.parse({
      created: created.length,
      message: "Sample monitors are created. Their results come from live checks.",
      monitors: created.map((monitor) => toMonitorResponse(monitor, 0)),
    }),
  );
});

router.post("/monitors", async (req, res): Promise<void> => {
  const parsed = CreateMonitorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let safeUrl: string;
  try {
    safeUrl = await validateMonitorUrl(parsed.data.url);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "This endpoint URL is not allowed.",
    });
    return;
  }

  const [monitor] = await db
    .insert(monitorsTable)
    .values({
      ...parsed.data,
      url: safeUrl,
      ownerId: req.userId!,
      nextCheckAt: new Date(),
    })
    .returning();
  res.status(201).json(
    CreateMonitorResponse.parse(toMonitorResponse(monitor, 0)),
  );
});

router.get("/monitors/:monitorId", async (req, res): Promise<void> => {
  const params = GetMonitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [monitor] = await db
    .select()
    .from(monitorsTable)
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    );
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }

  const uptime = await uptimeByMonitor(req.userId!, [monitor.id]);
  res.json(GetMonitorResponse.parse(toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0)));
});

router.patch("/monitors/:monitorId", async (req, res): Promise<void> => {
  const params = UpdateMonitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMonitorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let update = parsed.data;
  if (update.url) {
    try {
      update = { ...update, url: await validateMonitorUrl(update.url) };
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "This endpoint URL is not allowed.",
      });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(monitorsTable)
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }

  const urlChanged = update.url !== undefined && update.url !== existing.url;
  const updated = await db.transaction(async (tx) => {
    const [monitor] = await tx
      .update(monitorsTable)
      .set({
        ...update,
        ...(urlChanged
          ? {
              status: "unknown",
              consecutiveFailures: 0,
              lastCheckedAt: null,
              lastHttpStatus: null,
              lastLatencyMs: null,
              nextCheckAt: new Date(),
            }
          : {}),
      })
      .where(
        and(
          eq(monitorsTable.id, params.data.monitorId),
          eq(monitorsTable.ownerId, req.userId!),
        ),
      )
      .returning();

    if (urlChanged) {
      const active = await tx
        .select()
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.monitorId, monitor.id),
            eq(incidentsTable.ownerId, req.userId!),
            or(
              eq(incidentsTable.state, "open"),
              eq(incidentsTable.state, "acknowledged"),
              eq(incidentsTable.state, "investigating"),
            ),
          ),
        );
      for (const incident of active) {
        await tx
          .update(incidentsTable)
          .set({ state: "resolved", resolvedAt: new Date() })
          .where(eq(incidentsTable.id, incident.id));
        await tx.insert(incidentEventsTable).values({
          incidentId: incident.id,
          type: "resolved",
          actorUserId: req.userId!,
          message: "Incident closed because the monitored endpoint changed.",
        });
      }
    }

    return monitor;
  });

  const uptime = await uptimeByMonitor(req.userId!, [updated.id]);
  res.json(UpdateMonitorResponse.parse(toMonitorResponse(updated, uptime.get(updated.id) ?? 0)));
});

router.delete("/monitors/:monitorId", async (req, res): Promise<void> => {
  const params = DeleteMonitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(monitorsTable)
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    )
    .returning({ id: monitorsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/monitors/:monitorId/pause", async (req, res): Promise<void> => {
  const params = PauseMonitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [monitor] = await db
    .update(monitorsTable)
    .set({ isPaused: true, checkLeaseUntil: null })
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    )
    .returning();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  const uptime = await uptimeByMonitor(req.userId!, [monitor.id]);
  res.json(
    PauseMonitorResponse.parse(toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0)),
  );
});

router.post("/monitors/:monitorId/resume", async (req, res): Promise<void> => {
  const params = ResumeMonitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [monitor] = await db
    .update(monitorsTable)
    .set({
      isPaused: false,
      nextCheckAt: new Date(),
      checkLeaseUntil: null,
    })
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    )
    .returning();
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  const uptime = await uptimeByMonitor(req.userId!, [monitor.id]);
  res.json(
    ResumeMonitorResponse.parse(toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0)),
  );
});

router.get("/monitor-checks", async (req, res): Promise<void> => {
  const parsed = ListMonitorChecksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { monitorId, period, page, pageSize } = parsed.data;
  const [monitor] = await db
    .select({ id: monitorsTable.id })
    .from(monitorsTable)
    .where(and(eq(monitorsTable.id, monitorId), eq(monitorsTable.ownerId, req.userId!)));
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }

  const filters = and(
    eq(checkResultsTable.monitorId, monitorId),
    gte(checkResultsTable.checkedAt, new Date(Date.now() - periodMs(period))),
  );
  const [totalRow] = await db
    .select({ total: count() })
    .from(checkResultsTable)
    .where(filters);
  const items = await db
    .select()
    .from(checkResultsTable)
    .where(filters)
    .orderBy(desc(checkResultsTable.checkedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const uptime = await uptimeByMonitor(req.userId!, [monitorId], period);

  res.json(
    ListMonitorChecksResponse.parse({
      items,
      page,
      pageSize,
      total: totalRow.total,
      uptimePercent: uptime.get(monitorId) ?? 0,
    }),
  );
});

router.post("/monitors/:monitorId/check-now", async (req, res): Promise<void> => {
  const params = CheckMonitorNowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [monitor] = await db
    .select()
    .from(monitorsTable)
    .where(
      and(
        eq(monitorsTable.id, params.data.monitorId),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    );
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return;
  }
  if (monitor.isPaused) {
    res.status(409).json({ error: "Resume this monitor before checking it." });
    return;
  }

  const now = Date.now();
  if (
    (monitor.checkLeaseUntil && monitor.checkLeaseUntil.getTime() > now) ||
    (monitor.lastCheckedAt && now - monitor.lastCheckedAt.getTime() < 30_000)
  ) {
    res.status(429).json({ error: "A check for this monitor ran recently." });
    return;
  }

  await db
    .update(monitorsTable)
    .set({ nextCheckAt: new Date() })
    .where(
      and(
        eq(monitorsTable.id, monitor.id),
        eq(monitorsTable.ownerId, req.userId!),
      ),
    );
  res.status(202).json(CheckMonitorNowResponse.parse({ queued: true }));
});

function periodMs(period: "24h" | "7d" | "30d" | "90d"): number {
  const days = period === "24h" ? 1 : Number.parseInt(period, 10);
  return days * 24 * 60 * 60 * 1000;
}

export default router;
