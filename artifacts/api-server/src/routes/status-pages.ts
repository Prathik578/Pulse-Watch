import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetPublicStatusPageParams,
  GetPublicStatusPageResponse,
  GetStatusPageSettingsResponse,
  UpdateStatusPageSettingsBody,
  UpdateStatusPageSettingsResponse,
} from "@workspace/api-zod";
import {
  checkResultsTable,
  db,
  incidentsTable,
  monitorsTable,
  statusPagesTable,
} from "@workspace/db";
import { uptimeByMonitor } from "../lib/monitor-utils";

export const publicStatusRouter: IRouter = Router();
export const statusSettingsRouter: IRouter = Router();

statusSettingsRouter.get("/status-page", async (req, res): Promise<void> => {
  const page = await ensureStatusPage(req.userId!);
  const countRows = await db
    .select({ id: monitorsTable.id })
    .from(monitorsTable)
    .where(
      and(
        eq(monitorsTable.ownerId, req.userId!),
        eq(monitorsTable.isPublic, true),
      ),
    );
  const result = {
    title: page.title,
    slug: page.slug,
    publicUrl: `/status/${page.slug}`,
    publicMonitorCount: countRows.length,
  };
  res.json(GetStatusPageSettingsResponse.parse(result));
});

statusSettingsRouter.patch("/status-page", async (req, res): Promise<void> => {
  const parsed = UpdateStatusPageSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const page = await ensureStatusPage(req.userId!);
  try {
    const [updated] = await db
      .update(statusPagesTable)
      .set(parsed.data)
      .where(
        and(
          eq(statusPagesTable.id, page.id),
          eq(statusPagesTable.ownerId, req.userId!),
        ),
      )
      .returning();
    const monitors = await db
      .select({ id: monitorsTable.id })
      .from(monitorsTable)
      .where(
        and(
          eq(monitorsTable.ownerId, req.userId!),
          eq(monitorsTable.isPublic, true),
        ),
      );
    res.json(
      UpdateStatusPageSettingsResponse.parse({
        title: updated.title,
        slug: updated.slug,
        publicUrl: `/status/${updated.slug}`,
        publicMonitorCount: monitors.length,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "That status page address is already in use." });
      return;
    }
    throw error;
  }
});

publicStatusRouter.get(
  "/public/status/:slug",
  async (req, res): Promise<void> => {
    const parsed = GetPublicStatusPageParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [page] = await db
      .select()
      .from(statusPagesTable)
      .where(eq(statusPagesTable.slug, parsed.data.slug));
    if (!page) {
      res.status(404).json({ error: "Status page not found" });
      return;
    }

    const monitors = await db
      .select()
      .from(monitorsTable)
      .where(
        and(
          eq(monitorsTable.ownerId, page.ownerId),
          eq(monitorsTable.isPublic, true),
        ),
      )
      .orderBy(monitorsTable.name);
    const monitorIds = monitors.map((monitor) => monitor.id);
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const uptime = await uptimeByMonitor(page.ownerId, monitorIds, "30d");
    const checks =
      monitorIds.length === 0
        ? []
        : await db
            .select()
            .from(checkResultsTable)
            .where(
              and(
                inArray(checkResultsTable.monitorId, monitorIds),
                gte(checkResultsTable.checkedAt, periodStart),
              ),
            )
            .orderBy(desc(checkResultsTable.checkedAt));

    const byMonitorAndDay = new Map<string, { total: number; failed: number }>();
    for (const check of checks) {
      const day = check.checkedAt.toISOString().slice(0, 10);
      const key = `${check.monitorId}:${day}`;
      const value = byMonitorAndDay.get(key) ?? { total: 0, failed: 0 };
      value.total += 1;
      if (check.state !== "up") value.failed += 1;
      byMonitorAndDay.set(key, value);
    }

    const today = new Date();
    const historyDates = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - (29 - index));
      return date.toISOString().slice(0, 10);
    });

    const services = monitors.map((monitor) => ({
      name: monitor.name,
      status:
        monitor.isPaused || monitor.status === "unknown"
          ? "unknown"
          : monitor.status === "down"
            ? "outage"
            : "operational",
      uptimePercent: Number((uptime.get(monitor.id) ?? 0).toFixed(2)),
      history: historyDates.map((date) => {
        const bucket = byMonitorAndDay.get(`${monitor.id}:${date}`);
        return {
          date,
          status:
            !bucket || bucket.total === 0
              ? "unknown"
              : bucket.failed > 0
                ? "outage"
                : "operational",
        };
      }),
    }));

    const resolvedIncidents =
      monitorIds.length === 0
        ? []
        : await db
            .select({
              incident: incidentsTable,
              monitorName: monitorsTable.name,
            })
            .from(incidentsTable)
            .innerJoin(monitorsTable, eq(incidentsTable.monitorId, monitorsTable.id))
            .where(
              and(
                inArray(incidentsTable.monitorId, monitorIds),
                eq(incidentsTable.ownerId, page.ownerId),
                eq(incidentsTable.state, "resolved"),
                gte(incidentsTable.resolvedAt, periodStart),
              ),
            )
            .orderBy(desc(incidentsTable.resolvedAt))
            .limit(20);

    const outageCount = services.filter(
      (service) => service.status === "outage",
    ).length;
    const unknownCount = services.filter(
      (service) => service.status === "unknown",
    ).length;
    const overallStatus =
      services.length === 0
        ? "no_services"
        : outageCount === services.length
          ? "major_outage"
          : outageCount > 0 || unknownCount > 0
            ? "partial_outage"
            : "operational";
    const updatedAt =
      checks[0]?.checkedAt ?? page.updatedAt;
    const response = {
      title: page.title,
      slug: page.slug,
      overallStatus,
      uptimePercent:
        services.length === 0
          ? 0
          : Number(
              (
                services.reduce((sum, service) => sum + service.uptimePercent, 0) /
                services.length
              ).toFixed(2),
            ),
      services,
      incidents: resolvedIncidents.map(({ incident, monitorName }) => ({
        title: `${monitorName} incident resolved`,
        status: "resolved",
        startedAt: incident.detectedAt,
        resolvedAt: incident.resolvedAt,
      })),
      updatedAt,
    };
    res.json(GetPublicStatusPageResponse.parse(response));
  },
);

async function ensureStatusPage(ownerId: string) {
  const [existing] = await db
    .select()
    .from(statusPagesTable)
    .where(eq(statusPagesTable.ownerId, ownerId));
  if (existing) return existing;

  const [created] = await db
    .insert(statusPagesTable)
    .values({
      ownerId,
      title: "System status",
      slug: `pulse-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(statusPagesTable)
    .where(eq(statusPagesTable.ownerId, ownerId));
  if (!raced) throw new Error("Could not create status page settings.");
  return raced;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
