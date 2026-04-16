import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../api/url";
import {
  getLatestExecutiveReport,
  syncExecutiveReports,
  type ExecutiveReport
} from "../../store/executiveStore";

type PaymentMethod = "card" | "cash" | "qr" | "gift";
type DiscountType = "none" | "rate" | "amount";
type TxStatus = "completed" | "partial_refunded" | "refunded";
type TxFilter = "all" | TxStatus;
type PromotionDiscountType = "rate" | "amount";

type Product = {
  barcode: string;
  name: string;
  price: number;
  category: string;
};

type Store = {
  id: string;
  name: string;
  city: string;
};

type CartLine = Product & {
  qty: number;
};

type TxLine = {
  barcode: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
};

type TxRefundEvent = {
  id: string;
  createdAt: string;
  reason: string;
  total: number;
  itemCount: number;
  lines: TxLine[];
};

type Transaction = {
  id: string;
  createdAt: string;
  storeId: string;
  storeName: string;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: Array<{ method: PaymentMethod; amount: number }>;
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
  promoCode?: string;
  promoDiscountAmount?: number;
  total: number;
  itemCount: number;
  items: TxLine[];
  refundAmount?: number;
  refundedItemCount?: number;
  refundEvents?: TxRefundEvent[];
  status?: TxStatus;
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

type SummaryByStore = Record<string, { total: number; orders: number; transactions: number }>;
type PaymentSummary = Record<PaymentMethod, { total: number; orders: number; transactions: number }>;

type PosResponse = {
  ok: boolean;
  stores: Store[];
  catalog: Product[];
  promotions?: PosPromotion[];
  transactions: Transaction[];
  summaryByStore: SummaryByStore;
  paymentSummary?: PaymentSummary;
  daily7d?: Array<{ date: string; total: number; transactions: number }>;
};

type PosUiSnapshot = {
  storeId?: string;
  scanAutoMode?: boolean;
  paymentMethod?: PaymentMethod;
  discountType?: DiscountType;
  discountValue?: string;
  splitEnabled?: boolean;
  splitMethod?: PaymentMethod;
  splitAmount?: string;
  promoCodeInput?: string;
  appliedPromoCode?: string;
  cart?: Array<{ barcode: string; qty: number }>;
};

type Props = {
  onOpenWorkforce?: () => void;
  onOpenStoreOps?: () => void;
  onOpenSales?: () => void;
};

const paymentLabels: Record<PaymentMethod, string> = {
  card: "카드",
  cash: "현금",
  qr: "QR 결제",
  gift: "상품권"
};

const POS_UI_SNAPSHOT_KEY = "convusx.pos.ui.v1";

function readPosUiSnapshot(): PosUiSnapshot {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(POS_UI_SNAPSHOT_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PosUiSnapshot;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePosUiSnapshot(snapshot: PosUiSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POS_UI_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function formatKRW(value: number): string {
  return `${value.toLocaleString()}원`;
}

function vatIncluded(total: number): number {
  return Math.round(total / 11);
}

function recommendPaymentMethod(report: ExecutiveReport | null): PaymentMethod {
  const text = `${report?.topic ?? ""} ${report?.directive ?? ""} ${report?.summary ?? ""} ${(report?.recommendations ?? []).join(" ")}`;
  if (text.includes("현금")) return "cash";
  if (text.toLowerCase().includes("qr") || text.includes("간편결제")) return "qr";
  if (text.includes("상품권") || text.includes("기프트")) return "gift";
  return "card";
}

function recommendStoreId(report: ExecutiveReport | null, stores: Store[]): string | null {
  if (stores.length === 0) return null;
  const text = `${report?.topic ?? ""} ${report?.directive ?? ""} ${report?.summary ?? ""}`;
  if (text.includes("강남") || text.includes("서울")) return "store-seoul-gangnam";
  if (text.includes("부산") || text.includes("센텀")) return "store-busan-centum";
  if (text.includes("대구") || text.includes("동성로")) return "store-daegu-dongseong";
  if (text.includes("제주") || text.includes("애월")) return "store-jeju-aewol";
  return stores[0]?.id ?? null;
}

function calcDiscountAmount(subtotal: number, discountType: DiscountType, discountValueRaw: string): number {
  const discountValue = Number(discountValueRaw || 0);
  if (!Number.isFinite(discountValue) || discountValue <= 0) return 0;
  if (discountType === "rate") {
    const rate = Math.max(0, Math.min(80, discountValue));
    return Math.round(subtotal * (rate / 100));
  }
  if (discountType === "amount") {
    return Math.max(0, Math.min(subtotal, Math.round(discountValue)));
  }
  return 0;
}

function normalizePromoCode(code: string) {
  return String(code ?? "").trim().toUpperCase();
}

function calcPromotionPreviewDiscount(
  baseTotal: number,
  cart: CartLine[],
  storeId: string,
  promotion: PosPromotion | null
) {
  if (!promotion) return 0;
  if (baseTotal <= 0) return 0;
  if (baseTotal < promotion.minSubtotal) return 0;
  if (Array.isArray(promotion.storeIds) && promotion.storeIds.length > 0 && !promotion.storeIds.includes(storeId)) return 0;

  if (Array.isArray(promotion.categories) && promotion.categories.length > 0) {
    const categorySet = new Set(promotion.categories);
    const categoryBase = cart
      .filter((line) => categorySet.has(line.category))
      .reduce((sum, line) => sum + line.price * line.qty, 0);
    if (categoryBase <= 0) return 0;
    if (promotion.discountType === "rate") {
      return Math.max(0, Math.min(baseTotal, Math.round(categoryBase * (promotion.discountValue / 100)), 4000));
    }
    return Math.max(0, Math.min(baseTotal, Math.round(promotion.discountValue)));
  }

  if (promotion.discountType === "rate") {
    return Math.max(0, Math.min(baseTotal, Math.round(baseTotal * (promotion.discountValue / 100))));
  }
  return Math.max(0, Math.min(baseTotal, Math.round(promotion.discountValue)));
}

function getRefundedQtyMap(tx: Transaction) {
  const map = new Map<string, number>();
  for (const event of tx.refundEvents ?? []) {
    for (const line of event.lines ?? []) {
      map.set(line.barcode, (map.get(line.barcode) ?? 0) + line.qty);
    }
  }
  return map;
}

function getRefundableLines(tx: Transaction): TxLine[] {
  const refundedQtyMap = getRefundedQtyMap(tx);
  const lines: TxLine[] = [];
  for (const line of tx.items ?? []) {
    const remainQty = Math.max(0, line.qty - (refundedQtyMap.get(line.barcode) ?? 0));
    if (remainQty <= 0) continue;
    lines.push({
      ...line,
      qty: remainQty,
      lineTotal: line.price * remainQty
    });
  }
  return lines;
}

function getTxStatus(tx: Transaction): TxStatus {
  if (tx.status === "partial_refunded" || tx.status === "refunded") return tx.status;
  const refundAmount = Number(tx.refundAmount ?? 0);
  if (refundAmount >= tx.total && tx.total > 0) return "refunded";
  if (refundAmount > 0) return "partial_refunded";
  return "completed";
}

export function PosView({ onOpenWorkforce, onOpenStoreOps, onOpenSales }: Props) {
  const initialUiSnapshotRef = useRef<PosUiSnapshot>(readPosUiSnapshot());
  const restoredCartRef = useRef(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PosPromotion[]>([]);
  const [summaryByStore, setSummaryByStore] = useState<SummaryByStore>({});
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [storeId, setStoreId] = useState<string>(() => initialUiSnapshotRef.current.storeId ?? "");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanAutoMode, setScanAutoMode] = useState(() => initialUiSnapshotRef.current.scanAutoMode ?? true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => initialUiSnapshotRef.current.paymentMethod ?? "card");
  const [discountType, setDiscountType] = useState<DiscountType>(() => initialUiSnapshotRef.current.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(() => initialUiSnapshotRef.current.discountValue ?? "");
  const [splitEnabled, setSplitEnabled] = useState(() => initialUiSnapshotRef.current.splitEnabled ?? false);
  const [splitMethod, setSplitMethod] = useState<PaymentMethod>(() => initialUiSnapshotRef.current.splitMethod ?? "cash");
  const [splitAmount, setSplitAmount] = useState(() => initialUiSnapshotRef.current.splitAmount ?? "");
  const [promoCodeInput, setPromoCodeInput] = useState(() => initialUiSnapshotRef.current.promoCodeInput ?? "");
  const [appliedPromoCode, setAppliedPromoCode] = useState(() => initialUiSnapshotRef.current.appliedPromoCode ?? "");
  const [message, setMessage] = useState<string>("바코드를 스캔하면 자동으로 장바구니에 추가됩니다.");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [latestExecutiveReport, setLatestExecutiveReport] = useState<ExecutiveReport | null>(() => getLatestExecutiveReport());
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [partialTargetId, setPartialTargetId] = useState<string | null>(null);
  const [partialBarcode, setPartialBarcode] = useState("");
  const [partialQty, setPartialQty] = useState("1");
  const [partialReason, setPartialReason] = useState("부분 환불");
  const [txFilter, setTxFilter] = useState<TxFilter>("all");
  const [scanLog, setScanLog] = useState<Array<{ id: string; barcode: string; name: string; at: string }>>([]);
  const lastPresetReportIdRef = useRef<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const scannerBufferRef = useRef("");
  const scannerInputAtRef = useRef(0);

  const selectedStore = stores.find((item) => item.id === storeId) ?? stores[0] ?? null;
  const partialTarget = transactions.find((tx) => tx.id === partialTargetId) ?? null;
  const partialRefundableLines = useMemo(
    () => (partialTarget ? getRefundableLines(partialTarget) : []),
    [partialTarget]
  );

  async function refreshPosData(showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const response = await apiFetch("/api/pos");
      const data = await response.json() as PosResponse;
      if (!data.ok) throw new Error("bootstrap_failed");
      setStores(data.stores);
      setCatalog(data.catalog);
      setPromotions(Array.isArray(data.promotions) ? data.promotions.filter((item) => item.active) : []);
      setTransactions(data.transactions);
      setSummaryByStore(data.summaryByStore ?? {});
      setPaymentSummary(data.paymentSummary ?? null);
      setStoreId((prev) => prev || data.stores[0]?.id || "");
      setLatestExecutiveReport(getLatestExecutiveReport());
    } catch {
      setMessage("POS 데이터를 불러오지 못했습니다.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshPosData(true);
    void syncExecutiveReports(8).then((items) => {
      setLatestExecutiveReport(items[0] ?? null);
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "convusx.executive-reports.v1") {
        setLatestExecutiveReport(getLatestExecutiveReport());
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      barcodeInputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    if (restoredCartRef.current) return;
    if (catalog.length === 0) return;
    const snapshotCart = initialUiSnapshotRef.current.cart;
    if (!Array.isArray(snapshotCart) || snapshotCart.length === 0) {
      restoredCartRef.current = true;
      return;
    }

    const restored = snapshotCart
      .map((item) => {
        const product = catalog.find((productItem) => productItem.barcode === item.barcode);
        if (!product) return null;
        const qty = Number(item.qty ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) return null;
        return { ...product, qty: Math.max(1, Math.min(99, Math.round(qty))) };
      })
      .filter(Boolean) as CartLine[];

    if (restored.length > 0) {
      setCart(restored);
      setMessage(`이전 POS 작업(${restored.length}개 품목)을 복구했습니다.`);
    }
    restoredCartRef.current = true;
  }, [catalog]);

  useEffect(() => {
    writePosUiSnapshot({
      storeId,
      scanAutoMode,
      paymentMethod,
      discountType,
      discountValue,
      splitEnabled,
      splitMethod,
      splitAmount,
      promoCodeInput,
      appliedPromoCode,
      cart: cart.map((line) => ({ barcode: line.barcode, qty: line.qty }))
    });
  }, [
    storeId,
    scanAutoMode,
    paymentMethod,
    discountType,
    discountValue,
    splitEnabled,
    splitMethod,
    splitAmount,
    promoCodeInput,
    appliedPromoCode,
    cart
  ]);

  useEffect(() => {
    const reportId = latestExecutiveReport?.id ?? null;
    if (!reportId || lastPresetReportIdRef.current === reportId) return;
    lastPresetReportIdRef.current = reportId;

    const nextMethod = recommendPaymentMethod(latestExecutiveReport);
    const nextStoreId = recommendStoreId(latestExecutiveReport, stores);

    setPaymentMethod(nextMethod);
    if (nextStoreId) setStoreId(nextStoreId);
    setMessage(`AI 프리셋 적용 · ${paymentLabels[nextMethod]} 결제 우선`);
  }, [latestExecutiveReport, stores]);

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.qty, 0),
    [cart]
  );
  const appliedPromotion = useMemo(
    () => promotions.find((item) => item.code === appliedPromoCode) ?? null,
    [promotions, appliedPromoCode]
  );
  const discountAmount = useMemo(
    () => calcDiscountAmount(subtotal, discountType, discountValue),
    [subtotal, discountType, discountValue]
  );
  const promoDiscountAmount = useMemo(
    () => calcPromotionPreviewDiscount(Math.max(0, subtotal - discountAmount), cart, storeId, appliedPromotion),
    [subtotal, discountAmount, cart, storeId, appliedPromotion]
  );
  const total = Math.max(0, subtotal - discountAmount - promoDiscountAmount);
  const vat = vatIncluded(total);
  const splitSecondaryAmount = useMemo(() => {
    if (!splitEnabled) return 0;
    const raw = Number(splitAmount || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.max(0, Math.min(Math.round(raw), Math.max(0, total - 1)));
  }, [splitAmount, splitEnabled, total]);
  const splitPrimaryAmount = Math.max(0, total - splitSecondaryAmount);

  const paymentMixTop2 = useMemo(() => {
    if (!paymentSummary) return [];
    return (Object.entries(paymentSummary) as Array<[PaymentMethod, { total: number }]>)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 2);
  }, [paymentSummary]);
  const txStatusCount = useMemo(() => {
    return transactions.reduce(
      (acc, tx) => {
        const status = getTxStatus(tx);
        acc.all += 1;
        acc[status] += 1;
        return acc;
      },
      { all: 0, completed: 0, partial_refunded: 0, refunded: 0 } as Record<TxFilter, number>
    );
  }, [transactions]);
  const filteredTransactions = useMemo(() => {
    if (txFilter === "all") return transactions;
    return transactions.filter((tx) => getTxStatus(tx) === txFilter);
  }, [transactions, txFilter]);

  const flowStage = checkingOut ? 3 : transactions.length > 0 ? 4 : cart.length > 0 ? 2 : 1;
  const flowItems: Array<{ step: number; label: string }> = [
    { step: 1, label: "스캔" },
    { step: 2, label: "카트" },
    { step: 3, label: "결제" },
    { step: 4, label: "보고" }
  ];

  useEffect(() => {
    if (!appliedPromotion) return;
    const eligible = calcPromotionPreviewDiscount(Math.max(0, subtotal - discountAmount), cart, storeId, appliedPromotion) > 0;
    if (!eligible) {
      setAppliedPromoCode("");
      if (promoCodeInput.trim()) {
        setMessage("프로모션 조건이 맞지 않아 자동 해제되었습니다.");
      }
    }
  }, [appliedPromotion, subtotal, discountAmount, cart, storeId, promoCodeInput]);

  function applyPromoCode() {
    const normalized = normalizePromoCode(promoCodeInput);
    if (!normalized) {
      setAppliedPromoCode("");
      setMessage("프로모션 코드를 입력하세요.");
      return;
    }
    const found = promotions.find((item) => item.code === normalized) ?? null;
    if (!found) {
      setAppliedPromoCode("");
      setMessage("유효하지 않은 프로모션 코드입니다.");
      return;
    }
    const discount = calcPromotionPreviewDiscount(Math.max(0, subtotal - discountAmount), cart, storeId, found);
    if (discount <= 0) {
      setAppliedPromoCode("");
      setMessage("프로모션 조건(최소금액/매장/카테고리)을 충족하지 않습니다.");
      return;
    }
    setAppliedPromoCode(found.code);
    setPromoCodeInput(found.code);
    setMessage(`프로모션 적용: ${found.code} (-${formatKRW(discount)})`);
  }

  function addByBarcode(rawBarcode: string) {
    const barcode = rawBarcode.trim();
    if (!barcode) return;

    const product = catalog.find((item) => item.barcode === barcode);
    if (!product) {
      setMessage(`미등록 바코드: ${barcode}`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((line) => line.barcode === product.barcode);
      if (existing) {
        return prev.map((line) => (
          line.barcode === product.barcode ? { ...line, qty: line.qty + 1 } : line
        ));
      }
      return [...prev, { ...product, qty: 1 }];
    });
    setScanLog((prev) => [
      { id: `${product.barcode}-${Date.now()}`, barcode: product.barcode, name: product.name, at: new Date().toLocaleTimeString() },
      ...prev
    ].slice(0, 6));
    setMessage(`추가됨 · ${product.name}`);
    setBarcodeInput("");
  }

  function updateQty(barcode: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((line) => line.barcode !== barcode));
      return;
    }
    setCart((prev) => prev.map((line) => (
      line.barcode === barcode ? { ...line, qty: nextQty } : line
    )));
  }

  async function checkout() {
    if (!storeId) {
      setMessage("매장을 먼저 선택하세요.");
      return;
    }

    if (cart.length === 0) {
      setMessage("결제할 품목이 없습니다.");
      return;
    }

    if (splitEnabled && splitMethod === paymentMethod) {
      setMessage("분할결제 수단은 기본 결제수단과 달라야 합니다.");
      return;
    }

    if (splitEnabled && (splitSecondaryAmount <= 0 || splitSecondaryAmount >= total)) {
      setMessage("분할결제 금액을 1원 이상, 총액 미만으로 입력하세요.");
      return;
    }

    setCheckingOut(true);
    try {
      const response = await apiFetch("/api/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          paymentMethod,
          discountType,
          discountValue: discountType === "none" ? 0 : Number(discountValue || 0),
          promoCode: appliedPromotion?.code,
          splitPayment: splitEnabled
            ? { method: splitMethod, amount: splitSecondaryAmount }
            : undefined,
          lines: cart.map((line) => ({ barcode: line.barcode, qty: line.qty }))
        })
      });

      const data = await response.json() as {
        ok: boolean;
        error?: string;
        transaction?: Transaction;
        summaryByStore?: SummaryByStore;
        paymentSummary?: PaymentSummary;
      };
      if (!data.ok || !data.transaction) {
        setMessage(`결제 실패: ${data.error ?? "unknown"}`);
        return;
      }

      setTransactions((prev) => [data.transaction as Transaction, ...prev].slice(0, 60));
      if (data.summaryByStore) setSummaryByStore(data.summaryByStore);
      if (data.paymentSummary) setPaymentSummary(data.paymentSummary);
      setCart([]);
      setSplitAmount("");
      setMessage(`결제 완료 · ${formatKRW(data.transaction.total)} · ${splitEnabled ? "분할결제" : paymentLabels[paymentMethod]}${appliedPromotion ? ` · ${appliedPromotion.code}` : ""}`);

      void refreshPosData(false);
    } catch {
      setMessage("결제 처리 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCheckingOut(false);
    }
  }

  async function requestRefund(
    tx: Transaction,
    payload?: { lines?: Array<{ barcode: string; qty: number }>; reason?: string }
  ) {
    if (!tx.id || getTxStatus(tx) === "refunded") return false;
    setRefundingId(tx.id);
    try {
      const response = await apiFetch("/api/pos/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tx.id,
          reason: payload?.reason ?? "POS 화면 취소",
          lines: payload?.lines
        })
      });
      const data = await response.json() as {
        ok: boolean;
        error?: string;
        transaction?: Transaction;
        summaryByStore?: SummaryByStore;
        paymentSummary?: PaymentSummary;
      };
      if (!data.ok || !data.transaction) {
        setMessage(`환불 실패: ${data.error ?? "unknown"}`);
        return false;
      }
      setTransactions((prev) => prev.map((item) => (item.id === tx.id ? data.transaction as Transaction : item)));
      if (data.summaryByStore) setSummaryByStore(data.summaryByStore);
      if (data.paymentSummary) setPaymentSummary(data.paymentSummary);
      setMessage(`환불 완료 · ${tx.storeName} · ${formatKRW(data.transaction.refundAmount ?? data.transaction.total)}`);
      void refreshPosData(false);
      return true;
    } catch {
      setMessage("환불 처리 중 네트워크 오류가 발생했습니다.");
      return false;
    } finally {
      setRefundingId(null);
    }
  }

  function openPartialRefund(tx: Transaction) {
    const refundable = getRefundableLines(tx);
    if (refundable.length === 0) {
      setMessage("부분환불 가능한 항목이 없습니다.");
      return;
    }
    setPartialTargetId(tx.id);
    setPartialBarcode(refundable[0].barcode);
    setPartialQty("1");
    setPartialReason("부분 환불");
  }

  function closePartialRefund() {
    setPartialTargetId(null);
    setPartialBarcode("");
    setPartialQty("1");
    setPartialReason("부분 환불");
  }

  async function submitPartialRefund() {
    if (!partialTarget) return;
    const line = partialRefundableLines.find((item) => item.barcode === partialBarcode);
    if (!line) {
      setMessage("부분환불 대상 품목을 선택하세요.");
      return;
    }
    const qty = Number(partialQty || 0);
    if (!Number.isInteger(qty) || qty <= 0 || qty > line.qty) {
      setMessage(`환불 수량은 1 ~ ${line.qty} 사이여야 합니다.`);
      return;
    }
    const ok = await requestRefund(partialTarget, {
      reason: partialReason.trim() || "부분 환불",
      lines: [{ barcode: line.barcode, qty }]
    });
    if (ok) closePartialRefund();
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

      if (!isTyping && !hasModifier && /^[0-9]$/.test(event.key)) {
        const now = Date.now();
        const interval = now - scannerInputAtRef.current;
        scannerInputAtRef.current = now;
        if (interval > 140) {
          scannerBufferRef.current = event.key;
        } else {
          scannerBufferRef.current = `${scannerBufferRef.current}${event.key}`.slice(0, 24);
        }
        return;
      }

      if (!isTyping && !hasModifier && event.key === "Enter" && scannerBufferRef.current.length >= 8) {
        event.preventDefault();
        addByBarcode(scannerBufferRef.current);
        scannerBufferRef.current = "";
        scannerInputAtRef.current = 0;
        return;
      }

      if (event.key === "F6") {
        event.preventDefault();
        barcodeInputRef.current?.focus();
        return;
      }
      if (event.key === "F2" && !isTyping) {
        event.preventDefault();
        setScanAutoMode((prev) => !prev);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void checkout();
        return;
      }
      if (event.key === "Escape") {
        setBarcodeInput("");
        scannerBufferRef.current = "";
        scannerInputAtRef.current = 0;
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [addByBarcode, checkout]);

  return (
    <div className="ops-game-screen ops-game-screen--pos pos-view">
      <header className="pos-header">
        <div>
          <div className="pos-eyebrow">Convus X POS Terminal</div>
          <h2>멀티 매장 POS</h2>
          <p>바코드 스캔, 간편 결제, 할인/분할결제, 부분취소/전체환불까지 한 화면에서 처리합니다.</p>
        </div>

        <div className="pos-store-select">
          <span>운영 매장</span>
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </header>

      <section className="ops-route-strip" aria-label="운영 라우팅">
        <span>NEXT OPS</span>
        <div>
          <button type="button" onClick={onOpenWorkforce}>Workforce 이동</button>
          <button type="button" onClick={onOpenStoreOps}>StoreOps 이동</button>
          <button type="button" onClick={onOpenSales}>매출 대시보드 이동</button>
        </div>
      </section>

      <div className="pos-flow-strip" aria-label="POS 진행 단계">
        {flowItems.map((item) => (
          <article
            key={item.step}
            className={[
              "pos-flow-strip__item",
              flowStage === item.step ? "is-active" : "",
              flowStage > item.step ? "is-done" : ""
            ]
              .join(" ")
              .trim()}
          >
            <span>{item.step}</span>
            <strong>{item.label}</strong>
          </article>
        ))}
      </div>

      <section className="pos-store-lanes" aria-label="점포 운영 현황">
        {stores.map((store) => {
          const summary = summaryByStore[store.id];
          const txCount = summary?.transactions ?? 0;
          const qtyCount = summary?.orders ?? 0;
          const totalAmount = summary?.total ?? 0;
          return (
            <button
              key={store.id}
              type="button"
              className={`pos-store-lane${store.id === storeId ? " is-active" : ""}`}
              onClick={() => {
                setStoreId(store.id);
                setMessage(`${store.name} POS 채널로 전환했습니다.`);
              }}
            >
              <strong>{store.name}</strong>
              <span>{store.city}</span>
              <b>{formatKRW(totalAmount)}</b>
              <em>{txCount.toLocaleString()}건 · {qtyCount.toLocaleString()}개</em>
            </button>
          );
        })}
      </section>

      <div className="pos-grid">
        <section className="pos-scan-panel">
          <h3>바코드 스캔</h3>
          <div className="pos-scan-row">
            <input
              ref={barcodeInputRef}
              value={barcodeInput}
              onChange={(event) => {
                const next = event.target.value.replace(/[^0-9]/g, "");
                setBarcodeInput(next);
                if (scanAutoMode && next.length >= 13) {
                  addByBarcode(next);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addByBarcode(barcodeInput);
                }
              }}
              placeholder="예: 8800101010011"
              disabled={loading}
            />
            <button type="button" onClick={() => addByBarcode(barcodeInput)} disabled={loading}>추가</button>
          </div>
          <label className="pos-scan-toggle">
            <input type="checkbox" checked={scanAutoMode} onChange={(event) => setScanAutoMode(event.target.checked)} />
            <span>13자리 자동스캔 모드</span>
          </label>

          <div className="pos-scan-actions">
            <button type="button" onClick={() => barcodeInputRef.current?.focus()}>포커스</button>
            <button
              type="button"
              onClick={() => {
                setCart([]);
                setMessage("장바구니를 비웠습니다.");
              }}
              disabled={cart.length === 0}
            >
              카트 비우기
            </button>
            <button
              type="button"
              onClick={() => {
                const firstPromo = promotions[0];
                if (!firstPromo) {
                  setMessage("추천 가능한 프로모션이 없습니다.");
                  return;
                }
                setPromoCodeInput(firstPromo.code);
                setAppliedPromoCode("");
                setMessage(`추천 프로모션 선택: ${firstPromo.code}`);
              }}
              disabled={promotions.length === 0}
            >
              추천 프로모션
            </button>
          </div>

          <div className="pos-quick-barcodes">
            {catalog.map((product) => (
              <button key={product.barcode} type="button" onClick={() => addByBarcode(product.barcode)} disabled={loading}>
                <strong>{product.name}</strong>
                <span>{product.barcode}</span>
              </button>
            ))}
          </div>

          {scanLog.length > 0 ? (
            <div className="pos-scan-log">
              <span>최근 스캔</span>
              <div>
                {scanLog.map((item) => (
                  <em key={item.id}>
                    {item.name} · {item.at}
                  </em>
                ))}
              </div>
            </div>
          ) : null}

          <p className="pos-message">{loading ? "POS 부트스트랩 로딩 중..." : message}</p>
          <div className="pos-shortcut-hint">단축키: `F6` 바코드 포커스 · `F2` 자동스캔 토글 · `Ctrl+Enter` 결제 · 바코드건 숫자+Enter 자동 인식</div>

          {selectedStore ? (
            <div className="pos-store-stats">
              <div><span>{selectedStore.name}</span><strong>{formatKRW(summaryByStore[selectedStore.id]?.total ?? 0)}</strong></div>
              <div><span>결제 건수</span><strong>{(summaryByStore[selectedStore.id]?.transactions ?? 0).toLocaleString()}건</strong></div>
              <div><span>판매 수량</span><strong>{(summaryByStore[selectedStore.id]?.orders ?? 0).toLocaleString()}개</strong></div>
            </div>
          ) : null}

          <div className="pos-executive-brief">
            <h4>상무 승인 과제</h4>
            {latestExecutiveReport ? (
              <>
                <strong>{latestExecutiveReport.topic}</strong>
                <p>{latestExecutiveReport.summary || latestExecutiveReport.directive}</p>
                {latestExecutiveReport.recommendations.length > 0 ? (
                  <ul>
                    {latestExecutiveReport.recommendations.slice(0, 2).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p>Workforce에서 최신 상무 보고를 생성하면 POS 실행 우선순위가 표시됩니다.</p>
            )}
          </div>

          {paymentMixTop2.length > 0 ? (
            <div className="pos-payment-insight">
              <h4>결제 트렌드</h4>
              <ul>
                {paymentMixTop2.map(([method, value]) => (
                  <li key={method}>
                    <span>{paymentLabels[method]}</span>
                    <strong>{formatKRW(value.total)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="pos-cart-panel">
          <h3>결제 바구니</h3>

          {cart.length === 0 ? (
            <p className="pos-empty">품목을 스캔하면 장바구니가 채워집니다.</p>
          ) : (
            <ul className="pos-cart-list">
              {cart.map((line) => (
                <li key={line.barcode}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>{formatKRW(line.price)} / ea</span>
                  </div>
                  <div className="pos-cart-qty">
                    <button type="button" onClick={() => updateQty(line.barcode, line.qty - 1)}>-</button>
                    <span>{line.qty}</span>
                    <button type="button" onClick={() => updateQty(line.barcode, line.qty + 1)}>+</button>
                  </div>
                  <b>{formatKRW(line.price * line.qty)}</b>
                </li>
              ))}
            </ul>
          )}

          <div className="pos-advanced-panel">
            <h4>할인/분할결제</h4>
            <div className="pos-discount-modes">
              {(["none", "rate", "amount"] as DiscountType[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={discountType === mode ? "is-active" : ""}
                  onClick={() => setDiscountType(mode)}
                >
                  {mode === "none" ? "할인 없음" : mode === "rate" ? "정률 할인" : "정액 할인"}
                </button>
              ))}
            </div>
            {discountType !== "none" ? (
              <div className="pos-advanced-input-row">
                <span>{discountType === "rate" ? "할인율(%)" : "할인액(원)"}</span>
                <input
                  value={discountValue}
                  onChange={(event) => setDiscountValue(event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder={discountType === "rate" ? "예: 10" : "예: 3000"}
                />
              </div>
            ) : null}

            <div className="pos-promo-row">
              <span>프로모션</span>
              <div className="pos-promo-row__inputs">
                <input
                  value={promoCodeInput}
                  onChange={(event) => setPromoCodeInput(normalizePromoCode(event.target.value))}
                  placeholder="예: WELCOME10"
                />
                <button type="button" onClick={applyPromoCode}>적용</button>
                {appliedPromotion ? (
                  <button
                    type="button"
                    className="is-ghost"
                    onClick={() => {
                      setAppliedPromoCode("");
                      setPromoCodeInput("");
                      setMessage("프로모션 적용을 해제했습니다.");
                    }}
                  >
                    해제
                  </button>
                ) : null}
              </div>
            </div>

            {promotions.length > 0 ? (
              <div className="pos-promo-list">
                {promotions.slice(0, 4).map((promo) => (
                  <button
                    key={promo.code}
                    type="button"
                    className={appliedPromotion?.code === promo.code ? "is-active" : ""}
                    onClick={() => {
                      setPromoCodeInput(promo.code);
                      setAppliedPromoCode("");
                      setMessage(`추천 프로모션 선택: ${promo.code}`);
                    }}
                  >
                    <strong>{promo.code}</strong>
                    <span>{promo.title}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <label className="pos-split-toggle">
              <input
                type="checkbox"
                checked={splitEnabled}
                onChange={(event) => setSplitEnabled(event.target.checked)}
              />
              <span>분할결제 사용</span>
            </label>

            {splitEnabled ? (
              <div className="pos-split-grid">
                <div className="pos-advanced-input-row">
                  <span>2차 수단</span>
                  <select value={splitMethod} onChange={(event) => setSplitMethod(event.target.value as PaymentMethod)}>
                    {(["card", "cash", "qr", "gift"] as PaymentMethod[]).map((method) => (
                      <option key={method} value={method}>{paymentLabels[method]}</option>
                    ))}
                  </select>
                </div>
                <div className="pos-advanced-input-row">
                  <span>2차 금액(원)</span>
                  <input
                    value={splitAmount}
                    onChange={(event) => setSplitAmount(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="예: 5000"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="pos-total">
            <div><span>공급가</span><strong>{formatKRW(Math.max(0, subtotal - vat))}</strong></div>
            <div><span>할인</span><strong>{formatKRW(discountAmount)}</strong></div>
            <div><span>프로모션</span><strong>{formatKRW(promoDiscountAmount)}</strong></div>
            <div><span>부가세</span><strong>{formatKRW(vat)}</strong></div>
            {splitEnabled ? (
              <>
                <div><span>1차 결제 ({paymentLabels[paymentMethod]})</span><strong>{formatKRW(splitPrimaryAmount)}</strong></div>
                <div><span>2차 결제 ({paymentLabels[splitMethod]})</span><strong>{formatKRW(splitSecondaryAmount)}</strong></div>
              </>
            ) : null}
            <div className="is-final"><span>합계</span><strong>{formatKRW(total)}</strong></div>
          </div>

          <div className="pos-payment-methods">
            {(["card", "cash", "qr", "gift"] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                className={paymentMethod === method ? "is-active" : ""}
                onClick={() => setPaymentMethod(method)}
              >
                {paymentLabels[method]}
              </button>
            ))}
          </div>

          <button type="button" className="pos-checkout" onClick={() => void checkout()} disabled={checkingOut || loading}>
            {checkingOut ? "결제 처리 중..." : "결제 완료"}
          </button>
        </section>

        <section className="pos-transactions">
          <div className="pos-transactions__head">
            <h3>최근 결제</h3>
            <span>{filteredTransactions.length}/{transactions.length}</span>
          </div>

          <div className="pos-transactions__filters">
            <button type="button" className={txFilter === "all" ? "is-active" : ""} onClick={() => setTxFilter("all")}>
              전체 {txStatusCount.all}
            </button>
            <button type="button" className={txFilter === "completed" ? "is-active" : ""} onClick={() => setTxFilter("completed")}>
              완료 {txStatusCount.completed}
            </button>
            <button type="button" className={txFilter === "partial_refunded" ? "is-active" : ""} onClick={() => setTxFilter("partial_refunded")}>
              부분환불 {txStatusCount.partial_refunded}
            </button>
            <button type="button" className={txFilter === "refunded" ? "is-active" : ""} onClick={() => setTxFilter("refunded")}>
              전체환불 {txStatusCount.refunded}
            </button>
          </div>

          {filteredTransactions.length === 0 ? (
            <p className="pos-empty">아직 결제 내역이 없습니다.</p>
          ) : (
            <ul>
              {filteredTransactions.map((tx) => {
                const status = getTxStatus(tx);
                const refundableLines = getRefundableLines(tx);
                const hasRefundable = refundableLines.length > 0;
                const selectedPartialLine = refundableLines.find((line) => line.barcode === partialBarcode) ?? refundableLines[0] ?? null;
                const isPartialOpen = partialTargetId === tx.id;

                return (
                  <li key={tx.id}>
                    <div>
                      <strong>{new Date(tx.createdAt).toLocaleTimeString()}</strong>
                      <span>{tx.storeName}</span>
                    </div>
                    <div>
                      <b>{formatKRW(tx.total)}</b>
                      <span>{paymentLabels[tx.paymentMethod]} · {tx.itemCount}개</span>
                    </div>
                    {tx.discountAmount && tx.discountAmount > 0 ? (
                      <div className="pos-tx-meta">할인 적용: {formatKRW(tx.discountAmount)}</div>
                    ) : null}
                    {tx.promoCode ? (
                      <div className="pos-tx-meta">프로모션: {tx.promoCode} {tx.promoDiscountAmount ? `(-${formatKRW(tx.promoDiscountAmount)})` : ""}</div>
                    ) : null}
                    {tx.paymentBreakdown && tx.paymentBreakdown.length > 1 ? (
                      <div className="pos-tx-meta">
                        분할결제: {tx.paymentBreakdown.map((item) => `${paymentLabels[item.method]} ${formatKRW(item.amount)}`).join(" + ")}
                      </div>
                    ) : null}
                    {(tx.refundAmount ?? 0) > 0 ? (
                      <div className="pos-tx-meta">누적 환불: {formatKRW(tx.refundAmount ?? 0)} / {tx.refundedItemCount ?? 0}개</div>
                    ) : null}
                    <div className="pos-tx-footer">
                      <span className={`pos-tx-status is-${status}`}>
                        {status === "refunded" ? "전체 환불" : status === "partial_refunded" ? "부분 환불" : "결제 완료"}
                      </span>
                      {status !== "refunded" && hasRefundable ? (
                        <div className="pos-tx-actions">
                          <button
                            type="button"
                            className="pos-tx-refund"
                            onClick={() => void requestRefund(tx, { reason: "전체 환불" })}
                            disabled={refundingId === tx.id}
                          >
                            {refundingId === tx.id ? "처리 중..." : "전체 환불"}
                          </button>
                          <button
                            type="button"
                            className="pos-tx-partial"
                            onClick={() => openPartialRefund(tx)}
                            disabled={refundingId === tx.id}
                          >
                            부분취소
                          </button>
                        </div>
                      ) : (
                        <span className="pos-tx-refunded-at">
                          {tx.refundedAt ? new Date(tx.refundedAt).toLocaleTimeString() : ""}
                        </span>
                      )}
                    </div>

                    {isPartialOpen && status !== "refunded" ? (
                      <div className="pos-partial-refund">
                        <div className="pos-partial-refund__row">
                          <span>품목</span>
                          <select value={partialBarcode} onChange={(event) => setPartialBarcode(event.target.value)}>
                            {refundableLines.map((line) => (
                              <option key={line.barcode} value={line.barcode}>
                                {line.name} (잔여 {line.qty}개)
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="pos-partial-refund__row">
                          <span>수량</span>
                          <input
                            value={partialQty}
                            onChange={(event) => setPartialQty(event.target.value.replace(/[^0-9]/g, ""))}
                            placeholder={selectedPartialLine ? `1~${selectedPartialLine.qty}` : "1"}
                          />
                        </div>
                        <div className="pos-partial-refund__row">
                          <span>사유</span>
                          <input
                            value={partialReason}
                            onChange={(event) => setPartialReason(event.target.value)}
                            placeholder="부분 환불 사유"
                          />
                        </div>
                        <div className="pos-partial-refund__actions">
                          <button type="button" onClick={() => void submitPartialRefund()} disabled={refundingId === tx.id}>부분 환불 실행</button>
                          <button type="button" className="is-ghost" onClick={closePartialRefund}>닫기</button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
