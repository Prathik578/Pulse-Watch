import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { checkResultsTable, db, monitorsTable, type Monitor } from "@workspace/db";
import type { AnalyticsPeriod } from "@workspace/api-zod";

const PERIOD_MS: Record<AnalyticsPeriod, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

export function periodStart(period: AnalyticsPeriod): Date {
  return new Date(Date.now() - PERIOD_MS[period]);
}

export async function uptimeByMonitor(
  ownerId: string,
  monitorIds: string[],
  period: AnalyticsPeriod = "24h",
): Promise<Map<string, number>> {
  if (monitorIds.length === 0) return new Map();

  const rows = await db
    .select({
      monitorId: checkResultsTable.monitorId,
      total: count(),
      successful: sql<number>`count(*) filter (where ${checkResultsTable.state} = 'up')`,
    })
    .from(checkResultsTable)
    .innerJoin(monitorsTable, eq(checkResultsTable.monitorId, monitorsTable.id))
    .where(
      and(
        eq(monitorsTable.ownerId, ownerId),
        inArray(checkResultsTable.monitorId, monitorIds),
        gte(checkResultsTable.checkedAt, periodStart(period)),
      ),
    )
    .groupBy(checkResultsTable.monitorId);

  const results = new Map<string, number>();
  for (const row of rows) {
    results.set(
      row.monitorId,
      row.total === 0 ? 0 : (Number(row.successful) / row.total) * 100,
    );
  }
  return results;
}

export function toMonitorResponse(monitor: Monitor, uptimePercent = 0) {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method as "GET" | "HEAD",
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    expectedStatusCodes: monitor.expectedStatusCodes,
    failureThreshold: monitor.failureThreshold,
    isPaused: monitor.isPaused,
    isPublic: monitor.isPublic,
    isDemo: monitor.isDemo,
    status: monitor.isPaused ? "paused" : monitor.status,
    consecutiveFailures: monitor.consecutiveFailures,
    lastCheckedAt: monitor.lastCheckedAt,
    lastHttpStatus: monitor.lastHttpStatus,
    lastLatencyMs: monitor.lastLatencyMs,
    uptimePercent: Number(uptimePercent.toFixed(2)),
    createdAt: monitor.createdAt,
    updatedAt: monitor.updatedAt,
  };
}

export function getPeriodStartTimestamp(period: AnalyticsPeriod): Date {
  return periodStart(period);
}
