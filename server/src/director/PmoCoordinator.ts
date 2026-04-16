import type { DecomposedMission, DeptTask } from "./TaskDecomposer.js";

export interface PmoTaskChecklist {
  deptId: string;
  priority: "high" | "medium" | "low";
  objective: string;
  deliverable: string;
  etaMinutes: number;
}

export interface PmoPlan {
  missionObjective: string;
  successCriteria: string[];
  selectedDepartments: string[];
  taskChecklist: PmoTaskChecklist[];
  riskControls: string[];
  generatedAt: string;
}

function toChecklist(task: DeptTask): PmoTaskChecklist {
  return {
    deptId: task.deptId,
    priority: task.priority,
    objective: task.objective,
    deliverable: task.deliverable,
    etaMinutes: task.estimatedMinutes,
  };
}

function buildSuccessCriteria(mission: DecomposedMission): string[] {
  const criteria: string[] = [
    "핵심 부서 결과에서 실행 가능한 권고안이 최소 3개 이상 도출될 것",
    "법무/재무 리스크가 분리 표기되고 보완 조치가 함께 제시될 것",
    "최종 브리핑에 근거, 가정, 후속 확인 항목이 명확히 구분될 것",
  ];
  if (mission.domain === "ecig") {
    criteria.push("규제 준수 여부(FDA/국내 규정 포함)가 명시적으로 검토될 것");
  }
  if (mission.domain === "food" || mission.domain === "cosmetic") {
    criteria.push("인허가/표시 규정 관련 필수 체크리스트가 포함될 것");
  }
  return criteria.slice(0, 5);
}

export function buildPmoPlan(directive: string, mission: DecomposedMission): PmoPlan {
  const sortedTasks = [...mission.tasks].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  return {
    missionObjective: directive.trim() || mission.topic,
    successCriteria: buildSuccessCriteria(mission),
    selectedDepartments: sortedTasks.map((task) => task.deptId),
    taskChecklist: sortedTasks.map(toChecklist),
    riskControls: [
      "부서 간 상충 결론 발생 시 Critic 검증 단계에서 우선 해결",
      "신뢰도 0.65 미만 결과는 CEO 브리핑에서 불확실성으로 분리 표기",
      "근거 미확인 항목은 즉시 실행안에서 제외하고 후속 조사로 이관",
    ],
    generatedAt: new Date().toISOString(),
  };
}

