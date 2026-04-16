/**
 * TaskDecomposer.ts
 * 사용자 지시를 부서별 Task로 분해하는 모듈
 * Claude Sonnet 4.6이 자연어 지시를 분석해서 각 부서가 해야 할 작업을 구조화
 */

export type DeptId =
  | 'market' | 'compete' | 'legal' | 'finance'
  | 'marketing' | 'rnd' | 'data' | 'content' | 'sns';

export interface DeptTask {
  deptId: DeptId;
  priority: 'high' | 'medium' | 'low';
  objective: string;       // 이 부서가 해야 할 구체적 목표
  context: string;         // 배경 컨텍스트
  deliverable: string;     // 기대 산출물
  estimatedMinutes: number;
}

export interface DecomposedMission {
  missionId: string;
  originalDirective: string;
  topic: string;           // 핵심 주제 (예: "액상전자담배")
  domain: 'food' | 'ecig' | 'cosmetic' | 'general';
  tasks: DeptTask[];
  round: number;
  createdAt: Date;
}

// 도메인 감지
function detectDomain(directive: string): DecomposedMission['domain'] {
  const d = directive.toLowerCase();
  if (d.includes('전자담배') || d.includes('액상') || d.includes('ecig') || d.includes('vape')) return 'ecig';
  if (d.includes('식품') || d.includes('음식') || d.includes('food') || d.includes('음료')) return 'food';
  if (d.includes('화장품') || d.includes('뷰티') || d.includes('cosmetic') || d.includes('스킨케어')) return 'cosmetic';
  return 'general';
}

// 핵심 주제 추출
function extractTopic(directive: string): string {
  const patterns = [
    /[""]([^""]+)[""]/,
    /\[([^\]]+)\]/,
    /(?:관련|대한|위한)\s+(.+?)(?:\s+(?:사업|분석|검토|개발))?$/,
  ];
  for (const p of patterns) {
    const m = directive.match(p);
    if (m) return m[1].trim();
  }
  // 첫 10 단어 이내에서 핵심 명사 추출
  return directive.replace(/[은는이가을를의]/g, ' ').split(' ').slice(0, 4).join(' ').trim();
}

// 부서별 기본 Task 템플릿
const DEPT_TASK_TEMPLATES: Record<DeptId, (topic: string, domain: string) => Omit<DeptTask, 'deptId'>> = {
  market: (topic, domain) => ({
    priority: 'high',
    objective: `${topic} 관련 시장 규모, 성장률, 주요 트렌드, 소비자 프로필 조사`,
    context: `도메인: ${domain}. 국내외 시장 현황 및 성장 가능성 파악 필요`,
    deliverable: '시장 규모(금액), 성장률, 트렌드 Top5, 타겟 소비자 프로필',
    estimatedMinutes: 8,
  }),
  compete: (topic, domain) => ({
    priority: 'high',
    objective: `${topic} 시장 주요 경쟁사 분석, 시장점유율, 강약점 비교`,
    context: `도메인: ${domain}. 진입 가능한 포지셔닝 기회 발굴 목적`,
    deliverable: '경쟁사 Top5 프로파일, 점유율, 차별화 기회',
    estimatedMinutes: 10,
  }),
  legal: (topic, domain) => ({
    priority: 'high',
    objective: `${topic} 관련 법규, 인허가, 규제 리스크 검토`,
    context: `도메인: ${domain}. 사업 진행 전 법적 리스크 사전 식별`,
    deliverable: '필수 인허가 목록, 규제 리스크 등급, 준수 체크리스트',
    estimatedMinutes: 12,
  }),
  finance: (topic, domain) => ({
    priority: 'high',
    objective: `${topic} 사업 재무 타당성 분석, 투자 규모, 수익 전망`,
    context: `도메인: ${domain}. 사업 진출 의사결정을 위한 재무 근거 확보`,
    deliverable: '초기 투자액, BEP, ROI(3년), 리스크 시나리오',
    estimatedMinutes: 10,
  }),
  marketing: (topic, domain) => ({
    priority: 'medium',
    objective: `${topic} 브랜드 포지셔닝, 마케팅 전략, 채널 계획 수립`,
    context: `도메인: ${domain}. 시장 진입 시 브랜드 차별화 방향 설정`,
    deliverable: '포지셔닝 전략, 핵심 메시지, 채널 믹스, 런칭 로드맵',
    estimatedMinutes: 9,
  }),
  rnd: (topic, domain) => ({
    priority: 'medium',
    objective: `${topic} 제품 기술 타당성, 원료/성분, 개발 로드맵 분석`,
    context: `도메인: ${domain}. 실제 제품화 가능성 및 기술적 차별화 요소 파악`,
    deliverable: '기술 스펙, 원료 분석, 개발 일정, 특허 현황',
    estimatedMinutes: 14,
  }),
  data: (topic, domain) => ({
    priority: 'medium',
    objective: `${topic} 관련 소비자 데이터, 검색 트렌드, 리뷰 데이터 분석`,
    context: `도메인: ${domain}. 데이터 기반 의사결정 지원`,
    deliverable: '소비자 인사이트, 키워드 트렌드, 감성 분석 결과',
    estimatedMinutes: 8,
  }),
  content: (topic, domain) => ({
    priority: 'low',
    objective: `${topic} 브랜드 콘텐츠 방향, 비주얼 아이덴티티, 콘텐츠 전략 기획`,
    context: `도메인: ${domain}. 마케팅 실행을 위한 콘텐츠 기반 마련`,
    deliverable: '브랜드 톤&매너, 콘텐츠 유형, 제작 일정',
    estimatedMinutes: 7,
  }),
  sns: (topic, domain) => ({
    priority: 'low',
    objective: `${topic} SNS 채널 전략, 포스팅 계획, KPI 설정`,
    context: `도메인: ${domain}. 소셜 채널을 통한 브랜드 인지도 구축 방안`,
    deliverable: '채널별 전략, 포스팅 빈도, KPI 지표',
    estimatedMinutes: 6,
  }),
};

// 지시 유형에 따른 부서 우선순위 조정
function adjustPriorities(tasks: DeptTask[], directive: string): DeptTask[] {
  const d = directive.toLowerCase();

  const boostDept = (id: DeptId) => {
    const t = tasks.find(t => t.deptId === id);
    if (t && t.priority !== 'high') t.priority = 'high';
  };

  if (d.includes('법규') || d.includes('규제') || d.includes('인허가')) boostDept('legal');
  if (d.includes('투자') || d.includes('수익') || d.includes('재무')) boostDept('finance');
  if (d.includes('경쟁') || d.includes('시장점유') || d.includes('competitor')) boostDept('compete');
  if (d.includes('마케팅') || d.includes('브랜딩') || d.includes('런칭')) boostDept('marketing');
  if (d.includes('제품') || d.includes('개발') || d.includes('성분')) boostDept('rnd');

  // 우선순위 기준 정렬
  const order = { high: 0, medium: 1, low: 2 };
  return tasks.sort((a, b) => order[a.priority] - order[b.priority]);
}

let missionCounter = 0;

export function decomposeMission(directive: string, round = 1): DecomposedMission {
  missionCounter++;
  const missionId = `MISSION-${Date.now()}-${missionCounter}`;
  const topic = extractTopic(directive);
  const domain = detectDomain(directive);

  const ALL_DEPTS: DeptId[] = ['market', 'compete', 'legal', 'finance', 'marketing', 'rnd', 'data', 'content', 'sns'];

  const tasks: DeptTask[] = ALL_DEPTS.map(deptId => {
    const template = DEPT_TASK_TEMPLATES[deptId](topic, domain);
    return { deptId, ...template };
  });

  const adjusted = adjustPriorities(tasks, directive);

  return {
    missionId,
    originalDirective: directive,
    topic,
    domain,
    tasks: adjusted,
    round,
    createdAt: new Date(),
  };
}
