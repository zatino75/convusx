export type RuntimeRequest = {
  task: string;
  input: string;
};

export type RuntimeResponse = {
  ok: boolean;
  answer_text: string;
};

export async function runRuntime(request: RuntimeRequest): Promise<RuntimeResponse> {
  return {
    ok: true,
    answer_text: `runtime placeholder: ${request.task}`
  };
}
