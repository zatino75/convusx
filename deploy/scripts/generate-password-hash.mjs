#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// CORVUS X — 비밀번호 해시 생성기
//
// 사용: node deploy/scripts/generate-password-hash.mjs '<비밀번호>'
//
// 출력 예: scrypt$16384$<saltHex>$<hashHex>
// 이 출력값을 .env 의 CORVUS_ACCESS_PASSWORD_HASH 에 붙여넣으세요.
//
// scrypt 파라미터 (Node crypto 기본값과 호환):
//   N=16384, r=8, p=1, keylen=64
// ═══════════════════════════════════════════════════════════

import { randomBytes, scryptSync } from "node:crypto"

const pw = process.argv[2]

if (!pw || pw.length < 8) {
  console.error("사용: node deploy/scripts/generate-password-hash.mjs '<비밀번호 8자 이상>'")
  console.error("주의: 셸 history 에 비밀번호가 남지 않게 따옴표로 감싸거나 HISTCONTROL=ignorespace 사용 권장")
  process.exit(1)
}

const N = 16384
const salt = randomBytes(16)
const hash = scryptSync(pw, salt, 64, { N, r: 8, p: 1 })

const out = `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`
console.log("")
console.log("── 생성된 해시 ─────────────────────────────────────────")
console.log(out)
console.log("────────────────────────────────────────────────────────")
console.log("")
console.log(".env 또는 /etc/corvusx/.env 에 아래 줄을 추가하세요:")
console.log("")
console.log(`CORVUS_ACCESS_PASSWORD_HASH=${out}`)
console.log("")
console.log("그리고 세션 시크릿도 반드시 새로 생성해서 넣으세요:")
console.log("")
console.log(`CORVUS_SESSION_SECRET=${randomBytes(48).toString("hex")}`)
console.log("")
