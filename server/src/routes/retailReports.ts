import {
  generateAndStoreRetailSnapshot,
  getLatestRetailSnapshot,
  listRetailSnapshots
} from "../reports/retailSnapshot.js";

export async function getRetailReportsRoute(req: any, res: any) {
  const limit = Math.max(1, Math.min(120, Number(req?.query?.limit ?? 30)));
  const scope = String(req?.query?.scope ?? "retail_kpi").trim() || "retail_kpi";
  const snapshots = listRetailSnapshots(scope, limit);
  return res.json({ ok: true, scope, snapshots });
}

export async function getRetailReportsLatestRoute(req: any, res: any) {
  const scope = String(req?.query?.scope ?? "retail_kpi").trim() || "retail_kpi";
  const snapshot = getLatestRetailSnapshot(scope);
  return res.json({ ok: true, scope, snapshot });
}

export async function refreshRetailReportsRoute(req: any, res: any) {
  const body = (req?.body ?? {}) as Record<string, unknown>;
  const scope = String(body.scope ?? "retail_kpi").trim() || "retail_kpi";
  const snapshotDate = typeof body.snapshotDate === "string" && body.snapshotDate.trim()
    ? body.snapshotDate.trim()
    : undefined;

  const snapshot = snapshotDate
    ? generateAndStoreRetailSnapshot(scope, snapshotDate)
    : generateAndStoreRetailSnapshot(scope);

  return res.json({ ok: true, scope, snapshot });
}
