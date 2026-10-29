import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetDashboardQueryParams, GetDashboardResponse } from "@workspace/api-zod";
import {
  checkResultsTable,
  db,
  incidentsTable,
  monitorsTable,
} from "@workspace/db";
import { getPeriodStartTimestamp, toMonitorResponse, uptimeByMonitor } from "../lib/monitor-utils";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { period } = parsed.data;
  const ownerId = req.userId!;
  const start = getPeriodStartTimestamp(period);
  const monitors = await db
    .select()
    .from(monitorsTable)
    .where(eq(monitorsTable.ownerId, ownerId))
    .orderBy(monitorsTable.name);
  const monitorIds = monitors.map((monitor) => monitor.id);
  const uptime = await uptimeByMonitor(ownerId, monitorIds, period);

  const [incidentCount] = monitorIds.length
    ? await db
        .select({ total: count() })
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.ownerId, ownerId),
            inArray(incidentsTable.state, ["open", "acknowledged", "investigating"]),
          ),
        )
    : [{ total: 0 }];

  let successCount = 0;
  let checkCount = 0;
  let averageLatencyMs: number | null = null;
  let responseTimeSeries: Array<{
    timestamp: Date;
    averageLatencyMs: number | null;
    checks: number;
    failures: number;
  }> = [];

  if (monitorIds.length > 0) {
    const [summary] = await db
      .select({
        total: count(),
        successes: sql<number>`count(*) filter (where ${checkResultsTable.state} = 'up')`,
        averageLatencyMs: sql<number | null>`round(avg(${checkResultsTable.latencyMs}))`,
      })
      .from(checkResultsTable)
      .where(
        and(
          inArray(checkResultsTable.monitorId, monitorIds),
          gte(checkResultsTable.checkedAt, start),
        ),
      );
    successCount = Number(summary.successes);
    checkCount = summary.total;
    averageLatencyMs =
      summary.averageLatencyMs === null
        ? null
        : Number(summary.averageLatencyMs);

    const bucket = period === "24h" ? "hour" : "day";
    const bucketExpr = sql<Date>`date_trunc(${bucket}, ${checkResultsTable.checkedAt})`;
    const groups = await db
      .select({
        timestamp: bucketExpr,
        averageLatencyMs: sql<number | null>`round(avg(${checkResultsTable.latencyMs}))`,
        checks: count(),
        failures: sql<number>`count(*) filter (where ${checkResultsTable.state} = 'down')`,
      })
      .from(checkResultsTable)
      .where(
        and(
          inArray(checkResultsTable.monitorId, monitorIds),
          gte(checkResultsTable.checkedAt, start),
        ),
      )
      .groupBy(bucketExpr)
      .orderBy(bucketExpr);
    responseTimeSeries = groups.map((group) => ({
      timestamp:
        group.timestamp instanceof Date
          ? group.timestamp
          : new Date(group.timestamp),
      averageLatencyMs:
        group.averageLatencyMs === null
          ? null
          : Number(group.averageLatencyMs),
      checks: group.checks,
      failures: Number(group.failures),
    }));
  }

  const recentRows =
    monitorIds.length === 0
      ? []
      : await db
          .select({
            incident: incidentsTable,
            monitorName: monitorsTable.name,
          })
          .from(incidentsTable)
          .innerJoin(monitorsTable, eq(incidentsTable.monitorId, monitorsTable.id))
          .where(eq(incidentsTable.ownerId, ownerId))
          .orderBy(desc(incidentsTable.detectedAt))
          .limit(5);

  const dashboard = {
    period,
    totalMonitors: monitors.length,
    operationalMonitors: monitors.filter(
      (monitor) => !monitor.isPaused && monitor.status === "up",
    ).length,
    failingMonitors: monitors.filter(
      (monitor) => !monitor.isPaused && monitor.status === "down",
    ).length,
    pausedMonitors: monitors.filter((monitor) => monitor.isPaused).length,
    openIncidents: incidentCount.total,
    uptimePercent:
      checkCount === 0 ? 0 : Number(((successCount / checkCount) * 100).toFixed(2)),
    averageLatencyMs,
    monitors: monitors.map((monitor) =>
      toMonitorResponse(monitor, uptime.get(monitor.id) ?? 0),
    ),
    recentIncidents: recentRows.map(({ incident, monitorName }) => ({
      id: incident.id,
      monitorId: incident.monitorId,
      monitorName,
      state: incident.state,
      detectedAt: incident.detectedAt,
      resolvedAt: incident.resolvedAt,
      durationSeconds:
        incident.resolvedAt === null
          ? null
          : Math.max(
              0,
              Math.floor(
                (incident.resolvedAt.getTime() - incident.detectedAt.getTime()) /
                  1000,
              ),
            ),
    })),
    responseTimeSeries,
  };

  res.json(GetDashboardResponse.parse(dashboard));
});

export default router;
