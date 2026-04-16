import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../../api/url";
import {
  deleteExecutiveReport,
  persistExecutiveReport,
  listExecutiveReports,
  syncExecutiveReports,
  type ExecutiveReport,
} from "../../store/executiveStore";
import {
  finishMissionRuntime,
  patchMissionRuntimeState,
  setMissionRuntimePhase,
  startMissionRuntime,
  syncMissionRuntimeDepartments
} from "../../store/missionRuntimeStore";
import { consumePendingWorkforceMission } from "../../store/workforceMissionBridge";

type DeptId =
  | "market"
  | "compete"
  | "legal"
  | "finance"
  | "marketing"
  | "rnd"
  | "data"
  | "content"
  | "sns";

type ActorStatus = "idle" | "queued" | "working" | "meeting" | "done" | "error";
type ActorLocation = "desk" | "hallway" | "meeting";
type MissionState = "idle" | "running" | "briefing" | "review" | "done" | "error";
type DirectorPhase = "idle" | "dispatching" | "collecting" | "reporting" | "approved" | "error";
type CeoPhase = "idle" | "waiting" | "reviewing" | "approved" | "rejected" | "error";
type ExecutiveDecision = "pending" | "approved" | "rejected" | "redispatched";

export type WorkforceArchivePayload = {
  id: string;
  createdAt: string;
  sessionId: string | null;
  roundNumber: number;
  topic: string;
  directive: string;
  summary: string;
  opportunities: string[];
  risks: string[];
  recommendations: string[];
  meetingMinutes: string[];
};

type Props = {
  onArchiveReport?: (payload: WorkforceArchivePayload) => void;
  onOpenStoreOps?: () => void;
  onOpenPos?: () => void;
  onOpenSales?: () => void;
};

type Actor = {
  id: DeptId;
  team: string;
  lead: string;
  status: ActorStatus;
  location: ActorLocation;
  progress: number;
  objective: string;
  output: string;
};

type Position = {
  desk: { x: number; y: number };
  hallway: { x: number; y: number };
  meeting: { x: number; y: number };
};

type BriefingPayload = {
  opportunities?: string[];
  risks?: string[];
  recommendations?: string[];
  summary?: string;
};

type DirectorStreamEvent = {
  type: string;
  sessionId?: string;
  roundNumber?: number;
  missionId?: string;
  deptCount?: number;
  topic?: string;
  domain?: string;
  deptId?: DeptId;
  objective?: string;
  message?: string;
  percent?: number;
  error?: string;
  summary?: unknown;
  report?: unknown;
  briefing?: BriefingPayload;
  plan?: {
    successCriteria?: string[];
    selectedDepartments?: string[];
  };
  review?: {
    verdict?: "pass" | "needs_followup";
    summary?: string;
    keyIssues?: string[];
  };
};

const BASE_ACTORS: Actor[] = [
  { id: "market", team: "시장분석", lead: "김지훈", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "compete", team: "경쟁정보", lead: "박소연", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "legal", team: "법무컴플", lead: "이도윤", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "finance", team: "재무전략", lead: "정하늘", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "marketing", team: "마케팅", lead: "최민서", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "rnd", team: "R&D", lead: "오지수", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "data", team: "데이터", lead: "윤태훈", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "content", team: "콘텐츠", lead: "한지아", status: "idle", location: "desk", progress: 0, objective: "", output: "" },
  { id: "sns", team: "SNS", lead: "문서진", status: "idle", location: "desk", progress: 0, objective: "", output: "" }
];

const POSITIONS: Record<DeptId, Position> = {
  market: { desk: { x: 11, y: 18 }, hallway: { x: 32, y: 39 }, meeting: { x: 42, y: 56 } },
  compete: { desk: { x: 30, y: 14 }, hallway: { x: 38, y: 37 }, meeting: { x: 47, y: 60 } },
  legal: { desk: { x: 50, y: 12 }, hallway: { x: 45, y: 36 }, meeting: { x: 52, y: 56 } },
  finance: { desk: { x: 70, y: 14 }, hallway: { x: 55, y: 37 }, meeting: { x: 57, y: 60 } },
  marketing: { desk: { x: 88, y: 18 }, hallway: { x: 62, y: 39 }, meeting: { x: 62, y: 56 } },
  rnd: { desk: { x: 88, y: 74 }, hallway: { x: 62, y: 68 }, meeting: { x: 58, y: 66 } },
  data: { desk: { x: 70, y: 79 }, hallway: { x: 55, y: 70 }, meeting: { x: 53, y: 70 } },
  content: { desk: { x: 30, y: 79 }, hallway: { x: 38, y: 70 }, meeting: { x: 47, y: 70 } },
  sns: { desk: { x: 11, y: 74 }, hallway: { x: 32, y: 68 }, meeting: { x: 42, y: 66 } }
};

const DIRECTOR_POSITION: Record<DirectorPhase, { x: number; y: number }> = {
  idle: { x: 50, y: 8 },
  dispatching: { x: 50, y: 18 },
  collecting: { x: 33, y: 49 },
  reporting: { x: 50, y: 56 },
  approved: { x: 55, y: 58 },
  error: { x: 18, y: 26 }
};

const CEO_POSITION: Record<CeoPhase, { x: number; y: number }> = {
  idle: { x: 88, y: 8 },
  waiting: { x: 88, y: 8 },
  reviewing: { x: 63, y: 56 },
  approved: { x: 67, y: 58 },
  rejected: { x: 72, y: 62 },
  error: { x: 76, y: 24 }
};

const MISSION_TEMPLATES: Array<{ label: string; directive: string }> = [
  {
    label: "매출 확대",
    directive: "신규 시즌 매출 확대안, 채널별 전환 병목 개선, 주간 KPI 재정렬안을 오늘 18시까지 보고"
  },
  {
    label: "매장 운영",
    directive: "오프라인 매장 운영 리스크 완화, 재고 회전 최적화, POS 결제 병목 해소안을 오늘 18시까지 보고"
  },
  {
    label: "리스크 대응",
    directive: "법무·재무·운영 리스크를 우선순위화하고 즉시 실행안과 보완안을 오늘 18시까지 보고"
  }
];

function parseTasks(input: string): string[] {
  const tasks = input
    .split(/[,\n]|\s+·\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return tasks.length > 0
    ? tasks.slice(0, 9)
    : ["매출 성장 전략 수립", "매장 운영 안정화", "프로젝트 KPI 재정렬"];
}

function readReportTitle(report: unknown): string {
  if (typeof report !== "object" || report === null) return "부서 결과 제출";
  const title = (report as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : "부서 결과 제출";
}

function parseBriefingFromPayload(briefing: BriefingPayload | undefined, fallbackSummary = "") {
  return {
    opportunities: Array.isArray(briefing?.opportunities) ? briefing.opportunities.slice(0, 4) : [],
    risks: Array.isArray(briefing?.risks) ? briefing.risks.slice(0, 4) : [],
    recommendations: Array.isArray(briefing?.recommendations) ? briefing.recommendations.slice(0, 4) : [],
    summary: typeof briefing?.summary === "string" && briefing.summary.trim()
      ? briefing.summary.trim()
      : fallbackSummary
  };
}

function buildMeetingMinutesPayload(params: {
  topic: string;
  directive: string;
  actors: Actor[];
  logs: string[];
  report: {
    summary: string;
    opportunities: string[];
    risks: string[];
    recommendations: string[];
  };
  decisionMemo: string;
}): string[] {
  const topic = params.topic && params.topic !== "-" ? params.topic : "Executive Mission";
  const attendees = params.actors
    .filter((actor) => actor.location === "meeting" || actor.status === "done")
    .map((actor) => actor.team)
    .slice(0, 9);
  const highlights = params.report.recommendations.slice(0, 3);
  const riskFocus = params.report.risks.slice(0, 2);
  const memo = params.decisionMemo.trim();
  const recentLogs = params.logs.slice(0, 3).reverse();

  return [
    `주제: ${topic}`,
    `지시: ${params.directive.trim() || "지시사항 없음"}`,
    `참석: ${attendees.length > 0 ? attendees.join(", ") : "집결 전"}`,
    `요약: ${params.report.summary || "요약 생성 전"}`,
    `핵심 실행: ${highlights.length > 0 ? highlights.join(" / ") : "권고안 생성 중"}`,
    `리스크 포커스: ${riskFocus.length > 0 ? riskFocus.join(" / ") : "리스크 생성 중"}`,
    `대표 메모: ${memo || "추가 메모 없음"}`,
    `최근 로그: ${recentLogs.length > 0 ? recentLogs.join(" | ") : "로그 없음"}`
  ].slice(0, 8);
}

async function consumeDirectorSse(
  directive: string,
  sessionId: string | null,
  signal: AbortSignal,
  onEvent: (event: DirectorStreamEvent) => void
): Promise<void> {
  const token = String(import.meta.env.VITE_API_TOKEN ?? "").trim();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(apiUrl("/api/director/stream"), {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      directive,
      sessionId: sessionId ?? undefined,
      projectName: "CONVUS X Workforce",
      connectors: []
    }),
    signal
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => "");
    throw new Error(msg || `director_stream_${response.status}`);
  }

  if (!response.body) {
    throw new Error("director_stream_empty_body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let pendingEventName = "message";
  let pendingDataLines: string[] = [];

  function emitPendingEvent() {
    if (pendingDataLines.length === 0) {
      pendingEventName = "message";
      return;
    }

    const raw = pendingDataLines.join("\n");
    pendingDataLines = [];

    try {
      const parsed = JSON.parse(raw) as DirectorStreamEvent;
      onEvent({ ...parsed, type: parsed.type || pendingEventName });
    } catch {
      onEvent({ type: pendingEventName, message: raw });
    }

    pendingEventName = "message";
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() === "") {
        emitPendingEvent();
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        pendingEventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        pendingDataLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (buffer.trim()) {
    pendingDataLines.push(buffer.trim());
  }
  emitPendingEvent();
}

function asArchiveReport(payload: WorkforceArchivePayload): ExecutiveReport {
  return {
    id: payload.id,
    createdAt: payload.createdAt,
    sessionId: payload.sessionId,
    roundNumber: payload.roundNumber,
    topic: payload.topic,
    directive: payload.directive,
    summary: payload.summary,
    opportunities: payload.opportunities,
    risks: payload.risks,
    recommendations: payload.recommendations,
    meetingMinutes: payload.meetingMinutes
  };
}

export function WorkforceView({ onArchiveReport, onOpenStoreOps, onOpenPos, onOpenSales }: Props) {
  const [directive, setDirective] = useState(
    "신규 시즌 매출 확대안, 오프라인 매장 운영 리스크 대응, 프로젝트 KPI 재설계를 오늘 18시까지 보고"
  );
  const [actors, setActors] = useState<Actor[]>(BASE_ACTORS);
  const [logs, setLogs] = useState<string[]>([
    "대표이사 지시 대기 중",
    "상무가 부서별 브리핑 시퀀스를 준비 중"
  ]);
  const [missionState, setMissionState] = useState<MissionState>("idle");
  const [directorPhase, setDirectorPhase] = useState<DirectorPhase>("idle");
  const [ceoPhase, setCeoPhase] = useState<CeoPhase>("waiting");
  const [report, setReport] = useState(() => ({
    opportunities: [] as string[],
    risks: [] as string[],
    recommendations: [] as string[],
    summary: ""
  }));
  const [archiveReports, setArchiveReports] = useState<ExecutiveReport[]>(() => listExecutiveReports(8));
  const [lastKickoffAt, setLastKickoffAt] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roundNumber, setRoundNumber] = useState<number>(0);
  const [activeTopic, setActiveTopic] = useState<string>("-");
  const [decisionMemo, setDecisionMemo] = useState("리스크 우선순위와 매장별 실행 순서를 반영해 재배포");
  const [decisionState, setDecisionState] = useState<ExecutiveDecision>("pending");
  const [workflowNotes, setWorkflowNotes] = useState({ pmo: "", critic: "", ceo: "" });
  const [pendingArchivePayload, setPendingArchivePayload] = useState<WorkforceArchivePayload | null>(null);
  const [panelMode, setPanelMode] = useState<"overview" | "teams" | "reports">("overview");
  const [cameraMode, setCameraMode] = useState<"auto" | "desks" | "meeting">("auto");

  const streamControllerRef = useRef<AbortController | null>(null);
  const missionStateRef = useRef<MissionState>("idle");
  const reportRef = useRef(report);
  const activeTopicRef = useRef(activeTopic);
  const logsRef = useRef(logs);
  const actorsRef = useRef(actors);
  const decisionMemoRef = useRef(decisionMemo);
  const allDoneReceivedRef = useRef(false);
  const scheduledTimersRef = useRef<number[]>([]);
  const archivedKeysRef = useRef<Set<string>>(new Set());

  const finishedCount = actors.filter((actor) => actor.location === "meeting").length;
  const workingCount = actors.filter((actor) => actor.status === "working").length;
  const movingCount = actors.filter((actor) => actor.location === "hallway").length;
  const errorCount = actors.filter((actor) => actor.status === "error").length;
  const doneCount = actors.filter((actor) => actor.status === "done").length;

  const workloadScore = useMemo(() => {
    if (actors.length === 0) return 0;
    return Math.round(actors.reduce((sum, actor) => sum + actor.progress, 0) / actors.length);
  }, [actors]);
  const phaseTrack = useMemo(() => {
    const dispatched = ["collecting", "reporting", "approved"].includes(directorPhase);
    const analyzingDone = finishedCount >= actors.length && actors.length > 0;
    const meetingDone = missionState === "briefing" || missionState === "review" || missionState === "done";
    const briefingDone = missionState === "review" || missionState === "done";
    const approvedDone = missionState === "done" && ceoPhase === "approved";

    return [
      {
        key: "dispatch",
        label: "지시 하달",
        state: dispatched ? "done" : missionState === "running" ? "active" : missionState === "error" ? "error" : "idle"
      },
      {
        key: "analysis",
        label: "부서 분석",
        state: analyzingDone ? "done" : missionState === "running" ? "active" : missionState === "error" ? "error" : "idle"
      },
      {
        key: "meeting",
        label: "미팅룸 집결",
        state: meetingDone ? "done" : missionState === "running" ? "active" : missionState === "error" ? "error" : "idle"
      },
      {
        key: "briefing",
        label: "상무 보고",
        state: briefingDone ? "done" : missionState === "briefing" ? "active" : missionState === "error" ? "error" : "idle"
      },
      {
        key: "approve",
        label: "대표 승인",
        state: approvedDone
          ? "done"
          : missionState === "review" || ceoPhase === "reviewing" || ceoPhase === "rejected"
            ? "active"
            : missionState === "error"
              ? "error"
              : "idle"
      }
    ];
  }, [actors.length, ceoPhase, directorPhase, finishedCount, missionState]);
  const meetingRoster = useMemo(() => (
    actors.map((actor) => ({
      id: actor.id,
      label: actor.team,
      state: actor.location === "meeting"
        ? "arrived"
        : actor.status === "error"
          ? "error"
          : actor.location === "hallway" || actor.status === "working"
            ? "moving"
            : actor.status === "queued"
              ? "queued"
              : "idle"
    }))
  ), [actors]);
  const recommendedActions = report.recommendations.slice(0, 3);
  const resolvedCameraMode = useMemo<"desks" | "meeting">(() => {
    if (cameraMode === "desks" || cameraMode === "meeting") return cameraMode;
    return missionState === "briefing" || missionState === "review" || missionState === "done" ? "meeting" : "desks";
  }, [cameraMode, missionState]);

  const missionLabel = missionState === "running"
    ? "업무 수행 중"
    : missionState === "briefing"
      ? "상무 보고 정리 중"
      : missionState === "review"
        ? "대표 승인 대기"
      : missionState === "done"
        ? "대표 보고 완료"
        : missionState === "error"
          ? "오류 발생"
          : "지시 대기";

  function toRuntimePhase(state: MissionState, director: DirectorPhase): "idle" | "dispatch" | "working" | "meeting" | "review" | "done" | "error" {
    if (state === "idle") return "idle";
    if (state === "running") {
      return director === "dispatching" ? "dispatch" : "working";
    }
    if (state === "briefing") return "meeting";
    if (state === "review") return "review";
    if (state === "done") return "done";
    return "error";
  }

  useEffect(() => {
    missionStateRef.current = missionState;
  }, [missionState]);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    activeTopicRef.current = activeTopic;
  }, [activeTopic]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    actorsRef.current = actors;
  }, [actors]);

  useEffect(() => {
    decisionMemoRef.current = decisionMemo;
  }, [decisionMemo]);

  useEffect(() => {
    const runtimePhase = toRuntimePhase(missionState, directorPhase);
    setMissionRuntimePhase(runtimePhase);
  }, [directorPhase, missionState]);

  useEffect(() => {
    syncMissionRuntimeDepartments(
      actors.map((actor) => ({
        id: actor.id,
        status: actor.status,
        progress: actor.progress
      }))
    );
  }, [actors]);

  useEffect(() => {
    patchMissionRuntimeState({
      directive,
      topic: activeTopic === "-" ? "" : activeTopic,
      summary: report.summary,
      decision: decisionState,
      workflowNotes
    });
  }, [activeTopic, decisionState, directive, report.summary, workflowNotes]);

  function appendLog(line: string) {
    setLogs((prev) => [line, ...prev].slice(0, 14));
  }

  function clearScheduledTimers() {
    for (const timerId of scheduledTimersRef.current) {
      window.clearTimeout(timerId);
    }
    scheduledTimersRef.current = [];
  }

  function scheduleTimer(callback: () => void, delayMs: number) {
    const timerId = window.setTimeout(() => {
      scheduledTimersRef.current = scheduledTimersRef.current.filter((id) => id !== timerId);
      callback();
    }, delayMs);
    scheduledTimersRef.current.push(timerId);
  }

  function teamNameById(deptId: DeptId): string {
    return BASE_ACTORS.find((actor) => actor.id === deptId)?.team ?? deptId;
  }

  function queueMeetingArrival(deptId: DeptId, output: string) {
    updateActor(deptId, (actor) => ({
      ...actor,
      status: "meeting",
      location: "hallway",
      progress: 100,
      output
    }));
    appendLog(`${teamNameById(deptId)}팀이 복도를 통해 미팅룸으로 이동 중입니다.`);

    scheduleTimer(() => {
      updateActor(deptId, (actor) => ({
        ...actor,
        status: "meeting",
        location: "meeting",
        progress: 100
      }));
      appendLog(`${teamNameById(deptId)}팀 착석 완료`);
    }, 820);
  }

  function preparePendingArchive(params: {
    id: string;
    createdAt: string;
    sessionId: string | null;
    roundNumber: number;
    topic: string;
    directive: string;
    summary: string;
    opportunities: string[];
    risks: string[];
    recommendations: string[];
  }) {
    const payload: WorkforceArchivePayload = {
      ...params,
      meetingMinutes: buildMeetingMinutesPayload({
        topic: params.topic,
        directive: params.directive,
        actors: actorsRef.current,
        logs: logsRef.current,
        report: {
          summary: params.summary,
          opportunities: params.opportunities,
          risks: params.risks,
          recommendations: params.recommendations
        },
        decisionMemo: decisionMemoRef.current
      })
    };
    setPendingArchivePayload(payload);
  }

  function approveExecutiveDecision() {
    if (!pendingArchivePayload) {
      appendLog("승인할 보고안이 없습니다.");
      return;
    }

    setMissionState("done");
    setDirectorPhase("approved");
    setCeoPhase("approved");
    setDecisionState("approved");
    setActors((prev) => prev.map((actor) => ({ ...actor, status: actor.status === "error" ? "error" : "done", location: "meeting" })));
    appendLog("대표이사 승인 완료 · 실행 항목이 각 부서로 재배포되었습니다.");
    finishMissionRuntime(reportRef.current.summary || "대표이사 승인 완료", "approved");
    persistArchive(pendingArchivePayload);
    setPendingArchivePayload(null);
  }

  function buildRedispatchDirective(mode: "reject" | "redispatch", baseDirective: string): string {
    const risks = reportRef.current.risks.slice(0, 2);
    const recommendations = reportRef.current.recommendations.slice(0, 3);
    const memo = decisionMemoRef.current.trim();
    const actionLine = mode === "reject"
      ? "대표이사가 반려했습니다. 리스크 우선으로 재작업 후 재보고하세요."
      : "대표이사가 추가 지시를 내렸습니다. 기존 권고안을 실행 가능한 단계로 재배치하세요.";

    return [
      baseDirective.trim(),
      "",
      `[Executive Control] ${actionLine}`,
      memo ? `대표 메모: ${memo}` : "대표 메모: 없음",
      risks.length > 0 ? `핵심 리스크: ${risks.join(" / ")}` : "",
      recommendations.length > 0 ? `핵심 권고: ${recommendations.join(" / ")}` : ""
    ].filter(Boolean).join("\n");
  }

  async function triggerRedispatch(mode: "reject" | "redispatch") {
    if (missionState === "running" || missionState === "briefing") {
      appendLog("현재 실행 중인 미션이 있어 재지시를 대기합니다.");
      return;
    }
    setPendingArchivePayload(null);
    setDecisionState(mode === "reject" ? "rejected" : "redispatched");
    setCeoPhase(mode === "reject" ? "rejected" : "reviewing");
    const nextDirective = buildRedispatchDirective(mode, directive);
    setDirective(nextDirective);
    patchMissionRuntimeState({
      directive: nextDirective,
      decision: mode === "reject" ? "rejected" : "redispatched"
    });
    appendLog(mode === "reject"
      ? "대표이사 반려 · 재작업 루프를 시작합니다."
      : "대표이사 추가 지시 · 보강 루프를 시작합니다.");
    await startMission(nextDirective);
  }

  function persistArchive(payload: WorkforceArchivePayload) {
    if (archivedKeysRef.current.has(payload.id)) return;
    archivedKeysRef.current.add(payload.id);
    void persistExecutiveReport(asArchiveReport(payload)).then((next) => {
      setArchiveReports(next.slice(0, 8));
    });
    onArchiveReport?.(payload);
  }

  function removeArchive(reportId: string) {
    void deleteExecutiveReport(reportId).then((next) => {
      setArchiveReports(next.slice(0, 8));
    });
  }

  function resetActorsToQueued(tasks: string[]) {
    setActors(
      BASE_ACTORS.map((actor, index) => ({
        ...actor,
        status: "queued",
        location: "desk",
        progress: 5,
        objective: tasks[index % tasks.length] ?? "",
        output: "지시 수신 대기"
      }))
    );
  }

  function updateActor(
    deptId: DeptId,
    updater: (actor: Actor) => Actor
  ) {
    setActors((prev) => prev.map((actor) => (actor.id === deptId ? updater(actor) : actor)));
  }

  function applyFallbackFlow(tasks: string[], runDirective: string) {
    appendLog("디렉터 스트림 연결 실패 · 로컬 시뮬레이션으로 전환");
    allDoneReceivedRef.current = false;
    clearScheduledTimers();
    setDirectorPhase("collecting");
    setCeoPhase("waiting");
    setMissionState("running");
    setDecisionState("pending");
    setPendingArchivePayload(null);
    resetActorsToQueued(tasks);

    BASE_ACTORS.forEach((actor, index) => {
      const startDelay = 350 + index * 220;
      const completeDelay = startDelay + 1500 + index * 140;
      const task = tasks[index % tasks.length] ?? "업무 정리";

      scheduleTimer(() => {
        updateActor(actor.id, (current) => ({
          ...current,
          status: "working",
          progress: Math.max(current.progress, 35),
          output: `${task} 분석 진행`
        }));
        appendLog(`${actor.team}팀 작업 시작`);
      }, startDelay);

      scheduleTimer(() => {
        queueMeetingArrival(actor.id, `${task} 실행안 제출`);
      }, completeDelay);
    });

    scheduleTimer(() => {
      setMissionState("briefing");
      setDirectorPhase("reporting");
      setCeoPhase("reviewing");
      setReport({
        opportunities: tasks.slice(0, 3).map((task) => `${task}의 실행 속도를 높일 기회`),
        risks: ["매장별 실행 속도 차이", "프로젝트 간 리소스 충돌", "재고 반영 지연 가능성"],
        recommendations: [
          "우선순위 프로젝트를 3개로 압축하여 당일 실행",
          "POS 데이터 기반 점포별 KPI 자동 갱신",
          "상무 주간 리뷰를 일일 2회 스탠드업으로 전환"
        ],
        summary: "부서 작업이 모두 완료되어 상무가 통합 보고서를 정리했고, 대표이사 승인 직전 단계입니다."
      });
      appendLog("상무 보고서 작성 완료 · 대표이사 브리핑 시작");
    }, 3400);

    scheduleTimer(() => {
      const doneAt = new Date().toISOString();
      const fallbackReport = {
        opportunities: tasks.slice(0, 3).map((task) => `${task}의 실행 속도를 높일 기회`),
        risks: ["매장별 실행 속도 차이", "프로젝트 간 리소스 충돌", "재고 반영 지연 가능성"],
        recommendations: [
          "우선순위 프로젝트를 3개로 압축하여 당일 실행",
          "POS 데이터 기반 점포별 KPI 자동 갱신",
          "상무 주간 리뷰를 일일 2회 스탠드업으로 전환"
        ],
        summary: "로컬 시뮬레이션 모드에서 상무 보고가 완료되었습니다."
      };

      allDoneReceivedRef.current = true;
      setMissionState("review");
      setDirectorPhase("reporting");
      setCeoPhase("reviewing");
      setDecisionState("pending");
      setRoundNumber((prev) => Math.max(prev + 1, 1));
      appendLog("대표이사 결재 대기 · 승인/반려/재지시를 선택하세요.");
      setActors((prev) => prev.map((actor) => ({
        ...actor,
        status: actor.status === "error" ? "error" : "done",
        location: actor.status === "error" ? actor.location : "meeting"
      })));

      preparePendingArchive({
        id: `fallback-${doneAt}`,
        createdAt: doneAt,
        sessionId: null,
        roundNumber: 0,
        topic: activeTopicRef.current === "-" ? "로컬 시뮬레이션 미션" : activeTopicRef.current,
        directive: runDirective,
        summary: fallbackReport.summary,
        opportunities: fallbackReport.opportunities,
        risks: fallbackReport.risks,
        recommendations: fallbackReport.recommendations
      });
    }, 4600);
  }

  function stopMission() {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    clearScheduledTimers();
    setMissionState("idle");
    setDirectorPhase("idle");
    setCeoPhase("waiting");
    setDecisionState("pending");
    setPendingArchivePayload(null);
    appendLog("진행 중인 스트림을 중지했습니다.");
  }

  async function startMission(overrideDirective?: string) {
    if (missionState === "running" || missionState === "briefing") {
      appendLog("현재 미션 진행 중입니다. 완료 후 다시 실행하세요.");
      return;
    }

    const runDirective = String(overrideDirective ?? directive).trim();
    if (!runDirective) {
      appendLog("지시문이 비어 있어 실행할 수 없습니다.");
      return;
    }

    if (overrideDirective && overrideDirective !== directive) {
      setDirective(overrideDirective);
    }

    startMissionRuntime(runDirective, "workforce");

    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;
    allDoneReceivedRef.current = false;
    clearScheduledTimers();

    const tasks = parseTasks(runDirective);
    setReport({ opportunities: [], risks: [], recommendations: [], summary: "" });
    resetActorsToQueued(tasks);
    setMissionState("running");
    setDirectorPhase("dispatching");
    setCeoPhase("waiting");
    setActiveTopic("-");
    setDecisionState("pending");
    setWorkflowNotes({ pmo: "", critic: "", ceo: "" });
    setPendingArchivePayload(null);

    const startedAt = new Date();
    const startedLabel = startedAt.toLocaleTimeString();
    setLastKickoffAt(startedLabel);
    appendLog(`대표이사 지시 접수 · ${startedLabel}`);

    try {
      await consumeDirectorSse(runDirective, sessionId, controller.signal, (event) => {
        if (event.type === "stream_end") {
          if (!allDoneReceivedRef.current && missionStateRef.current !== "error") {
            setMissionState("review");
            setDirectorPhase("reporting");
            setCeoPhase("reviewing");
            const fallbackAt = new Date().toISOString();
            preparePendingArchive({
              id: `${sessionId ?? "stream"}-${roundNumber || 0}-${fallbackAt}`,
              createdAt: fallbackAt,
              sessionId: sessionId ?? null,
              roundNumber: roundNumber || 0,
              topic: activeTopicRef.current === "-" ? "Executive Mission" : activeTopicRef.current,
              directive: runDirective,
              summary: reportRef.current.summary || "스트림 종료로 결재 대기 상태로 전환되었습니다.",
              opportunities: reportRef.current.opportunities,
              risks: reportRef.current.risks,
              recommendations: reportRef.current.recommendations
            });
            appendLog("브리핑 스트림 종료 · 대표이사 결재를 기다립니다.");
          }
          return;
        }

        switch (event.type) {
          case "mission_start": {
            setDirectorPhase("collecting");
            if (event.topic) setActiveTopic(event.topic);
            appendLog(`상무가 ${event.deptCount ?? actors.length}개 부서에 업무를 배분했습니다.`);
            break;
          }
          case "pmo_plan": {
            const planned = event.plan?.selectedDepartments?.length ?? 0;
            const criteria = event.plan?.successCriteria?.[0] ?? "핵심 성과 기준 정렬";
            setWorkflowNotes((prev) => ({
              ...prev,
              pmo: `대상 ${planned}개 부서 · ${criteria}`
            }));
            appendLog(`PMO가 실행 체크리스트를 확정했습니다. 대상 부서 ${planned}개 · ${criteria}`);
            break;
          }
          case "dept_start": {
            if (!event.deptId) break;
            updateActor(event.deptId, (actor) => ({
              ...actor,
              status: "working",
              location: "desk",
              progress: Math.max(actor.progress, 24),
              objective: event.objective ?? actor.objective,
              output: event.objective ? `${event.objective.slice(0, 42)}...` : "업무 분석 시작"
            }));
            appendLog(`${BASE_ACTORS.find((actor) => actor.id === event.deptId)?.team ?? event.deptId}팀 작업 시작`);
            break;
          }
          case "dept_progress": {
            if (!event.deptId) break;
            updateActor(event.deptId, (actor) => ({
              ...actor,
              status: "working",
              progress: Math.max(actor.progress, Math.min(95, Math.max(10, Number(event.percent ?? 0)))),
              output: event.message ?? actor.output
            }));
            break;
          }
          case "dept_done": {
            if (!event.deptId) break;
            const title = readReportTitle(event.report);
            queueMeetingArrival(event.deptId, title);
            break;
          }
          case "dept_error": {
            if (!event.deptId) break;
            setMissionState("error");
            setDirectorPhase("error");
            setCeoPhase("error");
            updateActor(event.deptId, (actor) => ({
              ...actor,
              status: "error",
              progress: 100,
              output: event.error ?? "처리 실패"
            }));
            appendLog(`${event.deptId}팀 오류: ${event.error ?? "unknown"}`);
            break;
          }
          case "ceo_briefing": {
            setMissionState("briefing");
            setDirectorPhase("reporting");
            setCeoPhase("reviewing");
            const parsed = parseBriefingFromPayload(event.briefing, "상무가 부서 결과를 통합해 대표이사 보고안을 구성했습니다.");
            setReport(parsed);
            setWorkflowNotes((prev) => ({
              ...prev,
              ceo: parsed.summary || "상무 통합보고 작성 완료"
            }));
            appendLog("상무가 미팅룸에서 대표이사에게 통합 보고를 시작했습니다.");
            break;
          }
          case "critic_review": {
            const verdict = event.review?.verdict === "needs_followup" ? "보완 필요" : "통과";
            const summary = event.review?.summary?.trim() || "교차검증 완료";
            setWorkflowNotes((prev) => ({
              ...prev,
              critic: `${verdict} · ${summary}`
            }));
            appendLog(`Critic 검증 ${verdict} · ${summary}`);
            break;
          }
          case "all_done": {
            allDoneReceivedRef.current = true;
            const finalReport = event.briefing
              ? parseBriefingFromPayload(event.briefing, "대표이사 보고가 완료되어 실행 단계로 전환합니다.")
              : reportRef.current;
            const finalSessionId = event.sessionId ?? sessionId;
            const finalRound = typeof event.roundNumber === "number" ? event.roundNumber : roundNumber;
            const finalTopic = event.topic ?? activeTopicRef.current;
            const archivedAt = new Date().toISOString();

            setMissionState("review");
            setDirectorPhase("reporting");
            setCeoPhase("reviewing");
            setDecisionState("pending");
            setWorkflowNotes((prev) => ({
              ...prev,
              ceo: finalReport.summary || prev.ceo || "대표 결재 대기"
            }));
            if (finalSessionId) setSessionId(finalSessionId);
            if (typeof event.roundNumber === "number") setRoundNumber(event.roundNumber);
            setReport(finalReport);
            setActors((prev) => prev.map((actor) => ({
              ...actor,
              status: actor.status === "error" ? "error" : "done",
              location: actor.status === "error" ? actor.location : "meeting"
            })));
            appendLog("대표이사 결재 대기 · 승인/반려/재지시를 선택하세요.");

            preparePendingArchive({
              id: `${finalSessionId ?? "local"}-${finalRound || 0}`,
              createdAt: archivedAt,
              sessionId: finalSessionId ?? null,
              roundNumber: finalRound || 0,
              topic: finalTopic && finalTopic !== "-" ? finalTopic : "Executive Mission",
              directive: runDirective,
              summary: finalReport.summary || "대표이사 승인 보고가 완료되었습니다.",
              opportunities: finalReport.opportunities,
              risks: finalReport.risks,
              recommendations: finalReport.recommendations
            });
            break;
          }
          case "error": {
            setMissionState("error");
            setDirectorPhase("error");
            setCeoPhase("error");
            appendLog(`스트림 오류: ${event.message ?? "알 수 없는 오류"}`);
            break;
          }
          default:
            break;
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setMissionState("error");
      setDirectorPhase("error");
      setCeoPhase("error");
      applyFallbackFlow(tasks, runDirective);
      const message = error instanceof Error ? error.message : "director stream error";
      appendLog(`실시간 실행 실패: ${message}`);
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    }
  }

  useEffect(() => {
    void syncExecutiveReports(12).then((next) => {
      setArchiveReports(next.slice(0, 8));
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "convusx.executive-reports.v1") {
        setArchiveReports(listExecutiveReports(8));
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      streamControllerRef.current?.abort();
      clearScheduledTimers();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    const pending = consumePendingWorkforceMission();
    if (!pending?.directive) return;
    setDirective(pending.directive);
    appendLog("HQ에서 전달된 지시를 수신했습니다. Workforce 루프를 시작합니다.");
    void startMission(pending.directive);
  }, []);

  function launchTemplateMission(nextDirective: string) {
    const normalized = nextDirective.trim();
    if (!normalized) return;
    setDirective(normalized);
    appendLog("템플릿 지시를 적용했습니다. 즉시 실행을 시작합니다.");
    void startMission(normalized);
  }

  const directorPosition = DIRECTOR_POSITION[directorPhase];
  const ceoPosition = CEO_POSITION[ceoPhase];

  return (
    <div className="workforce-view">
      <div className="workforce-view__header">
        <div>
          <div className="workforce-view__eyebrow">AI Workforce Game Mode</div>
          <h2 className="workforce-view__title">코지 오피스 오케스트레이션</h2>
          <p className="workforce-view__desc">
            대표이사 지시가 내려오면 각 부서 아바타가 실시간으로 업무를 수행하고,
            완료 후 미팅룸에 집결해 상무가 통합 보고를 진행합니다.
          </p>
        </div>

        <div className="workforce-stats">
          <div className="workforce-stat">
            <span>상태</span>
            <strong>{missionLabel}</strong>
          </div>
          <div className="workforce-stat">
            <span>집결 부서</span>
            <strong>{finishedCount}/{actors.length}</strong>
          </div>
          <div className="workforce-stat">
            <span>평균 진척</span>
            <strong>{workloadScore}%</strong>
          </div>
          <div className="workforce-stat">
            <span>라운드</span>
            <strong>{roundNumber > 0 ? `${roundNumber}R` : "-"}</strong>
          </div>
          <div className="workforce-stat">
            <span>핵심 주제</span>
            <strong>{activeTopic}</strong>
          </div>
          <div className="workforce-stat">
            <span>지시 시각</span>
            <strong>{lastKickoffAt ?? "-"}</strong>
          </div>
        </div>
      </div>

      <section className="ops-route-strip" aria-label="운영 라우팅">
        <span>NEXT OPS</span>
        <div>
          <button type="button" onClick={onOpenStoreOps}>StoreOps 이동</button>
          <button type="button" onClick={onOpenPos}>POS 이동</button>
          <button type="button" onClick={onOpenSales}>매출 대시보드 이동</button>
        </div>
      </section>

      <div className="workforce-command">
        <div className="workforce-command__current">
          <span>현재 지시</span>
          <strong>{directive}</strong>
        </div>
        <div className="workforce-command__templates">
          {MISSION_TEMPLATES.map((item) => (
            <button
              key={item.label}
              type="button"
              className="workforce-command__template"
              onClick={() => launchTemplateMission(item.directive)}
              disabled={missionState === "running" || missionState === "briefing"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="workforce-command__actions">
          <button
            type="button"
            className="workforce-command__button"
            onClick={() => void startMission()}
            disabled={missionState === "running" || missionState === "briefing"}
          >
            현재 지시 실행
          </button>
          {(missionState === "running" || missionState === "briefing") ? (
            <button
              type="button"
              className="workforce-command__stop"
              onClick={stopMission}
            >
              실행 중지
            </button>
          ) : null}
        </div>
      </div>

      <section className="workforce-phase-track" aria-label="미션 단계">
        {phaseTrack.map((item) => (
          <article key={item.key} className={`workforce-phase-track__item is-${item.state}`}>
            <span>{item.label}</span>
          </article>
        ))}
      </section>

      <section className="workforce-live-strip" aria-label="실행 현황 요약">
        <article className="workforce-live-strip__item">
          <span>작업중</span>
          <strong>{workingCount}</strong>
        </article>
        <article className="workforce-live-strip__item">
          <span>이동중</span>
          <strong>{movingCount}</strong>
        </article>
        <article className="workforce-live-strip__item">
          <span>완료/오류</span>
          <strong>{doneCount}/{errorCount}</strong>
        </article>
        <article className="workforce-live-strip__item">
          <span>대표 결재</span>
          <strong>{decisionState}</strong>
        </article>
      </section>

      <div className="workforce-grid">
        <section className={`workforce-office is-camera-${resolvedCameraMode}`} aria-label="오피스 시뮬레이션">
          <div className="workforce-office__texture" aria-hidden="true" />
          <div className="workforce-office__corridor" aria-hidden="true" />

          <div className="workforce-office__hud">
            <span>Session: {sessionId ?? "NEW"}</span>
            <span>Director: {directorPhase}</span>
            <span>CEO: {ceoPhase}</span>
            <div className="workforce-office__camera">
              <button
                type="button"
                className={cameraMode === "auto" ? "is-active" : ""}
                onClick={() => setCameraMode("auto")}
              >
                AUTO
              </button>
              <button
                type="button"
                className={cameraMode === "desks" ? "is-active" : ""}
                onClick={() => setCameraMode("desks")}
              >
                DESK
              </button>
              <button
                type="button"
                className={cameraMode === "meeting" ? "is-active" : ""}
                onClick={() => setCameraMode("meeting")}
              >
                MEET
              </button>
            </div>
          </div>

          <div className="workforce-room workforce-room--meeting">
            <div className="workforce-room__title">Executive Meeting Room</div>
            <div className="workforce-room__subtitle">상무 종합 보고 → 대표이사 의사결정</div>
            <div className="workforce-room__occupancy">참석 {finishedCount}/{actors.length}</div>
            <div className={`workforce-room__decision is-${decisionState}`}>
              {decisionState === "approved"
                ? "대표 승인 완료"
                : decisionState === "rejected"
                  ? "대표 반려 후 재작업"
                  : decisionState === "redispatched"
                    ? "추가 지시 재배포"
                    : "대표 결재 대기"}
            </div>
          </div>

          {BASE_ACTORS.map((actor) => (
            <div
              key={actor.id}
              className="workforce-desk"
              style={{
                left: `${POSITIONS[actor.id].desk.x}%`,
                top: `${POSITIONS[actor.id].desk.y}%`
              }}
            >
              <strong>{actor.team}</strong>
              <span>{actor.lead}</span>
            </div>
          ))}

          {BASE_ACTORS.map((actor) => (
            <div
              key={`${actor.id}-seat`}
              className="workforce-seat"
              style={{
                left: `${POSITIONS[actor.id].meeting.x}%`,
                top: `${POSITIONS[actor.id].meeting.y}%`
              }}
              aria-hidden="true"
            />
          ))}

          {actors.map((actor) => {
            const position = actor.location === "meeting"
              ? POSITIONS[actor.id].meeting
              : actor.location === "hallway"
                ? POSITIONS[actor.id].hallway
                : POSITIONS[actor.id].desk;
            return (
              <div
                key={actor.id}
                className={`workforce-avatar is-${actor.status} is-loc-${actor.location}`}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                title={`${actor.team} · ${actor.status}`}
              >
                <span>{actor.team.slice(0, 1)}</span>
              </div>
            );
          })}

          <div
            className={`workforce-exec workforce-exec--director is-${directorPhase}`}
            style={{ left: `${directorPosition.x}%`, top: `${directorPosition.y}%` }}
            title="상무"
          >
            상무
          </div>

          <div
            className={`workforce-exec workforce-exec--ceo is-${ceoPhase}`}
            style={{ left: `${ceoPosition.x}%`, top: `${ceoPosition.y}%` }}
            title="대표이사"
          >
            대표
          </div>
        </section>

        <section className="workforce-panel">
          <div className="workforce-panel__tabs" role="tablist" aria-label="워크포스 패널 모드">
            <button
              type="button"
              className={`workforce-panel__tab${panelMode === "overview" ? " is-active" : ""}`}
              onClick={() => setPanelMode("overview")}
            >
              개요
            </button>
            <button
              type="button"
              className={`workforce-panel__tab${panelMode === "teams" ? " is-active" : ""}`}
              onClick={() => setPanelMode("teams")}
            >
              부서/로그
            </button>
            <button
              type="button"
              className={`workforce-panel__tab${panelMode === "reports" ? " is-active" : ""}`}
              onClick={() => setPanelMode("reports")}
            >
              보고/아카이브
            </button>
          </div>
          {(panelMode === "overview" || panelMode === "teams") ? (
          <div className="workforce-panel__block">
            <h3>부서 작업 보드</h3>
            <div className="workforce-team-list">
              {actors.map((actor) => (
                <article key={actor.id} className="workforce-team-card">
                  <div className="workforce-team-card__head">
                    <strong>{actor.team}</strong>
                    <span className={`workforce-pill is-${actor.status}`}>{actor.status}</span>
                  </div>
                  <p>{actor.output || actor.objective || "업무 지시 대기"}</p>
                  <div className="workforce-progress">
                    <span style={{ width: `${actor.progress}%` }} />
                  </div>
                </article>
              ))}
            </div>
          </div>
          ) : null}

          {(panelMode === "overview" || panelMode === "teams") ? (
            <div className="workforce-panel__block">
              <h3>상무 보고 로그</h3>
              <ul className="workforce-log-list">
                {(panelMode === "overview" ? logs.slice(0, 6) : logs).map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
              </ul>
            </div>
          ) : null}

          {(panelMode === "overview" || panelMode === "teams") ? (
          <div className="workforce-panel__block">
            <h3>미팅룸 참석 현황</h3>
            <div className="workforce-roster-grid">
              {meetingRoster.map((member) => (
                <article key={member.id} className={`workforce-roster-item is-${member.state}`}>
                  <strong>{member.label}</strong>
                  <span>
                    {member.state === "arrived"
                      ? "착석 완료"
                      : member.state === "moving"
                        ? "이동 중"
                        : member.state === "queued"
                          ? "대기"
                          : member.state === "error"
                            ? "오류"
                            : "준비"}
                  </span>
                </article>
              ))}
            </div>
          </div>
          ) : null}

          {(panelMode === "overview" || panelMode === "reports") ? (
          <div className="workforce-panel__block">
            <h3>보고 아카이브</h3>
            {archiveReports.length > 0 ? (
              <div className="workforce-archive-list">
                {archiveReports.slice(0, 4).map((item) => (
                  <article key={item.id} className="workforce-archive-item">
                    <div className="workforce-archive-item__head">
                      <strong>{item.topic}</strong>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{item.summary || "요약 없음"}</p>
                    <button
                      type="button"
                      onClick={() => onArchiveReport?.({
                        id: item.id,
                        createdAt: item.createdAt,
                        sessionId: item.sessionId,
                        roundNumber: item.roundNumber,
                        topic: item.topic,
                        directive: item.directive,
                        summary: item.summary,
                        opportunities: item.opportunities,
                        risks: item.risks,
                        recommendations: item.recommendations,
                        meetingMinutes: item.meetingMinutes ?? []
                      })}
                    >
                      프로젝트 스레드로 저장
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => removeArchive(item.id)}
                    >
                      아카이브 삭제
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="workforce-report__placeholder">완료된 상무 보고가 여기에 누적됩니다.</p>
            )}
          </div>
          ) : null}
        </section>
      </div>

      <section className="workforce-report">
        <div className="workforce-report__head">
          <strong>상무 최종 보고</strong>
          <span>대표이사 미팅룸 브리핑 포맷</span>
        </div>

        {missionState === "briefing" || missionState === "review" || missionState === "done" ? (
          <div className="workforce-report__body">
            <div className="workforce-report-grid">
              <article>
                <h4>핵심 기회</h4>
                <ul>
                  {(report.opportunities.length > 0 ? report.opportunities : ["브리핑 생성 중입니다."]).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
              <article>
                <h4>핵심 리스크</h4>
                <ul>
                  {(report.risks.length > 0 ? report.risks : ["리스크 항목 수집 중입니다."]).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
              <article>
                <h4>즉시 실행 권고</h4>
                <ul>
                  {(report.recommendations.length > 0 ? report.recommendations : ["권고안 정리 중입니다."]).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            </div>
            <p>{report.summary || "상무가 부서 결과를 통합해 대표이사에게 보고하고 있습니다."}</p>
            <div className="workforce-report-actions">
              <h4>승인 후 즉시 실행</h4>
              <ul>
                {(recommendedActions.length > 0 ? recommendedActions : ["상무 권고안이 생성되면 즉시 실행 카드가 채워집니다."]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="workforce-control">
              <h4>Executive Control</h4>
              <div className="workforce-control__memo-presets">
                <button type="button" onClick={() => setDecisionMemo("리스크 우선순위와 긴급 조치부터 실행")}>리스크 우선</button>
                <button type="button" onClick={() => setDecisionMemo("매장별 실행 순서와 KPI를 재정렬 후 배포")}>KPI 재정렬</button>
                <button type="button" onClick={() => setDecisionMemo("부서 간 의존작업을 분리해 병렬 실행")}>병렬 실행</button>
              </div>
              <p className="workforce-control__memo">{decisionMemo}</p>
              <div className="workforce-control__actions">
                <button
                  type="button"
                  onClick={approveExecutiveDecision}
                  disabled={!pendingArchivePayload || missionState === "briefing"}
                >
                  승인
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => void triggerRedispatch("reject")}
                  disabled={missionState === "briefing"}
                >
                  반려 후 재지시
                </button>
                <button
                  type="button"
                  className="is-ghost"
                  onClick={() => void triggerRedispatch("redispatch")}
                  disabled={missionState === "briefing"}
                >
                  추가 지시 실행
                </button>
              </div>
            </div>
            {pendingArchivePayload?.meetingMinutes && pendingArchivePayload.meetingMinutes.length > 0 ? (
              <div className="workforce-minutes">
                <h4>자동 회의록</h4>
                <ul>
                  {pendingArchivePayload.meetingMinutes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="workforce-report__placeholder">
            업무를 지시하면 각 부서 아바타가 이동하며 결과가 실시간으로 종합됩니다.
          </p>
        )}
      </section>
    </div>
  );
}
