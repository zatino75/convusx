export type PlannerOutput = {
  task_type: string;
  execution_plan: string[];
};

export function buildPlan(input: string): PlannerOutput {
  return {
    task_type: "general",
    execution_plan: [
      `analyze: ${input}`,
      "select provider",
      "execute",
      "judge"
    ]
  };
}
