import { executeOrchestra } from "../dist/server/src/orchestra/runtime.js"

const result = await executeOrchestra({
  message: "AI ORCHESTRA를 왜 단일 모델보다 우수하게 설계했는지 설명해줘.",
  task: "reasoning",
  mode: "runtime_orchestra",
  thread_id: "runtime_smoke",
  project_id: "runtime_project"
})

console.log(JSON.stringify(result, null, 2))
