import type { ProductCompatibility, VibeProduct } from "@/lib/products"

const MAX_QUERY_LENGTH = 500
const MAX_COMPATIBILITY_FIELDS = 12
const MAX_COMPATIBILITY_VALUE_LENGTH = 200
const MAX_RESULTS = 20
const COMPATIBILITY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "for", "i", "in", "is", "it", "me", "my", "of", "on", "the", "to", "want", "with",
])

export class SalesAssistantInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SalesAssistantInputError"
  }
}

export interface SalesDiscoveryInput {
  query: string
  compatibility?: Record<string, string>
  limit?: number
}

export type SalesCompatibilityStatus =
  | "verified"
  | "not_required"
  | "needs_clarification"
  | "unknown"
  | "incompatible"

export interface SalesCompatibilityEvidence {
  status: SalesCompatibilityStatus
  statement?: string
  matched: Record<string, string>
  missingFields: string[]
}

export interface SalesProductMatch {
  product: VibeProduct
  availability: VibeProduct["availability"]
  compatibility: SalesCompatibilityEvidence
  matchedTerms: string[]
}

export interface SalesClarifyingQuestion {
  field: string
  question: string
}

export interface SalesDiscoveryResult {
  status: "matches" | "needs_clarification" | "no_match"
  query: string
  compatibility: Record<string, string>
  matches: SalesProductMatch[]
  candidates: SalesProductMatch[]
  clarifyingQuestions: SalesClarifyingQuestion[]
  message: string
}

function normalizeKey(raw: string): string {
  const value = raw.trim()
  if (!COMPATIBILITY_KEY.test(value)) {
    throw new SalesAssistantInputError(
      "Compatibility keys must be 1-40 letters, numbers, dots, colons, underscores, or dashes"
    )
  }
  return value
}

function normalizeCompatibility(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SalesAssistantInputError("compatibility must be an object of string values")
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_COMPATIBILITY_FIELDS) {
    throw new SalesAssistantInputError(`compatibility cannot exceed ${MAX_COMPATIBILITY_FIELDS} fields`)
  }
  const result: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeKey(rawKey)
    const foldedKey = key.toLowerCase()
    if (seen.has(foldedKey)) throw new SalesAssistantInputError("Duplicate compatibility field")
    seen.add(foldedKey)
    if (typeof rawValue !== "string") {
      throw new SalesAssistantInputError(`compatibility.${key} must be a string`)
    }
    const normalized = rawValue.trim()
    if (!normalized || normalized.length > MAX_COMPATIBILITY_VALUE_LENGTH) {
      throw new SalesAssistantInputError(
        `compatibility.${key} must be 1-${MAX_COMPATIBILITY_VALUE_LENGTH} characters`
      )
    }
    result[key] = normalized
  }
  return result
}

function normalizeInput(value: SalesDiscoveryInput): Required<Pick<SalesDiscoveryInput, "query" | "limit">> & {
  compatibility: Record<string, string>
} {
  if (!value || typeof value !== "object") throw new SalesAssistantInputError("sales discovery input is required")
  if (typeof value.query !== "string") throw new SalesAssistantInputError("query is required")
  const query = value.query.trim()
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new SalesAssistantInputError(`query must be 1-${MAX_QUERY_LENGTH} characters`)
  }
  const limit = value.limit ?? 10
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new SalesAssistantInputError(`limit must be a whole number from 1 to ${MAX_RESULTS}`)
  }
  return { query, compatibility: normalizeCompatibility(value.compatibility), limit }
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function tokens(query: string): string[] {
  return [...new Set(
    normalized(query)
      .split(/[^a-z0-9]+/g)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  )]
}

function compatibilitySearchText(compatibility?: ProductCompatibility): string {
  if (!compatibility) return ""
  return [
    compatibility.statement ?? "",
    ...Object.entries(compatibility.attributes ?? {}).flatMap(([key, values]) => [key, ...values]),
  ].join(" ")
}

function relevance(product: VibeProduct, query: string): { score: number; matchedTerms: string[] } {
  const queryTokens = tokens(query)
  if (queryTokens.length === 0) return { score: 0, matchedTerms: [] }

  const name = normalized(product.name)
  const variant = normalized(product.variant ?? "")
  const description = normalized(product.description)
  const id = normalized(product.id)
  const compatibility = normalized(compatibilitySearchText(product.compatibility))
  const wholeQuery = normalized(query)
  let score = name.includes(wholeQuery) && wholeQuery.length > 1 ? 20 : 0
  const matchedTerms: string[] = []

  for (const token of queryTokens) {
    let tokenScore = 0
    if (name.includes(token)) tokenScore = Math.max(tokenScore, 6)
    if (variant.includes(token)) tokenScore = Math.max(tokenScore, 5)
    if (id.includes(token)) tokenScore = Math.max(tokenScore, 4)
    if (compatibility.includes(token)) tokenScore = Math.max(tokenScore, 3)
    if (description.includes(token)) tokenScore = Math.max(tokenScore, 2)
    if (tokenScore > 0) {
      score += tokenScore
      matchedTerms.push(token)
    }
  }

  return { score, matchedTerms }
}

function lowerEntries(value: Record<string, string>): Map<string, { key: string; value: string }> {
  return new Map(Object.entries(value).map(([key, entryValue]) => [
    key.toLowerCase(),
    { key, value: entryValue },
  ]))
}

function questionFor(compatibility: ProductCompatibility, field: string): string {
  const configured = Object.entries(compatibility.questions ?? {})
    .find(([key]) => key.toLowerCase() === field.toLowerCase())?.[1]
  if (configured) return configured
  const label = field.replace(/[._:-]+/g, " ")
  return `What ${label} should I match?`
}

function evaluateCompatibility(
  product: VibeProduct,
  shopper: Record<string, string>
): SalesCompatibilityEvidence {
  const spec = product.compatibility
  if (!spec) {
    return { status: "unknown", matched: {}, missingFields: [] }
  }
  if (spec.mode === "not_required") {
    return {
      status: "not_required",
      ...(spec.statement ? { statement: spec.statement } : {}),
      matched: {},
      missingFields: [],
    }
  }

  const provided = lowerEntries(shopper)
  const attributes = new Map(
    Object.entries(spec.attributes ?? {}).map(([key, values]) => [
      key.toLowerCase(),
      { key, values },
    ])
  )
  const matched: Record<string, string> = {}

  for (const [lowerKey, supplied] of provided) {
    const rule = attributes.get(lowerKey)
    if (!rule) return { status: "unknown", matched, missingFields: [] }
    const accepted = rule.values.some(value => normalized(value) === normalized(supplied.value))
    if (!accepted) {
      return {
        status: "incompatible",
        ...(spec.statement ? { statement: spec.statement } : {}),
        matched,
        missingFields: [],
      }
    }
    matched[rule.key] = supplied.value
  }

  const missingFields: string[] = []
  for (const requiredField of spec.required ?? []) {
    const supplied = provided.get(requiredField.toLowerCase())
    const rule = attributes.get(requiredField.toLowerCase())
    if (!supplied || !rule) {
      missingFields.push(requiredField)
      continue
    }
    const accepted = rule.values.some(value => normalized(value) === normalized(supplied.value))
    if (!accepted) {
      return {
        status: "incompatible",
        ...(spec.statement ? { statement: spec.statement } : {}),
        matched,
        missingFields: [],
      }
    }
    matched[rule.key] = supplied.value
  }

  return {
    status: missingFields.length ? "needs_clarification" : "verified",
    ...(spec.statement ? { statement: spec.statement } : {}),
    matched,
    missingFields,
  }
}

function matchRecord(
  product: VibeProduct,
  compatibility: Record<string, string>,
  matchedTerms: string[]
): SalesProductMatch {
  return {
    product,
    availability: product.availability,
    compatibility: evaluateCompatibility(product, compatibility),
    matchedTerms,
  }
}

export function discoverSalesProducts(
  products: VibeProduct[],
  rawInput: SalesDiscoveryInput
): SalesDiscoveryResult {
  const input = normalizeInput(rawInput)
  const compatibilityProvided = Object.keys(input.compatibility).length > 0
  const ranked = products
    .map(product => ({ product, ...relevance(product, input.query) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))

  const matches: SalesProductMatch[] = []
  const candidates: SalesProductMatch[] = []

  for (const entry of ranked) {
    const record = matchRecord(entry.product, input.compatibility, entry.matchedTerms)
    if (record.compatibility.status === "incompatible") continue
    if (record.availability === "out_of_stock") {
      candidates.push(record)
      continue
    }
    if (record.compatibility.status === "needs_clarification") {
      candidates.push(record)
      continue
    }
    if (compatibilityProvided && record.compatibility.status === "unknown") {
      candidates.push(record)
      continue
    }
    matches.push(record)
    if (matches.length >= input.limit) break
  }

  const questionByField = new Map<string, SalesClarifyingQuestion>()
  for (const candidate of candidates) {
    if (candidate.compatibility.status !== "needs_clarification") continue
    const spec = candidate.product.compatibility
    if (!spec) continue
    for (const field of candidate.compatibility.missingFields) {
      const key = field.toLowerCase()
      if (!questionByField.has(key)) {
        questionByField.set(key, { field, question: questionFor(spec, field) })
      }
    }
  }
  const clarifyingQuestions = [...questionByField.values()].slice(0, MAX_COMPATIBILITY_FIELDS)

  if (matches.length > 0) {
    return {
      status: "matches",
      query: input.query,
      compatibility: input.compatibility,
      matches,
      candidates: candidates.slice(0, input.limit),
      clarifyingQuestions,
      message: "Use only the returned trusted product IDs and prices. Report availability and compatibility status exactly as returned.",
    }
  }

  if (clarifyingQuestions.length > 0) {
    return {
      status: "needs_clarification",
      query: input.query,
      compatibility: input.compatibility,
      matches: [],
      candidates: candidates.slice(0, input.limit),
      clarifyingQuestions,
      message: "Ask the returned compatibility questions before claiming fitment or creating a sales cart.",
    }
  }

  return {
    status: "no_match",
    query: input.query,
    compatibility: input.compatibility,
    matches: [],
    candidates: candidates.slice(0, input.limit),
    clarifyingQuestions: [],
    message: candidates.length > 0 && candidates.every(candidate => candidate.availability === "out_of_stock")
      ? "Matching products are out of stock. Do not offer checkout."
      : compatibilityProvided && candidates.length > 0
      ? "Catalog products matched the request, but the merchant has not provided structured compatibility data covering every supplied attribute. Do not claim fitment."
      : "No trusted catalog match was found. Do not invent a product, fitment, price, discount, or availability.",
  }
}

export function assertSalesCompatibility(
  product: VibeProduct,
  compatibility: Record<string, string>
): SalesCompatibilityEvidence {
  const normalizedShopper = normalizeCompatibility(compatibility)
  const result = evaluateCompatibility(product, normalizedShopper)
  if (result.status === "incompatible") {
    throw new SalesAssistantInputError(`Product ${product.id} is not compatible with the supplied shopper attributes`)
  }
  if (result.status === "needs_clarification") {
    throw new SalesAssistantInputError(
      `Product ${product.id} requires compatibility fields: ${result.missingFields.join(", ")}`
    )
  }
  if (Object.keys(normalizedShopper).length > 0 && result.status === "unknown") {
    throw new SalesAssistantInputError(
      `Product ${product.id} does not have trusted compatibility data for this fitment request`
    )
  }
  return result
}
