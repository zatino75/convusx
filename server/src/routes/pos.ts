import fs from "node:fs";
import path from "node:path";
import { logger } from "../observability/logger.js";
import {
  listPosTransactionsSqlite,
  listSalesEntriesSqlite,
  upsertPosTransactionSqlite,
  upsertSalesEntrySqlite
} from "../memory/sqliteMemory.js";

const POS_PATH = "server/data/pos-transactions.jsonl";
const SALES_PATH = "server/data/sales.jsonl";
let posMigratedToSqlite = false;
let salesMirrorMigratedToSqlite = false;

type PaymentMethod = "card" | "cash" | "qr" | "gift";
type DiscountType = "none" | "rate" | "amount";
type PosTransactionStatus = "completed" | "partial_refunded" | "refunded";
type PromotionDiscountType = "rate" | "amount";

type PosCatalogItem = {
  barcode: string;
  name: string;
  price: number;
  category: string;
};

type PosStore = {
  id: string;
  name: string;
  city: string;
};

type PosLine = {
  barcode: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
};

type PosTransaction = {
  id: string;
  createdAt: string;
  date: string;
  storeId: string;
  storeName: string;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: Array<{ method: PaymentMethod; amount: number }>;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  promoCode?: string;
  promoDiscountAmount?: number;
  itemCount: number;
  subtotal: number;
  vat: number;
  total: number;
  items: PosLine[];
  status?: PosTransactionStatus;
  refundAmount?: number;
  refundedItemCount?: number;
  refundEvents?: Array<{
    id: string;
    createdAt: string;
    reason: string;
    total: number;
    itemCount: number;
    lines: PosLine[];
  }>;
  refundedAt?: string;
  refundReason?: string;
};

type PosPromotion = {
  code: string;
  title: string;
  description: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minSubtotal: number;
  storeIds?: string[];
  categories?: string[];
  active: boolean;
};

type PosPeriodSnapshot = {
  total: number;
  orders: number;
  transactions: number;
};

type PosAggregateMetrics = {
  daily7d: Array<{ date: string; total: number; transactions: number }>;
  daily30d: Array<{ date: string; total: number; transactions: number }>;
  periodKpi: {
    today: PosPeriodSnapshot;
    weekToDate: PosPeriodSnapshot;
    monthToDate: PosPeriodSnapshot;
  };
};

type SalesEntry = {
  id: string;
  date: string;
  platform: "smartstore" | "coupang" | "own" | "other";
  revenue: number;
  orders: number;
  memo?: string;
  createdAt: string;
};

const POS_CATALOG: PosCatalogItem[] = [
  { barcode: "8800101010011", name: "코지 라떼", price: 5800, category: "drink" },
  { barcode: "8800101010012", name: "시그니처 콜드브루", price: 6200, category: "drink" },
  { barcode: "8800101010013", name: "오트 샌드위치", price: 7300, category: "food" },
  { barcode: "8800101010014", name: "브런치 플레이트", price: 12800, category: "food" },
  { barcode: "8800101010015", name: "시즌 디저트", price: 6900, category: "dessert" }
];

const POS_STORES: PosStore[] = [
  { id: "store-seoul-gangnam", name: "강남 플래그십", city: "서울" },
  { id: "store-busan-centum", name: "센텀 시티점", city: "부산" },
  { id: "store-daegu-dongseong", name: "동성로점", city: "대구" },
  { id: "store-jeju-aewol", name: "애월 컨셉스토어", city: "제주" }
];

const POS_PROMOTIONS: PosPromotion[] = [
  {
    code: "WELCOME10",
    title: "신규 고객 10% 할인",
    description: "5,000원 이상 결제 시 10% 할인",
    discountType: "rate",
    discountValue: 10,
    minSubtotal: 5000,
    active: true
  },
  {
    code: "LUNCH2000",
    title: "런치 타임 2,000원 할인",
    description: "15,000원 이상 결제 시 2,000원 할인",
    discountType: "amount",
    discountValue: 2000,
    minSubtotal: 15000,
    active: true
  },
  {
    code: "DRINK15",
    title: "음료 15% 할인",
    description: "음료 포함 주문에 15% 할인 (최대 4,000원)",
    discountType: "rate",
    discountValue: 15,
    minSubtotal: 7000,
    categories: ["drink"],
    active: true
  },
  {
    code: "JEJU3000",
    title: "제주점 전용 3,000원 할인",
    description: "제주 애월점 20,000원 이상 결제 시 3,000원 할인",
    discountType: "amount",
    discountValue: 3000,
    minSubtotal: 20000,
    storeIds: ["store-jeju-aewol"],
    active: true
  }
];

let aggregateCache: { key: string; builtAt: number; metrics: PosAggregateMetrics } | null = null;

function ensureDataDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    logger.warn("[pos] jsonl read failed", { filePath, error: String(error) });
    return [];
  }
}

function writeJsonl<T>(filePath: string, entries: T[]) {
  ensureDataDir(filePath);
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(filePath, content + (entries.length > 0 ? "\n" : ""), "utf-8");
}

function toPosTransaction(input: Record<string, unknown>): PosTransaction | null {
  const id = String(input.id ?? "").trim();
  if (!id) return null;
  return input as unknown as PosTransaction;
}

function ensurePosMigrated() {
  if (posMigratedToSqlite) return;
  const sqliteRows = listPosTransactionsSqlite(1);
  if (sqliteRows.length === 0) {
    const jsonlRows = readJsonl<PosTransaction>(POS_PATH);
    for (const tx of jsonlRows) {
      upsertPosTransactionSqlite({
        id: tx.id,
        createdAt: tx.createdAt,
        date: tx.date,
        storeId: tx.storeId,
        storeName: tx.storeName,
        status: tx.status,
        total: tx.total,
        itemCount: tx.itemCount,
        payload: tx as unknown as Record<string, unknown>
      });
    }
  } else {
    const allSqlite = listPosTransactionsSqlite(0)
      .map((row) => toPosTransaction(row))
      .filter((row): row is PosTransaction => Boolean(row));
    writeJsonl(POS_PATH, allSqlite);
  }
  posMigratedToSqlite = true;
}

function readPosTransactionsFromStore(): PosTransaction[] {
  ensurePosMigrated();
  const sqliteRows = listPosTransactionsSqlite(0)
    .map((row) => toPosTransaction(row))
    .filter((row): row is PosTransaction => Boolean(row));
  if (sqliteRows.length > 0) {
    return sqliteRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return readJsonl<PosTransaction>(POS_PATH).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function persistPosTransactionToStore(tx: PosTransaction) {
  ensurePosMigrated();
  upsertPosTransactionSqlite({
    id: tx.id,
    createdAt: tx.createdAt,
    date: tx.date,
    storeId: tx.storeId,
    storeName: tx.storeName,
    status: tx.status,
    total: tx.total,
    itemCount: tx.itemCount,
    payload: tx as unknown as Record<string, unknown>
  });
}

function syncPosJsonlMirror() {
  const rows = readPosTransactionsFromStore();
  writeJsonl(POS_PATH, rows);
}

function ensureSalesMirrorMigrated() {
  if (salesMirrorMigratedToSqlite) return;
  const sqliteRows = listSalesEntriesSqlite();
  if (sqliteRows.length === 0) {
    const jsonlRows = readJsonl<SalesEntry>(SALES_PATH);
    for (const row of jsonlRows) {
      upsertSalesEntrySqlite({
        id: row.id,
        date: row.date,
        platform: row.platform,
        revenue: row.revenue,
        orders: row.orders,
        memo: row.memo,
        createdAt: row.createdAt
      });
    }
  } else {
    const normalized = sqliteRows.map((row) => ({
      id: row.id,
      date: row.date,
      platform: row.platform,
      revenue: Number(row.revenue ?? 0),
      orders: Number(row.orders ?? 0),
      memo: row.memo,
      createdAt: row.createdAt
    }));
    writeJsonl(SALES_PATH, normalized);
  }
  salesMirrorMigratedToSqlite = true;
}

function syncSalesJsonlMirror() {
  const rows = listSalesEntriesSqlite().map((row) => ({
    id: row.id,
    date: row.date,
    platform: row.platform,
    revenue: Number(row.revenue ?? 0),
    orders: Number(row.orders ?? 0),
    memo: row.memo,
    createdAt: row.createdAt
  }));
  writeJsonl(SALES_PATH, rows);
}

function nowKstDate(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function normalizePromotionCode(raw: string) {
  return String(raw ?? "").trim().toUpperCase();
}

function getActivePromotions() {
  return POS_PROMOTIONS.filter((item) => item.active);
}

function findPromotionByCode(code: string) {
  const normalized = normalizePromotionCode(code);
  if (!normalized) return null;
  return getActivePromotions().find((item) => item.code === normalized) ?? null;
}

function appendSalesFromPos(transaction: PosTransaction) {
  ensureSalesMirrorMigrated();
  const paymentMemo = transaction.paymentBreakdown && transaction.paymentBreakdown.length > 1
    ? transaction.paymentBreakdown.map((item) => `${item.method}:${item.amount}`).join(",")
    : transaction.paymentMethod;
  const entry: SalesEntry = {
    id: `sales_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: transaction.date,
    platform: "own",
    revenue: transaction.total,
    orders: transaction.itemCount,
    memo: `[POS:${transaction.storeName}] ${paymentMemo}`,
    createdAt: transaction.createdAt
  };
  upsertSalesEntrySqlite({
    id: entry.id,
    date: entry.date,
    platform: entry.platform,
    revenue: entry.revenue,
    orders: entry.orders,
    memo: entry.memo,
    createdAt: entry.createdAt
  });
  syncSalesJsonlMirror();
}

function appendSalesRefundFromPos(
  transaction: PosTransaction,
  refundedAt: string,
  reason: string,
  refundTotal: number,
  refundItemCount: number
) {
  ensureSalesMirrorMigrated();
  const entry: SalesEntry = {
    id: `sales_refund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: transaction.date,
    platform: "own",
    revenue: -Math.abs(refundTotal),
    orders: -Math.abs(refundItemCount),
    memo: `[POS REFUND:${transaction.storeName}] ${reason.slice(0, 60)} (${refundItemCount}ea)`,
    createdAt: refundedAt
  };
  upsertSalesEntrySqlite({
    id: entry.id,
    date: entry.date,
    platform: entry.platform,
    revenue: entry.revenue,
    orders: entry.orders,
    memo: entry.memo,
    createdAt: entry.createdAt
  });
  syncSalesJsonlMirror();
}

function getRefundEvents(tx: PosTransaction) {
  return Array.isArray(tx.refundEvents) ? tx.refundEvents : [];
}

function getRefundedQtyMap(tx: PosTransaction) {
  const map = new Map<string, number>();
  for (const event of getRefundEvents(tx)) {
    for (const line of event.lines ?? []) {
      map.set(line.barcode, (map.get(line.barcode) ?? 0) + Number(line.qty ?? 0));
    }
  }
  return map;
}

function getRemainingLines(tx: PosTransaction): PosLine[] {
  const refundedQtyMap = getRefundedQtyMap(tx);
  const lines: PosLine[] = [];
  for (const line of tx.items ?? []) {
    const refundedQty = refundedQtyMap.get(line.barcode) ?? 0;
    const remainQty = Math.max(0, Number(line.qty ?? 0) - refundedQty);
    if (remainQty <= 0) continue;
    lines.push({
      ...line,
      qty: remainQty,
      lineTotal: line.price * remainQty
    });
  }
  return lines;
}

function getRefundedAmount(tx: PosTransaction) {
  if (Number.isFinite(tx.refundAmount)) return Number(tx.refundAmount);
  return getRefundEvents(tx).reduce((sum, event) => sum + Number(event.total ?? 0), 0);
}

function getRefundedItemCount(tx: PosTransaction) {
  if (Number.isFinite(tx.refundedItemCount)) return Number(tx.refundedItemCount);
  return getRefundEvents(tx).reduce((sum, event) => sum + Number(event.itemCount ?? 0), 0);
}

function getNetTotal(tx: PosTransaction) {
  return Math.max(0, Number(tx.total ?? 0) - getRefundedAmount(tx));
}

function getNetItemCount(tx: PosTransaction) {
  return Math.max(0, Number(tx.itemCount ?? 0) - getRefundedItemCount(tx));
}

function getNetPaymentBreakdown(tx: PosTransaction): Array<{ method: PaymentMethod; amount: number }> {
  const netTotal = getNetTotal(tx);
  if (netTotal <= 0) return [];

  const base = Array.isArray(tx.paymentBreakdown) && tx.paymentBreakdown.length > 0
    ? tx.paymentBreakdown
    : [{ method: tx.paymentMethod, amount: Number(tx.total ?? 0) }];
  const totalBase = base.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);

  if (totalBase <= 0) return [{ method: tx.paymentMethod, amount: netTotal }];

  let remain = netTotal;
  const out: Array<{ method: PaymentMethod; amount: number }> = [];
  for (let i = 0; i < base.length; i += 1) {
    const item = base[i];
    if (i === base.length - 1) {
      out.push({ method: item.method, amount: remain });
      break;
    }
    const amount = Math.max(0, Math.round((Number(item.amount ?? 0) / totalBase) * netTotal));
    remain -= amount;
    out.push({ method: item.method, amount });
  }
  return out.filter((item) => item.amount > 0);
}

function buildStoreSummary(transactions: PosTransaction[]) {
  const summary: Record<string, { total: number; orders: number; transactions: number }> = {};
  for (const store of POS_STORES) {
    summary[store.id] = { total: 0, orders: 0, transactions: 0 };
  }

  for (const transaction of transactions) {
    const netTotal = getNetTotal(transaction);
    const netItems = getNetItemCount(transaction);
    if (netTotal <= 0 && netItems <= 0) continue;
    if (!summary[transaction.storeId]) {
      summary[transaction.storeId] = { total: 0, orders: 0, transactions: 0 };
    }
    summary[transaction.storeId].total += netTotal;
    summary[transaction.storeId].orders += netItems;
    summary[transaction.storeId].transactions += 1;
  }

  return summary;
}

function buildPaymentSummary(transactions: PosTransaction[]) {
  const summary: Record<PaymentMethod, { total: number; orders: number; transactions: number }> = {
    card: { total: 0, orders: 0, transactions: 0 },
    cash: { total: 0, orders: 0, transactions: 0 },
    qr: { total: 0, orders: 0, transactions: 0 },
    gift: { total: 0, orders: 0, transactions: 0 }
  };

  for (const transaction of transactions) {
    const netTotal = getNetTotal(transaction);
    const netItems = getNetItemCount(transaction);
    if (netTotal <= 0 && netItems <= 0) continue;
    const breakdown = getNetPaymentBreakdown(transaction);
    if (breakdown.length === 0) continue;

    for (const part of breakdown) {
      const slot = summary[part.method];
      if (!slot) continue;
      slot.total += part.amount;
      slot.transactions += 1;
    }
    summary[breakdown[0].method].orders += netItems;
  }

  return summary;
}

function buildRecentDaily(transactions: PosTransaction[], days = 7) {
  const map = new Map<string, { total: number; transactions: number }>();
  const now = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), { total: 0, transactions: 0 });
  }

  for (const tx of transactions) {
    const netTotal = getNetTotal(tx);
    if (netTotal <= 0) continue;
    const key = String(tx.createdAt).slice(0, 10);
    const slot = map.get(key);
    if (!slot) continue;
    slot.total += netTotal;
    slot.transactions += 1;
  }

  return [...map.entries()].map(([date, value]) => ({
    date,
    total: value.total,
    transactions: value.transactions
  }));
}

function buildPromotionSummary(transactions: PosTransaction[]) {
  const summary: Record<string, { total: number; transactions: number; discount: number }> = {};
  for (const tx of transactions) {
    const code = normalizePromotionCode(tx.promoCode ?? "");
    if (!code) continue;
    const netTotal = getNetTotal(tx);
    if (netTotal <= 0) continue;

    if (!summary[code]) summary[code] = { total: 0, transactions: 0, discount: 0 };
    summary[code].total += netTotal;
    summary[code].transactions += 1;

    const promoDiscount = Number(tx.promoDiscountAmount ?? 0);
    const scaledPromoDiscount = Number(tx.total ?? 0) > 0
      ? Math.round((netTotal / Number(tx.total)) * promoDiscount)
      : 0;
    summary[code].discount += Math.max(0, scaledPromoDiscount);
  }
  return summary;
}

function toKstDateStringFromDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function buildPeriodKpi(transactions: PosTransaction[]) {
  const today = nowKstDate();
  const todayDate = new Date(`${today}T00:00:00+09:00`);
  const weekStart = new Date(todayDate);
  weekStart.setUTCDate(todayDate.getUTCDate() - ((todayDate.getUTCDay() + 6) % 7));
  const weekStartDate = toKstDateStringFromDate(weekStart);
  const monthStartDate = `${today.slice(0, 8)}01`;

  const periodKpi = {
    today: { total: 0, orders: 0, transactions: 0 },
    weekToDate: { total: 0, orders: 0, transactions: 0 },
    monthToDate: { total: 0, orders: 0, transactions: 0 }
  };

  for (const tx of transactions) {
    const netTotal = getNetTotal(tx);
    const netOrders = getNetItemCount(tx);
    if (netTotal <= 0 && netOrders <= 0) continue;

    const txDate = String(tx.date ?? "").slice(0, 10) || String(tx.createdAt ?? "").slice(0, 10);
    if (!txDate) continue;

    if (txDate === today) {
      periodKpi.today.total += netTotal;
      periodKpi.today.orders += netOrders;
      periodKpi.today.transactions += 1;
    }
    if (txDate >= weekStartDate && txDate <= today) {
      periodKpi.weekToDate.total += netTotal;
      periodKpi.weekToDate.orders += netOrders;
      periodKpi.weekToDate.transactions += 1;
    }
    if (txDate >= monthStartDate && txDate <= today) {
      periodKpi.monthToDate.total += netTotal;
      periodKpi.monthToDate.orders += netOrders;
      periodKpi.monthToDate.transactions += 1;
    }
  }

  return periodKpi;
}

function buildAggregateMetrics(transactions: PosTransaction[]): PosAggregateMetrics {
  const key = [
    transactions.length,
    transactions[0]?.id ?? "none",
    transactions[0]?.status ?? "",
    getRefundedAmount(transactions[0] ?? { total: 0 } as PosTransaction),
    transactions[transactions.length - 1]?.id ?? "none"
  ].join(":");

  if (aggregateCache && aggregateCache.key === key && Date.now() - aggregateCache.builtAt < 20_000) {
    return aggregateCache.metrics;
  }

  const metrics: PosAggregateMetrics = {
    daily7d: buildRecentDaily(transactions, 7),
    daily30d: buildRecentDaily(transactions, 30),
    periodKpi: buildPeriodKpi(transactions)
  };

  aggregateCache = {
    key,
    builtAt: Date.now(),
    metrics
  };
  return metrics;
}

function normalizeTransactionStatus(tx: PosTransaction): PosTransactionStatus {
  if (tx.status === "refunded") return "refunded";
  if (tx.status === "partial_refunded") return "partial_refunded";
  const refundedAmount = getRefundedAmount(tx);
  if (refundedAmount >= Number(tx.total ?? 0) && Number(tx.total ?? 0) > 0) return "refunded";
  if (refundedAmount > 0) return "partial_refunded";
  return "completed";
}

function toDiscountAmount(subtotal: number, discountType: DiscountType, discountValue: number): number {
  if (subtotal <= 0) return 0;
  if (discountType === "rate") {
    const rate = Math.max(0, Math.min(80, discountValue));
    return Math.round(subtotal * (rate / 100));
  }
  if (discountType === "amount") {
    return Math.max(0, Math.min(subtotal, Math.round(discountValue)));
  }
  return 0;
}

function toPromotionDiscountAmount(baseTotal: number, mappedLines: PosLine[], storeId: string, promotion: PosPromotion | null): number {
  if (!promotion) return 0;
  if (baseTotal <= 0) return 0;
  if (baseTotal < promotion.minSubtotal) return 0;
  if (Array.isArray(promotion.storeIds) && promotion.storeIds.length > 0 && !promotion.storeIds.includes(storeId)) return 0;

  if (Array.isArray(promotion.categories) && promotion.categories.length > 0) {
    const allowedSet = new Set(promotion.categories);
    const categoryBase = mappedLines
      .filter((line) => {
        const product = POS_CATALOG.find((item) => item.barcode === line.barcode);
        return product ? allowedSet.has(product.category) : false;
      })
      .reduce((sum, line) => sum + line.lineTotal, 0);
    if (categoryBase <= 0) return 0;
    if (promotion.discountType === "rate") {
      const discount = Math.round(categoryBase * (promotion.discountValue / 100));
      return Math.max(0, Math.min(baseTotal, discount, 4000));
    }
    return Math.max(0, Math.min(baseTotal, Math.round(promotion.discountValue)));
  }

  if (promotion.discountType === "rate") {
    const discount = Math.round(baseTotal * (promotion.discountValue / 100));
    return Math.max(0, Math.min(baseTotal, discount));
  }
  return Math.max(0, Math.min(baseTotal, Math.round(promotion.discountValue)));
}

export async function getPosRoute(_req: unknown, res: any) {
  const allTransactions = readPosTransactionsFromStore();
  const transactions = allTransactions.slice(0, 60);
  const aggregateSource = allTransactions.slice(0, 400);
  const aggregateMetrics = buildAggregateMetrics(aggregateSource);

  return res.json({
    ok: true,
    stores: POS_STORES,
    catalog: POS_CATALOG,
    promotions: getActivePromotions(),
    transactions,
    summaryByStore: buildStoreSummary(aggregateSource),
    paymentSummary: buildPaymentSummary(aggregateSource),
    promotionSummary: buildPromotionSummary(aggregateSource),
    daily7d: aggregateMetrics.daily7d,
    daily30d: aggregateMetrics.daily30d,
    periodKpi: aggregateMetrics.periodKpi
  });
}

export async function checkoutPosRoute(req: any, res: any) {
  const body = (req.body ?? {}) as {
    storeId?: string;
    paymentMethod?: PaymentMethod;
    discountType?: DiscountType;
    discountValue?: number;
    promoCode?: string;
    splitPayment?: {
      method?: PaymentMethod;
      amount?: number;
    };
    lines?: Array<{ barcode?: string; qty?: number }>;
  };

  const storeId = String(body.storeId ?? "");
  const paymentMethod = (body.paymentMethod ?? "card") as PaymentMethod;
  const discountType = (body.discountType ?? "none") as DiscountType;
  const discountValue = Number(body.discountValue ?? 0);
  const promoCode = normalizePromotionCode(String(body.promoCode ?? ""));
  const promotion = promoCode ? findPromotionByCode(promoCode) : null;
  const splitPayment = body.splitPayment;
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!storeId) return res.json({ ok: false, error: "storeId required" });
  if (lines.length === 0) return res.json({ ok: false, error: "lines required" });

  const store = POS_STORES.find((item) => item.id === storeId);
  if (!store) return res.json({ ok: false, error: "invalid storeId" });

  if (!["card", "cash", "qr", "gift"].includes(paymentMethod)) {
    return res.json({ ok: false, error: "invalid paymentMethod" });
  }
  if (!["none", "rate", "amount"].includes(discountType)) {
    return res.json({ ok: false, error: "invalid discountType" });
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return res.json({ ok: false, error: "invalid discountValue" });
  }
  if (promoCode && !promotion) {
    return res.json({ ok: false, error: "invalid promoCode" });
  }

  const mappedLines: PosLine[] = [];
  for (const rawLine of lines) {
    const barcode = String(rawLine?.barcode ?? "");
    const qty = Number(rawLine?.qty ?? 0);

    if (!barcode) return res.json({ ok: false, error: "barcode required" });
    if (!Number.isInteger(qty) || qty <= 0 || qty > 99) {
      return res.json({ ok: false, error: "qty must be 1..99" });
    }

    const product = POS_CATALOG.find((item) => item.barcode === barcode);
    if (!product) return res.json({ ok: false, error: `unknown barcode: ${barcode}` });

    mappedLines.push({
      barcode: product.barcode,
      name: product.name,
      price: product.price,
      qty,
      lineTotal: product.price * qty
    });
  }

  const subtotal = mappedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountAmount = toDiscountAmount(subtotal, discountType, discountValue);
  const baseAfterManualDiscount = Math.max(0, subtotal - discountAmount);
  const promoDiscountAmount = toPromotionDiscountAmount(baseAfterManualDiscount, mappedLines, store.id, promotion);
  const total = Math.max(0, subtotal - discountAmount - promoDiscountAmount);
  const vat = Math.round(total / 11);
  const itemCount = mappedLines.reduce((sum, line) => sum + line.qty, 0);
  const createdAt = new Date().toISOString();
  let paymentBreakdown: Array<{ method: PaymentMethod; amount: number }> = [
    { method: paymentMethod, amount: total }
  ];

  if (splitPayment && total > 0) {
    const secondaryMethod = splitPayment.method as PaymentMethod;
    const secondaryAmountRaw = Number(splitPayment.amount ?? 0);
    if (!["card", "cash", "qr", "gift"].includes(String(secondaryMethod))) {
      return res.json({ ok: false, error: "invalid split payment method" });
    }
    if (secondaryMethod === paymentMethod) {
      return res.json({ ok: false, error: "split payment method must be different" });
    }
    if (!Number.isFinite(secondaryAmountRaw)) {
      return res.json({ ok: false, error: "invalid split amount" });
    }
    const secondaryAmount = Math.round(secondaryAmountRaw);
    if (secondaryAmount <= 0 || secondaryAmount >= total) {
      return res.json({ ok: false, error: "split amount must be between 1 and total-1" });
    }
    paymentBreakdown = [
      { method: paymentMethod, amount: total - secondaryAmount },
      { method: secondaryMethod, amount: secondaryAmount }
    ];
  }

  const transaction: PosTransaction = {
    id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    date: nowKstDate(),
    storeId: store.id,
    storeName: store.name,
    paymentMethod,
    paymentBreakdown,
    discountType,
    discountValue: discountType === "none" ? 0 : discountValue,
    discountAmount,
    promoCode: promotion?.code,
    promoDiscountAmount,
    itemCount,
    subtotal,
    vat,
    total,
    items: mappedLines,
    status: "completed",
    refundAmount: 0,
    refundedItemCount: 0,
    refundEvents: []
  };

  persistPosTransactionToStore(transaction);
  syncPosJsonlMirror();
  const transactions = readPosTransactionsFromStore();

  appendSalesFromPos(transaction);

  logger.info("[pos] checkout completed", {
    id: transaction.id,
    storeId: transaction.storeId,
    total: transaction.total,
    itemCount: transaction.itemCount,
    paymentMethod: transaction.paymentMethod,
    splitCount: transaction.paymentBreakdown?.length ?? 1,
    discountAmount: transaction.discountAmount ?? 0,
    promoCode: transaction.promoCode ?? null,
    promoDiscountAmount: transaction.promoDiscountAmount ?? 0
  });

  const aggregateSource = transactions.slice(0, 400);
  const aggregateMetrics = buildAggregateMetrics(aggregateSource);

  return res.json({
    ok: true,
    transaction,
    summaryByStore: buildStoreSummary(aggregateSource),
    paymentSummary: buildPaymentSummary(aggregateSource),
    promotionSummary: buildPromotionSummary(aggregateSource),
    daily7d: aggregateMetrics.daily7d,
    daily30d: aggregateMetrics.daily30d,
    periodKpi: aggregateMetrics.periodKpi
  });
}

export async function refundPosRoute(req: any, res: any) {
  const body = (req.body as Record<string, unknown>) ?? {};
  const id = String(body.id ?? "").trim();
  const reason = String(body.reason ?? "운영자 취소").trim() || "운영자 취소";
  const rawLines = Array.isArray(body.lines) ? body.lines as Array<{ barcode?: string; qty?: number }> : [];
  if (!id) return res.json({ ok: false, error: "id required" });

  const transactions = readPosTransactionsFromStore();
  const index = transactions.findIndex((item) => item.id === id);
  if (index < 0) return res.json({ ok: false, error: "transaction not found" });

  const target = transactions[index];
  if (normalizeTransactionStatus(target) === "refunded") {
    return res.json({ ok: false, error: "transaction already fully refunded" });
  }

  const remainingLines = getRemainingLines(target);
  if (remainingLines.length === 0) {
    return res.json({ ok: false, error: "no refundable lines remaining" });
  }

  const requestedQtyByBarcode = new Map<string, number>();
  if (rawLines.length > 0) {
    for (const line of rawLines) {
      const barcode = String(line?.barcode ?? "").trim();
      const qty = Number(line?.qty ?? 0);
      if (!barcode) return res.json({ ok: false, error: "refund barcode required" });
      if (!Number.isInteger(qty) || qty <= 0) return res.json({ ok: false, error: "refund qty must be positive integer" });
      requestedQtyByBarcode.set(barcode, (requestedQtyByBarcode.get(barcode) ?? 0) + qty);
    }
  }

  const refundLines: PosLine[] = [];
  if (requestedQtyByBarcode.size === 0) {
    for (const line of remainingLines) {
      refundLines.push({ ...line });
    }
  } else {
    for (const [barcode, qty] of requestedQtyByBarcode.entries()) {
      const remainLine = remainingLines.find((line) => line.barcode === barcode);
      if (!remainLine) return res.json({ ok: false, error: `barcode not refundable: ${barcode}` });
      if (qty > remainLine.qty) {
        return res.json({ ok: false, error: `refund qty exceeds remaining qty: ${barcode}` });
      }
      refundLines.push({
        ...remainLine,
        qty,
        lineTotal: remainLine.price * qty
      });
    }
  }

  if (refundLines.length === 0) {
    return res.json({ ok: false, error: "refund lines required" });
  }

  const remainingSubtotal = remainingLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const refundSubtotal = refundLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const remainingNetTotal = getNetTotal(target);
  if (remainingNetTotal <= 0) {
    return res.json({ ok: false, error: "transaction net total is zero" });
  }

  const isRefundAll = (
    refundLines.length === remainingLines.length &&
    refundLines.every((line) => {
      const remain = remainingLines.find((item) => item.barcode === line.barcode);
      return remain ? remain.qty === line.qty : false;
    })
  );

  let refundTotal = remainingNetTotal;
  if (!isRefundAll) {
    if (remainingSubtotal > 0) {
      refundTotal = Math.round((refundSubtotal / remainingSubtotal) * remainingNetTotal);
      refundTotal = Math.max(1, Math.min(refundTotal, remainingNetTotal));
    } else {
      refundTotal = Math.min(remainingNetTotal, Math.max(1, refundSubtotal));
    }
  }

  const refundedAt = new Date().toISOString();
  const refundItemCount = refundLines.reduce((sum, line) => sum + line.qty, 0);
  const event = {
    id: `refund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: refundedAt,
    reason,
    total: refundTotal,
    itemCount: refundItemCount,
    lines: refundLines
  };
  const nextRefundAmount = Math.max(0, Math.min(Number(target.total ?? 0), getRefundedAmount(target) + refundTotal));
  const nextRefundedItemCount = Math.max(0, Math.min(Number(target.itemCount ?? 0), getRefundedItemCount(target) + refundItemCount));
  const nextStatus: PosTransactionStatus = (
    isRefundAll ||
    nextRefundAmount >= Number(target.total ?? 0) ||
    nextRefundedItemCount >= Number(target.itemCount ?? 0)
  ) ? "refunded" : "partial_refunded";

  const nextTarget: PosTransaction = {
    ...target,
    status: nextStatus,
    refundAmount: nextRefundAmount,
    refundedItemCount: nextRefundedItemCount,
    refundEvents: [...getRefundEvents(target), event],
    refundedAt: nextStatus === "refunded" ? refundedAt : target.refundedAt,
    refundReason: nextStatus === "refunded" ? reason : target.refundReason
  };
  persistPosTransactionToStore(nextTarget);
  syncPosJsonlMirror();
  const updatedTransactions = readPosTransactionsFromStore();
  appendSalesRefundFromPos(nextTarget, refundedAt, reason, refundTotal, refundItemCount);

  logger.info("[pos] refund completed", {
    id: nextTarget.id,
    storeId: nextTarget.storeId,
    reason,
    status: nextTarget.status,
    refundTotal,
    refundItemCount
  });

  const aggregateSource = updatedTransactions.slice(0, 400);
  const aggregateMetrics = buildAggregateMetrics(aggregateSource);

  return res.json({
    ok: true,
    transaction: nextTarget,
    summaryByStore: buildStoreSummary(updatedTransactions.slice(0, 400)),
    paymentSummary: buildPaymentSummary(updatedTransactions.slice(0, 400)),
    promotionSummary: buildPromotionSummary(updatedTransactions.slice(0, 400)),
    daily7d: aggregateMetrics.daily7d,
    daily30d: aggregateMetrics.daily30d,
    periodKpi: aggregateMetrics.periodKpi
  });
}
