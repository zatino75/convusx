const cases = [
  {
    id: "dialogue_basic",
    task: "dialogue",
    prompt: "브랜드 차별화 전략을 간단히 설명해 주세요."
  },
  {
    id: "reasoning_basic",
    task: "reasoning",
    prompt: "보수적인 운영자에게 Strategy A vs Strategy B 중 무엇이 더 적합한지 이유와 함께 설명해 주세요."
  },
  {
    id: "research_basic",
    task: "research",
    prompt: "온라인 판매 vs 오프라인 리테일 확장의 장단점을 비교하고 어떤 전략이 더 적합한지 추천해 주세요."
  },
  {
    id: "code_basic",
    task: "code",
    prompt: "Node.js에서 provider router 구조를 구현하는 간단한 TypeScript 예시 코드를 보여주세요."
  }
]

async function run() {
  const results = []

  for (const c of cases) {
    const r = await fetch("http://localhost:8000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: c.prompt,
        task: c.task,
        benchmark_mode: true,
        mode: "runtime_orchestra",
        thread_id: `benchmark_${c.id}`,
        project_id: "benchmark_core"
      })
    })

    const j = await r.json()

    results.push({
      case: c.id,
      task: c.task,
      result: j
    })
  }

  console.log(JSON.stringify(results, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
