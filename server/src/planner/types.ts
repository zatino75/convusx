import type { OrxTask, ProviderName } from "../adapters/types.js";

export type PlannerMode =
  | "single"
  | "duo"
  | "triple";

export type PlannerStepKind =
  | "classify"
  | "research"
  | "reason"
  | "code"
  | "draft"
  | "verify"
  | "merge"
  | "finalize";

export interface PlannerInput {
  task: OrxTask;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  requestedProviders?: ProviderName[];
  requestedProvider?: ProviderName | null;
}

export interface PlannerStep {
  id: string;
  kind: PlannerStepKind;
  title: string;
  provider_hints: ProviderName[];
  required: boolean;
  notes?: string;
}

export interface PlannerPlan {
  planner_version: string;
  task: OrxTask;
  mode: PlannerMode;
  goal: string;
  provider_sequence: ProviderName[];
  steps: PlannerStep[];
  routing_policy: string;
  rationale: string[];
}
