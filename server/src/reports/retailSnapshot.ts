import {
  listExecutiveReportsSqlite,
  listPosTransactionsSqlite,
  listRetailSnapshotsSqlite,
  listSalesEntriesSqlite,
  upsertRetailSnapshotSqlite,
  type RetailSnapshotRecord
} from "../memory/sqliteMemory.js";

type PeriodTotals = {
  revenue: number;
  orders: number;
  transactions: number;
};

type RetailSnapshotPayload = {
  generatedAt: string;
  snapshotDate: string;
  periodKpi: {
    today: PeriodTotals;
    weekToDate: PeriodTotals;
    monthToDate: PeriodTotals;
  };
  channels: {
    salesRevenue: number;
    posRevenue: number;
    totalRevenue: number;
  };
  executive: {
    reportsToday: number;
    reportsWeek: number;
    reportsMonth: number;
  };
  pos: {
    topStore: { storeId: string; storeName: string; revenue: number } | null;
    topPayment: { method: string; revenue: number } | null;
    activePromotions: number;
  };
};

function nowKstDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function toWeekStartDate(today: string) {
  const base = new Date(`${today}T00:00:00+09:00`);
  const day = base.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - mondayOffset);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(monday);
}

function parsePosPayloads(): Array<Record<string, unknown>> {
  return listPosTransactionsSqlite(0);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getPosDate(payload: Record<string, unknown>): string {
  const date = asString(payload.date).slice(0, 10);
  if (date) return date;
  return asString(payload.createdAt).slice(0, 10);
}

function getPosRefundedAmount(payload: Record<string, unknown>): number {
  const explicit = asNumber(payload.refundAmount);
  if (explicit > 0) return explicit;
  const events = Array.isArray(payload.refundEvents) ? payload.refundEvents : [];
  return events.reduce((sum, event) => sum + asNumber((event as Record<string, unknown>).total), 0);
}

function getPosRefundedItems(payload: Record<string, unknown>): number {
  const explicit = asNumber(payload.refundedItemCount);
  if (explicit > 0) return explicit;
  const events = Array.isArray(payload.refundEvents) ? payload.refundEvents : [];
  return events.reduce((sum, event) => sum + asNumber((event as Record<string, unknown>).itemCount), 0);
}

function getPosNetTotals(payload: Record<string, unknown>): { revenue: number; orders: number; transactions: number } {
  const total = Math.max(0, asNumber(payload.total) - getPosRefundedAmount(payload));
  const orders = Math.max(0, asNumber(payload.itemCount) - getPosRefundedItems(payload));
  const transactions = total > 0 || orders > 0 ? 1 : 0;
  return { revenue: total, orders, transactions };
}

function sumSalesPeriod(startDate: string, endDate: string): PeriodTotals {
  const rows = listSalesEntriesSqlite();
  let revenue = 0;
  let orders = 0;
  let transactions = 0;
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;
    revenue += asNumber(row.revenue);
    orders += asNumber(row.orders);
    transactions += 1;
  }
  return { revenue, orders, transactions };
}

function sumPosPeriod(startDate: string, endDate: string): PeriodTotals {
  const rows = parsePosPayloads();
  let revenue = 0;
  let orders = 0;
  let transactions = 0;
  for (const row of rows) {
    const txDate = getPosDate(row);
    if (!txDate || txDate < startDate || txDate > endDate) continue;
    const net = getPosNetTotals(row);
    revenue += net.revenue;
    orders += net.orders;
    transactions += net.transactions;
  }
  return { revenue, orders, transactions };
}

function countExecutiveReportsPeriod(startDate: string, endDate: string): number {
  const rows = listExecutiveReportsSqlite(1000);
  let count = 0;
  for (const row of rows) {
    const date = String(row.createdAt ?? "").slice(0, 10);
    if (!date || date < startDate || date > endDate) continue;
    count += 1;
  }
  return count;
}

function buildPosHighlights(startDate: string, endDate: string): RetailSnapshotPayload["pos"] {
  const rows = parsePosPayloads();
  const storeMap = new Map<string, { storeName: string; revenue: number }>();
  const paymentMap = new Map<string, number>();
  const promoSet = new Set<string>();

  for (const row of rows) {
    const txDate = getPosDate(row);
    if (!txDate || txDate < startDate || txDate > endDate) continue;

    const net = getPosNetTotals(row);
    if (net.revenue <= 0) continue;

    const storeId = asString(row.storeId);
    const storeName = asString(row.storeName) || storeId || "unknown";
    if (storeId) {
      const current = storeMap.get(storeId) ?? { storeName, revenue: 0 };
      current.revenue += net.revenue;
      current.storeName = storeName;
      storeMap.set(storeId, current);
    }

    const promoCode = asString(row.promoCode).trim();
    if (promoCode) promoSet.add(promoCode.toUpperCase());

    const breakdown = Array.isArray(row.paymentBreakdown) ? row.paymentBreakdown : [];
    if (breakdown.length > 0) {
      for (const part of breakdown) {
        const obj = part as Record<string, unknown>;
        const method = asString(obj.method) || asString(row.paymentMethod) || "unknown";
        const amount = asNumber(obj.amount);
        paymentMap.set(method, (paymentMap.get(method) ?? 0) + amount);
      }
    } else {
      const method = asString(row.paymentMethod) || "unknown";
      paymentMap.set(method, (paymentMap.get(method) ?? 0) + net.revenue);
    }
  }

  const topStore = [...storeMap.entries()]
    .map(([storeId, value]) => ({ storeId, storeName: value.storeName, revenue: value.revenue }))
    .sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  const topPayment = [...paymentMap.entries()]
    .map(([method, revenue]) => ({ method, revenue }))
    .sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  return {
    topStore,
    topPayment,
    activePromotions: promoSet.size
  };
}

export function buildRetailSnapshot(snapshotDate = nowKstDate()): RetailSnapshotPayload {
  const weekStart = toWeekStartDate(snapshotDate);
  const monthStart = `${snapshotDate.slice(0, 8)}01`;

  const salesToday = sumSalesPeriod(snapshotDate, snapshotDate);
  const salesWeek = sumSalesPeriod(weekStart, snapshotDate);
  const salesMonth = sumSalesPeriod(monthStart, snapshotDate);

  const posToday = sumPosPeriod(snapshotDate, snapshotDate);
  const posWeek = sumPosPeriod(weekStart, snapshotDate);
  const posMonth = sumPosPeriod(monthStart, snapshotDate);

  const today: PeriodTotals = {
    revenue: salesToday.revenue + posToday.revenue,
    orders: salesToday.orders + posToday.orders,
    transactions: salesToday.transactions + posToday.transactions
  };
  const weekToDate: PeriodTotals = {
    revenue: salesWeek.revenue + posWeek.revenue,
    orders: salesWeek.orders + posWeek.orders,
    transactions: salesWeek.transactions + posWeek.transactions
  };
  const monthToDate: PeriodTotals = {
    revenue: salesMonth.revenue + posMonth.revenue,
    orders: salesMonth.orders + posMonth.orders,
    transactions: salesMonth.transactions + posMonth.transactions
  };

  return {
    generatedAt: new Date().toISOString(),
    snapshotDate,
    periodKpi: { today, weekToDate, monthToDate },
    channels: {
      salesRevenue: salesMonth.revenue,
      posRevenue: posMonth.revenue,
      totalRevenue: salesMonth.revenue + posMonth.revenue
    },
    executive: {
      reportsToday: countExecutiveReportsPeriod(snapshotDate, snapshotDate),
      reportsWeek: countExecutiveReportsPeriod(weekStart, snapshotDate),
      reportsMonth: countExecutiveReportsPeriod(monthStart, snapshotDate)
    },
    pos: buildPosHighlights(monthStart, snapshotDate)
  };
}

export function generateAndStoreRetailSnapshot(scope = "retail_kpi", snapshotDate = nowKstDate()): RetailSnapshotRecord {
  const payload = buildRetailSnapshot(snapshotDate);
  return upsertRetailSnapshotSqlite({
    scope,
    snapshotDate,
    payload: payload as unknown as Record<string, unknown>,
    createdAt: payload.generatedAt
  });
}

export function listRetailSnapshots(scope = "retail_kpi", limit = 30): RetailSnapshotRecord[] {
  return listRetailSnapshotsSqlite(scope, limit);
}

export function getLatestRetailSnapshot(scope = "retail_kpi"): RetailSnapshotRecord | null {
  const latest = listRetailSnapshotsSqlite(scope, 1)[0] ?? null;
  if (latest) return latest;
  return generateAndStoreRetailSnapshot(scope);
}
