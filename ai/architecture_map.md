# AI ORCHESTRA ARCHITECTURE

User
-> Planner
-> Execution Engine
-> Adaptive Router
-> Parallel Router / Provider Selection
-> Claims Engine
-> Conflict Detector
-> Judge
-> Final Answer

## File Mapping

Planner
server/src/orchestra/planner.ts

Execution Engine
server/src/orchestra/runtime.ts

Router
server/src/orchestra/router.ts

Judge
server/src/orchestra/judge.ts

Benchmark Evaluator
server/src/benchmark/evaluator.ts

Scoreboard
server/src/benchmark/scoreboard.ts
