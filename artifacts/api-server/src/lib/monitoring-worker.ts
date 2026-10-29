import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  checkResultsTable,
  incidentEventsTable,
  incidentsTable,
  monitorsTable,
  type Monitor,
} from "@workspace/db";
import { logger } from "./logger";
import { checkEndpoint } from "./ssrf";
import type { CheckOutcome } from "./ssrf";

const POLL_INTERVAL_MS = 10_000;
const CLAIM_BATCH_SIZE = 20;
let pollTimer: NodeJS.Timeout | undefined;
let isPolling = false;

export function startMonitoringWorker(): void {
  if (pollTimer) return;

  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting monitor worker");
  void pollDueMonitors();
  pollTimer = setInterval(() => void pollDueMonitors(), POLL_INTERVAL_MS);
  pollTimer.unref();
}

async function pollDueMonitors(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const claimed = await claimDueMonitors();
    await Promise.all(claimed.map((monitor) => runMonitorCheck(monitor)));
  } catch (error) {
    logger.error({ err: error }, "Monitor worker cycle failed");
  } finally {
    isPolling = false;
  }
}

async function claimDueMonitors(): Promise<Monitor[]> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(monitorsTable)
      .where(
        and(
          eq(monitorsTable.isPaused, false),
          lte(monitorsTable.nextCheckAt, now),
          or(isNull(monitorsTable.checkLeaseUntil), lte(monitorsTable.checkLeaseUntil, now)),
        ),
      )
      .orderBy(asc(monitorsTable.nextCheckAt))
      .limit(CLAIM_BATCH_SIZE)
      .for("update", { skipLocked: true });

    for (const monitor of due) {
      await tx
        .update(monitorsTable)
        .set({
          checkLeaseUntil: new Date(now.getTime() + monitor.timeoutMs + 10_000),
          nextCheckAt: new Date(now.getTime() + monitor.intervalSeconds * 1000),
        })
        .where(eq(monitorsTable.id, monitor.id));
    }

    return due;
  });
}

async function runMonitorCheck(monitor: Monitor): Promise<void> {
  const method = monitor.method === "HEAD" ? "HEAD" : "GET";
  const outcome = await checkEndpoint(
    monitor.url,
    method,
    monitor.timeoutMs,
    monitor.expectedStatusCodes,
  );
  try {
    await persistCheck(monitor, outcome);
  } catch (error) {
    logger.error(
      { err: error, monitorId: monitor.id },
      "Could not persist monitor check",
    );
    await db
      .update(monitorsTable)
      .set({ checkLeaseUntil: null })
      .where(eq(monitorsTable.id, monitor.id));
  }
}

async function persistCheck(
  claimedMonitor: Monitor,
  outcome: CheckOutcome,
): Promise<void> {
  const checkedAt = new Date();

  await db.transaction(async (tx) => {
    const [monitor] = await tx
      .select()
      .from(monitorsTable)
      .where(eq(monitorsTable.id, claimedMonitor.id))
      .for("update");

    if (!monitor) return;

    await tx.insert(checkResultsTable).values({
      monitorId: monitor.id,
      checkedAt,
      state: outcome.state,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
      errorCategory: outcome.errorCategory,
      errorMessage: outcome.errorMessage,
    });

    const failureCount =
      outcome.state === "up" ? 0 : monitor.consecutiveFailures + 1;
    const nextStatus =
      outcome.state === "up"
        ? "up"
        : failureCount >= monitor.failureThreshold
          ? "down"
          : monitor.status;

    await tx
      .update(monitorsTable)
      .set({
        status: nextStatus,
        consecutiveFailures: failureCount,
        lastCheckedAt: checkedAt,
        lastHttpStatus: outcome.httpStatus,
        lastLatencyMs: outcome.latencyMs,
        checkLeaseUntil: null,
      })
      .where(eq(monitorsTable.id, monitor.id));

    if (outcome.state === "up") {
      if (monitor.status === "down") {
        const [activeIncident] = await tx
          .select()
          .from(incidentsTable)
          .where(
            and(
              eq(incidentsTable.monitorId, monitor.id),
              eq(incidentsTable.ownerId, monitor.ownerId),
              or(
                eq(incidentsTable.state, "open"),
                eq(incidentsTable.state, "acknowledged"),
                eq(incidentsTable.state, "investigating"),
              ),
            ),
          )
          .for("update");

        if (activeIncident) {
          await tx
            .update(incidentsTable)
            .set({ state: "resolved", resolvedAt: checkedAt })
            .where(eq(incidentsTable.id, activeIncident.id));
          await tx.insert(incidentEventsTable).values({
            incidentId: activeIncident.id,
            type: "recovered",
            message: "The service recovered after a successful check.",
          });
        }
      }
      return;
    }

    if (failureCount < monitor.failureThreshold) return;

    const [activeIncident] = await tx
      .select()
      .from(incidentsTable)
      .where(
        and(
          eq(incidentsTable.monitorId, monitor.id),
          eq(incidentsTable.ownerId, monitor.ownerId),
          or(
            eq(incidentsTable.state, "open"),
            eq(incidentsTable.state, "acknowledged"),
            eq(incidentsTable.state, "investigating"),
          ),
        ),
      )
      .for("update");

    if (activeIncident) return;

    const [incident] = await tx
      .insert(incidentsTable)
      .values({ monitorId: monitor.id, ownerId: monitor.ownerId })
      .onConflictDoNothing()
      .returning();

    if (incident) {
      await tx.insert(incidentEventsTable).values({
        incidentId: incident.id,
        type: "detected",
        message: `The monitor failed ${failureCount} consecutive checks.`,
      });
    }
  });
}
