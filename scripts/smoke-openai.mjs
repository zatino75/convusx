import { dispatchProvider } from "../dist/server/src/orchestra/adapterDispatcher.js"

const result = await dispatchProvider({
  provider: "openai",
  task: "dialogue",
  mode: "single_model",
  input: {
    message: "AI ORCHESTRA를 한 문장으로 설명해줘.",
    thread_id: "smoke_openai",
    project_id: "smoke_project"
  }
})

console.log(JSON.stringify(result, null, 2))
