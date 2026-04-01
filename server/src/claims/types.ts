export type ClaimType =
  | "fact"
  | "numeric"
  | "recommendation"
  | "comparison"

export type Claim = {
  id: string
  provider: string
  type: ClaimType
  text: string
}

export type ClaimsResult = {
  claims: Claim[]
  conflicts: any[]
  claim_density?: Record<string, number>
  evidence_strength?: Record<string, number>
}
