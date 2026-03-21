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

function extractText(j) {
  return (
    j?.result?.final?.answer_text ||
    j?.result?.final?.text ||
    j?.result?.primary?.answer_text ||
    j?.result?.primary?.text ||
    ""
  )
}

function detectShape(text) {
  const t = String(text || "").toLowerCase()

  if (!t) return "empty"

  if (t.includes("final recommendation") || t.includes("결론")) {
    return "reasoning_like"
  }

  if (t.includes("trade-off") || t.includes("장단점") || t.includes("evidence")) {
    return "research_like"
  }

  if (t.includes("function") || t.includes("class") || t.includes("```")) {
    return "code_like"
  }

  return "dialogue_like"
}

async function run() {
  const results = []

  for (const c of cases) {
    const start = Date.now()

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

    const elapsed = Date.now() - start

    const j = await r.json()
    const text = extractText(j)
    const shape = detectShape(text)

    results.push({
      case: c.id,
      task: c.task,
      elapsed_ms: elapsed,
      http_status: r.status,
      extracted_text: text.slice(0, 300),
      detected_shape: shape,
      raw: j
    })
  }

  console.log(JSON.stringify(results, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
