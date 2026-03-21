import { dispatchProvider } from "../dist/server/src/orchestra/adapterDispatcher.js"

const result = await dispatchProvider({
  provider: "claude",
  task: "reasoning",
  mode: "single_model",
  input: {
    message: "AI ORCHESTRA 구조의 핵심 장점을 짧게 설명해줘.",
    thread_id: "smoke_claude",
    project_id: "smoke_project"
  }
})

console.log(JSON.stringify(result, null, 2))
