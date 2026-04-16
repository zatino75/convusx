import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../api/url";
import {
  getLatestExecutiveReport,
  listExecutiveReports,
  syncExecutiveReports,
  type ExecutiveReport
} from "../../store/executiveStore";

type StoreHealth = "stable" | "attention" | "critical";

type Store = {
  id: string;
  name: string;
  city: string;
  health: StoreHealth;
  revenueToday: number;
  ordersToday: number;
  aiTasks: number;
  inventoryRisk: number;
  linkedProjects: string[];
};

type PosSummaryByStore = Record<string, { total: number; orders: number; transactions: number }>;

type PosBootstrap = {
  ok: boolean;
  summaryByStore?: PosSummaryByStore;
};

type StoreAlert = {
  id: string;
  storeId: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  action: string;
  department: string;
};

export type StoreOpsAlertPayload = {
  id: string;
  createdAt: string;
  storeId: string;
  storeName: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  action: string;
  department: string;
};

type Props = {
  onCreateProjectAlert?: (payload: StoreOpsAlertPayload) => void;
  onOpenWorkforce?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
};

type StoreOpsUiSnapshot = {
  selectedStoreId?: string;
  resolvedAlertIds?: string[];
  alertFilter?: "all" | "high" | "medium" | "low";
};

const STOREOPS_UI_SNAPSHOT_KEY = "convusx.storeops.ui.v1";

function readStoreOpsUiSnapshot(): StoreOpsUiSnapshot {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STOREOPS_UI_SNAPSHOT_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoreOpsUiSnapshot;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoreOpsUiSnapshot(snapshot: StoreOpsUiSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STOREOPS_UI_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function pickPriorityStoreId(stores: Store[], report: ExecutiveReport | null): string | null {
  if (stores.length === 0) return null;
  const text = `${report?.topic ?? ""} ${report?.directive ?? ""} ${report?.summary ?? ""}`;

  if (text.includes("강남") || text.includes("서울")) return "store-seoul-gangnam";
  if (text.includes("부산") || text.includes("센텀")) return "store-busan-centum";
  if (text.includes("대구") || text.includes("동성로")) return "store-daegu-dongseong";
  if (text.includes("제주") || text.includes("애월")) return "store-jeju-aewol";

  return [...stores].sort((a, b) => b.inventoryRisk - a.inventoryRisk)[0]?.id ?? stores[0]?.id ?? null;
}

const STORE_BLUEPRINTS: Store[] = [
  {
    id: "store-seoul-gangnam",
    name: "강남 플래그십",
    city: "서울",
    health: "stable",
    revenueToday: 0,
    ordersToday: 0,
    aiTasks: 5,
    inventoryRisk: 18,
    linkedProjects: ["봄 프로모션 2026", "매장 운영 자동화"]
  },
  {
    id: "store-busan-centum",
    name: "센텀 시티점",
    city: "부산",
    health: "attention",
    revenueToday: 0,
    ordersToday: 0,
    aiTasks: 8,
    inventoryRisk: 42,
    linkedProjects: ["오프라인 전환율 개선", "POS 고도화"]
  },
  {
    id: "store-daegu-dongseong",
    name: "동성로점",
    city: "대구",
    health: "stable",
    revenueToday: 0,
    ordersToday: 0,
    aiTasks: 3,
    inventoryRisk: 25,
    linkedProjects: ["멤버십 리텐션", "재고 리밸런싱"]
  },
  {
    id: "store-jeju-aewol",
    name: "애월 컨셉스토어",
    city: "제주",
    health: "critical",
    revenueToday: 0,
    ordersToday: 0,
    aiTasks: 11,
    inventoryRisk: 71,
    linkedProjects: ["관광객 번들 상품", "점포 운영 안정화"]
  }
];

const healthLabel: Record<StoreHealth, string> = {
  stable: "안정",
  attention: "주의",
  critical: "긴급"
};

function formatKRW(value: number): string {
  return `${value.toLocaleString()}원`;
}

function detectHealthByRisk(risk: number): StoreHealth {
  if (risk > 65) return "critical";
  if (risk > 35) return "attention";
  return "stable";
}

function buildStoreAlerts(stores: Store[], report: ExecutiveReport | null): StoreAlert[] {
  const alerts: StoreAlert[] = [];
  const reportText = `${report?.topic ?? ""} ${report?.summary ?? ""} ${report?.directive ?? ""}`;

  for (const store of stores) {
    if (store.inventoryRisk >= 70) {
      alerts.push({
        id: `${store.id}-inventory`,
        storeId: store.id,
        severity: "high",
        title: `${store.name} 재고 위험`,
        detail: `재고 리스크 ${store.inventoryRisk}%로 긴급 조치가 필요합니다.`,
        action: "재고 리밸런싱 프로젝트 생성",
        department: "물류/재고"
      });
    }
    if (store.revenueToday < 100000 && store.ordersToday < 12) {
      alerts.push({
        id: `${store.id}-revenue`,
        storeId: store.id,
        severity: "medium",
        title: `${store.name} 매출 저하`,
        detail: `오늘 매출 ${store.revenueToday.toLocaleString()}원 / 주문 ${store.ordersToday}건`,
        action: "점포 전환율 개선 캠페인 실행",
        department: "마케팅"
      });
    }
    if (store.aiTasks >= 10) {
      alerts.push({
        id: `${store.id}-queue`,
        storeId: store.id,
        severity: "low",
        title: `${store.name} 운영 큐 과부하`,
        detail: `AI 작업 큐 ${store.aiTasks}건 적체 상태입니다.`,
        action: "운영 태스크 슬라이싱",
        department: "운영 PMO"
      });
    }
  }

  if (reportText.includes("긴급") || reportText.includes("리스크")) {
    alerts.unshift({
      id: "hq-exec-priority",
      storeId: stores[0]?.id ?? "hq",
      severity: "high",
      title: "본사 상무 우선 지시",
      detail: "최신 상무 보고에 리스크 대응 우선 지시가 포함되었습니다.",
      action: "전사 실행 프로젝트로 즉시 승격",
      department: "전략실"
    });
  }

  return alerts
    .sort((a, b) => {
      const weight = { high: 3, medium: 2, low: 1 };
      return weight[b.severity] - weight[a.severity];
    })
    .slice(0, 6);
}

export function StoreOpsView({ onCreateProjectAlert, onOpenWorkforce, onOpenPos, onOpenSales }: Props) {
  const initialUiSnapshotRef = useRef<StoreOpsUiSnapshot>(readStoreOpsUiSnapshot());
  const [stores, setStores] = useState<Store[]>(STORE_BLUEPRINTS);
  const [selectedStoreId, setSelectedStoreId] = useState(initialUiSnapshotRef.current.selectedStoreId ?? STORE_BLUEPRINTS[0].id);
  const [logs, setLogs] = useState<string[]>([
    "본사 운영실 · 매장 데이터 링크 준비 중",
    "자율형 AI가 점포 우선순위를 계산합니다"
  ]);
  const [latestExecutiveReport, setLatestExecutiveReport] = useState<ExecutiveReport | null>(() => getLatestExecutiveReport());
  const [executiveReports, setExecutiveReports] = useState<ExecutiveReport[]>(() => listExecutiveReports(12));
  const [resolvedAlertIds, setResolvedAlertIds] = useState<string[]>(
    Array.isArray(initialUiSnapshotRef.current.resolvedAlertIds) ? initialUiSnapshotRef.current.resolvedAlertIds : []
  );
  const [alertFilter, setAlertFilter] = useState<"all" | "high" | "medium" | "low">(
    initialUiSnapshotRef.current.alertFilter ?? "all"
  );
  const [loading, setLoading] = useState(true);

  async function refreshStoreData(showLoading = false) {
    if (showLoading) setLoading(true);

    try {
      const response = await apiFetch("/api/pos");
      const data = await response.json() as PosBootstrap;
      if (!data.ok) throw new Error("pos_fetch_failed");

      const summary = data.summaryByStore ?? {};
      setStores((prev) => prev.map((store) => {
        const base = summary[store.id] ?? { total: 0, orders: 0, transactions: 0 };
        const aiTasks = Math.max(2, Math.round(store.aiTasks * 0.5) + Math.min(12, base.transactions));
        const riskAdjust = base.transactions > 0 ? -6 : 4;
        const nextRisk = Math.max(8, Math.min(95, store.inventoryRisk + riskAdjust));
        return {
          ...store,
          revenueToday: base.total,
          ordersToday: base.orders,
          aiTasks,
          inventoryRisk: nextRisk,
          health: detectHealthByRisk(nextRisk)
        };
      }));

      setLogs((prev) => [
        `POS 동기화 완료 · ${new Date().toLocaleTimeString()}`,
        ...prev
      ].slice(0, 8));
      const syncedReports = await syncExecutiveReports(12);
      setExecutiveReports(syncedReports);
      setLatestExecutiveReport(syncedReports[0] ?? null);
    } catch {
      setLogs((prev) => ["POS 동기화 실패 · 네트워크 확인 필요", ...prev].slice(0, 8));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStoreData(true);

    const timer = window.setInterval(() => {
      void refreshStoreData(false);
    }, 12000);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "convusx.executive-reports.v1") {
        const next = listExecutiveReports(12);
        setExecutiveReports(next);
        setLatestExecutiveReport(next[0] ?? null);
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? stores[0];

  const summary = useMemo(() => {
    const revenue = stores.reduce((sum, store) => sum + store.revenueToday, 0);
    const orders = stores.reduce((sum, store) => sum + store.ordersToday, 0);
    const tasks = stores.reduce((sum, store) => sum + store.aiTasks, 0);
    const dangerStores = stores.filter((store) => store.health === "critical").length;
    return { revenue, orders, tasks, dangerStores };
  }, [stores]);

  const executiveKpis = useMemo(() => {
    const reports = executiveReports.slice(0, 8);
    const reportCount = reports.length;
    const avgRisks = reportCount > 0
      ? Math.round(reports.reduce((sum, item) => sum + item.risks.length, 0) / reportCount)
      : 0;
    const avgRecommendations = reportCount > 0
      ? Math.round(reports.reduce((sum, item) => sum + item.recommendations.length, 0) / reportCount)
      : 0;
    const latestAt = reports[0]?.createdAt ?? null;

    return { reportCount, avgRisks, avgRecommendations, latestAt };
  }, [executiveReports]);
  const alerts = useMemo(
    () => buildStoreAlerts(stores, latestExecutiveReport).filter((alert) => !resolvedAlertIds.includes(alert.id)),
    [stores, latestExecutiveReport, resolvedAlertIds]
  );

  const filteredAlerts = useMemo(
    () => (alertFilter === "all" ? alerts : alerts.filter((item) => item.severity === alertFilter)),
    [alerts, alertFilter]
  );

  useEffect(() => {
    writeStoreOpsUiSnapshot({
      selectedStoreId,
      resolvedAlertIds,
      alertFilter
    });
  }, [selectedStoreId, resolvedAlertIds, alertFilter]);

  const healthSummary = useMemo(() => ({
    stable: stores.filter((item) => item.health === "stable").length,
    attention: stores.filter((item) => item.health === "attention").length,
    critical: stores.filter((item) => item.health === "critical").length
  }), [stores]);

  const storeOpsStage = loading
    ? 1
    : alerts.length > 0
      ? 2
      : resolvedAlertIds.length > 0
        ? 3
        : latestExecutiveReport
          ? 4
          : 1;

  const storeOpsFlow = [
    { step: 1, label: "동기화" },
    { step: 2, label: "이슈 분류" },
    { step: 3, label: "프로젝트화" },
    { step: 4, label: "상무 보고" }
  ];

  const priorityStoreId = useMemo(
    () => pickPriorityStoreId(stores, latestExecutiveReport),
    [stores, latestExecutiveReport]
  );

  useEffect(() => {
    if (!priorityStoreId) return;
    if (selectedStoreId === priorityStoreId) return;
    setSelectedStoreId(priorityStoreId);
    setLogs((prev) => [`AI 프리셋: ${stores.find((item) => item.id === priorityStoreId)?.name ?? priorityStoreId} 우선 모니터링`, ...prev].slice(0, 8));
  }, [priorityStoreId]);

  function resolveAlert(alertId: string) {
    setResolvedAlertIds((prev) => [...prev, alertId]);
    setLogs((prev) => [`AI 자동조치 처리 완료 · ${alertId}`, ...prev].slice(0, 8));
  }

  function createAlertProject(alert: StoreAlert) {
    const store = stores.find((item) => item.id === alert.storeId);
    onCreateProjectAlert?.({
      id: alert.id,
      createdAt: new Date().toISOString(),
      storeId: alert.storeId,
      storeName: store?.name ?? alert.storeId,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      action: alert.action,
      department: alert.department
    });
    resolveAlert(alert.id);
  }

  return (
    <div className="ops-game-screen ops-game-screen--storeops storeops-view">
      <header className="storeops-header">
        <div>
          <div className="storeops-eyebrow">Store Operations Command</div>
          <h2>멀티 매장 운영 관제</h2>
          <p>오프라인 매장들이 프로젝트 단위로 움직이며, POS 실데이터와 자율형 AI가 함께 운영됩니다.</p>
        </div>

        <div className="storeops-summary-grid">
          <article>
            <span>통합 매출</span>
            <strong>{formatKRW(summary.revenue)}</strong>
          </article>
          <article>
            <span>통합 주문</span>
            <strong>{summary.orders.toLocaleString()}건</strong>
          </article>
          <article>
            <span>AI 태스크</span>
            <strong>{summary.tasks}건</strong>
          </article>
          <article>
            <span>긴급 점포</span>
            <strong>{summary.dangerStores}개</strong>
          </article>
        </div>
      </header>

      <section className="ops-route-strip" aria-label="운영 라우팅">
        <span>NEXT OPS</span>
        <div>
          <button type="button" onClick={onOpenWorkforce}>Workforce 이동</button>
          <button type="button" onClick={onOpenPos}>POS 이동</button>
          <button type="button" onClick={onOpenSales}>매출 대시보드 이동</button>
        </div>
      </section>

      <div className="storeops-health-strip" aria-label="매장 상태 요약">
        <article className="is-stable"><span>안정</span><strong>{healthSummary.stable}</strong></article>
        <article className="is-attention"><span>주의</span><strong>{healthSummary.attention}</strong></article>
        <article className="is-critical"><span>긴급</span><strong>{healthSummary.critical}</strong></article>
      </div>

      <div className="storeops-phase-strip" aria-label="StoreOps 진행 단계">
        {storeOpsFlow.map((item) => (
          <article
            key={item.step}
            className={[
              "storeops-phase-strip__item",
              storeOpsStage === item.step ? "is-active" : "",
              storeOpsStage > item.step ? "is-done" : ""
            ]
              .join(" ")
              .trim()}
          >
            <span>{item.step}</span>
            <strong>{item.label}</strong>
          </article>
        ))}
      </div>

      <div className="storeops-grid">
        <section className="storeops-store-list">
          <h3>매장 현황</h3>
          {stores.map((store) => (
            <button
              key={store.id}
              type="button"
              onClick={() => setSelectedStoreId(store.id)}
              className={`storeops-store-card ${store.id === selectedStoreId ? "is-active" : ""} ${store.id === priorityStoreId ? "is-priority" : ""}`}
            >
              <div>
                <strong>{store.name}</strong>
                <p>{store.city}</p>
              </div>
              <div className="storeops-store-meta">
                {store.id === priorityStoreId ? <span className="storeops-priority">AI 우선</span> : null}
                <div className={`storeops-pill is-${store.health}`}>{healthLabel[store.health]}</div>
              </div>
            </button>
          ))}

          {loading ? <p className="pos-empty">POS 데이터 로딩 중...</p> : null}
        </section>

        <section className="storeops-main-panel">
          <div className="storeops-main-panel__head">
            <div>
              <h3>{selectedStore.name}</h3>
              <p>{selectedStore.city} · 프로젝트 연동 {selectedStore.linkedProjects.length}개</p>
            </div>
            <div className={`storeops-pill is-${selectedStore.health}`}>{healthLabel[selectedStore.health]}</div>
          </div>

          <div className="storeops-kpis">
            <article>
              <span>오늘 매출</span>
              <strong>{formatKRW(selectedStore.revenueToday)}</strong>
            </article>
            <article>
              <span>오늘 주문</span>
              <strong>{selectedStore.ordersToday.toLocaleString()}건</strong>
            </article>
            <article>
              <span>재고 리스크</span>
              <strong>{selectedStore.inventoryRisk}%</strong>
            </article>
            <article>
              <span>AI 작업 큐</span>
              <strong>{selectedStore.aiTasks}건</strong>
            </article>
          </div>

          <div className="storeops-projects">
            <h4>프로젝트 메뉴 활용 예시</h4>
            <ul>
              {selectedStore.linkedProjects.map((project) => <li key={project}>{project}</li>)}
              <li>점포 단위 프로젝트를 사이드바에서 묶어 KPI·지시·결과를 스레드로 관리</li>
              <li>상무 보고용 프로젝트는 완료 시 자동 요약 리포트를 생성</li>
            </ul>
          </div>

          <div className="storeops-directive">
            <h4>본사 최신 상무 지시</h4>
            {latestExecutiveReport ? (
              <>
                <strong>{latestExecutiveReport.topic}</strong>
                <p>{latestExecutiveReport.summary || latestExecutiveReport.directive}</p>
                <span>{new Date(latestExecutiveReport.createdAt).toLocaleString()}</span>
              </>
            ) : (
              <p>아직 상무 보고가 없습니다. Workforce에서 미션을 실행해 주세요.</p>
            )}
          </div>

          <div className="storeops-exec-kpis">
            <h4>Executive KPI</h4>
            <div>
              <span>보고 누적</span>
              <strong>{executiveKpis.reportCount}건</strong>
            </div>
            <div>
              <span>평균 리스크 항목</span>
              <strong>{executiveKpis.avgRisks}개</strong>
            </div>
            <div>
              <span>평균 실행 권고</span>
              <strong>{executiveKpis.avgRecommendations}개</strong>
            </div>
            <div>
              <span>최근 업데이트</span>
              <strong>{executiveKpis.latestAt ? new Date(executiveKpis.latestAt).toLocaleTimeString() : "-"}</strong>
            </div>
          </div>

          <div className="storeops-alerts">
            <h4>AI 자동 조치 큐</h4>
            <div className="storeops-alert-filter">
              {(["all", "high", "medium", "low"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={alertFilter === item ? "is-active" : ""}
                  onClick={() => setAlertFilter(item)}
                >
                  {item === "all" ? `전체 ${alerts.length}` : `${item.toUpperCase()} ${alerts.filter((alert) => alert.severity === item).length}`}
                </button>
              ))}
              <button
                type="button"
                className="is-ghost"
                onClick={() => {
                  setResolvedAlertIds([]);
                  setAlertFilter("all");
                  setLogs((prev) => ["조치 큐 필터/완료 이력을 초기화했습니다.", ...prev].slice(0, 8));
                }}
              >
                필터 초기화
              </button>
            </div>
            {filteredAlerts.length > 0 ? (
              <div className="storeops-alert-list">
                {filteredAlerts.map((alert) => (
                  <article key={alert.id} className={`storeops-alert-item is-${alert.severity}`}>
                    <div className="storeops-alert-item__head">
                      <strong>{alert.title}</strong>
                      <span>{alert.severity.toUpperCase()}</span>
                    </div>
                    <p>{alert.detail}</p>
                    <div className="storeops-alert-item__foot">
                      <b>{alert.action}</b>
                      <span>{alert.department}</span>
                      <div className="storeops-alert-item__actions">
                        <button type="button" onClick={() => createAlertProject(alert)}>프로젝트 생성</button>
                        <button type="button" className="is-ghost" onClick={() => resolveAlert(alert.id)}>완료 처리</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>선택한 필터에 해당하는 자동 조치 항목이 없습니다.</p>
            )}
          </div>
        </section>

        <section className="storeops-log-panel">
          <h3>운영 이벤트</h3>
          <ul>
            {logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
