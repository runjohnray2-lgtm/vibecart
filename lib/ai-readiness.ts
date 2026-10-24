import { normalizeCurrency } from '@/lib/shopify-catalog-mapper'

/**
 * AI Readiness evaluator (Issue #105). Pure and offline: no network, no database, no env.
 *
 * It reports whether a catalog is COMPATIBLE and ACCESSIBLE for the VibeCart MCP/UCP
 * surfaces. It does not measure, predict or promise that any AI assistant will find,
 * rank or recommend a product.
 *
 * Endpoint verification only counts when probe evidence has origin server_probe, is
 * fresh (not stale, not future-dated), came from the expected URL when one is given, and
 * lists the required capabilities. Evidence typed in by a person (origin manual) is never
 * trusted. No evidence means not verified, never ok. This evaluator cannot prove that
 * evidence is genuine: the caller that builds server_probe evidence must be a trusted
 * server-side probe.
 */

export const READINESS_DISCLAIMER =
  'This report checks catalog quality and whether VibeCart endpoints are verified. It does not predict or guarantee that any AI assistant will discover, rank or recommend your products.'

export type Severity = 'blocker' | 'warning' | 'info'

export type ReadinessIssue = {
  code: string
  severity: Severity
  message: string
  productId?: string
}

export type ProductReadiness = {
  id: string
  name?: string
  exposable: boolean
  issues: ReadinessIssue[]
}

export type ProbeKind = 'mcp' | 'ucp'

export type ProbeEvidence = {
  kind: ProbeKind
  url: string
  /** server_probe = produced by a trusted server-side probe. manual = typed in by a person, never trusted. */
  origin: 'server_probe' | 'manual'
  /** Epoch milliseconds when the probe ran. */
  checkedAt: number
  ok: boolean
  capabilities?: string[]
  detail?: string
}

export type EndpointStatus =
  | 'verified'
  | 'stale'
  | 'failed'
  | 'missing_capabilities'
  | 'not_verified'
  | 'unverified_manual'
  | 'wrong_endpoint'
  | 'invalid_timestamp'

export type EndpointReadiness = {
  kind: ProbeKind
  status: EndpointStatus
  url?: string
  checkedAt?: number
  missingCapabilities: string[]
  message: string
}

export type FreshnessStatus = 'fresh' | 'stale' | 'unknown'

export type ReadinessInput = {
  /** Catalog entries as served to VIBECART_CATALOG_URL, or the mapper output. */
  products: unknown
  /** Currency the catalog is sold in (ISO 4217). Catalog entries carry no currency, so it must be supplied. */
  currencyCode?: string
  probes?: ProbeEvidence[]
  /** When set, probe evidence for that kind must come from exactly this URL. */
  expectedEndpoints?: Partial<Record<ProbeKind, string>>
  /** Epoch milliseconds of the last successful catalog sync. */
  lastSyncedAt?: number
  /** Epoch milliseconds treated as now. Defaults to Date.now(). */
  now?: number
  maxCatalogAgeMs?: number
  maxProbeAgeMs?: number
}

export type BlockerSummary = { code: string; message: string; count: number; examples: string[] }

export type ReadinessLevel = 'not_ready' | 'needs_work' | 'ready_for_agent_testing'

export type ReadinessReport = {
  level: ReadinessLevel
  disclaimer: string
  totals: { products: number; exposable: number; withBlockers: number; withWarnings: number }
  catalogIssues: ReadinessIssue[]
  products: ProductReadiness[]
  endpoints: EndpointReadiness[]
  currency: { status: 'verified' | 'missing' | 'invalid'; code?: string; message: string }
  freshness: { status: FreshnessStatus; ageMs?: number; message: string }
  blockers: BlockerSummary[]
  warnings: BlockerSummary[]
}

export const REQUIRED_CAPABILITIES: Record<ProbeKind, string[]> = {
  mcp: ['vibecart.list_products', 'vibecart.get_product'],
  ucp: ['create_cart', 'get_cart', 'update_cart', 'cancel_cart'],
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_PRODUCTS = 10_000
const LIMITS = { id: 200, name: 500, variant: 500, description: 5000, image: 2000 }

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractProducts(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input
  if (isObject(input) && Array.isArray(input.products)) return input.products
  return undefined
}

function evaluateProduct(raw: unknown, index: number, duplicates: Set<string>): ProductReadiness {
  const issues: ReadinessIssue[] = []
  if (!isObject(raw)) {
    return {
      id: '(entry ' + index + ')',
      exposable: false,
      issues: [{ code: 'entry_not_object', severity: 'blocker', message: 'Entry ' + index + ' is not an object.' }],
    }
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const label = id || '(entry ' + index + ')'
  const add = (code: string, severity: Severity, message: string) => {
    issues.push({ code, severity, message, ...(id ? { productId: id } : {}) })
  }

  if (!id) add('id_missing', 'blocker', 'Product has no id.')
  else if (id.length > LIMITS.id) add('id_too_long', 'blocker', 'Product id is longer than ' + LIMITS.id + ' characters.')
  else if (duplicates.has(id)) add('id_duplicate', 'blocker', 'Product id appears more than once.')

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) add('name_missing', 'blocker', 'Product has no name.')
  else if (name.length > LIMITS.name) add('name_too_long', 'blocker', 'Product name is longer than ' + LIMITS.name + ' characters.')

  const price = raw.priceCents
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) {
    add('price_invalid', 'blocker', 'priceCents must be a non-negative integer number of cents.')
  } else if (price === 0) {
    add('price_zero', 'warning', 'Price is 0. Confirm this product is meant to be free.')
  }

  const image = raw.image
  if (image === undefined || image === null || image === '') {
    add('image_missing', 'warning', 'Product has no image.')
  } else if (typeof image !== 'string' || image.length > LIMITS.image) {
    add('image_invalid', 'blocker', 'Image must be a text URL of at most ' + LIMITS.image + ' characters.')
  } else {
    let protocol = ''
    try {
      protocol = new URL(image).protocol
    } catch {
      protocol = ''
    }
    if (protocol !== 'https:') add('image_not_https', 'blocker', 'Image must be an absolute HTTPS URL.')
  }

  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    add('description_missing', 'warning', 'Product has no description.')
  } else if (raw.description.length > LIMITS.description) {
    add('description_too_long', 'warning', 'Description is longer than ' + LIMITS.description + ' characters and will be cut.')
  }

  if (raw.variant !== undefined && raw.variant !== null) {
    if (typeof raw.variant !== 'string' || raw.variant.length > LIMITS.variant) {
      add('variant_invalid', 'blocker', 'Variant must be text of at most ' + LIMITS.variant + ' characters.')
    }
  }

  if (isObject(raw.shopify)) {
    const variantId = typeof raw.shopify.variantId === 'string' ? raw.shopify.variantId : undefined
    const productId = typeof raw.shopify.productId === 'string' ? raw.shopify.productId : undefined
    if (!variantId || !productId) {
      add('source_ids_incomplete', 'blocker', 'Shopify product and variant ids are both required when a shopify block is present.')
    } else if (variantId !== id) {
      add('source_ids_mismatch', 'blocker', 'Catalog id does not equal the Shopify variant id, so orders could be mapped to the wrong variant.')
    }
  } else {
    add('source_ids_unverified', 'info', 'No source-platform ids supplied, so the catalog id cannot be checked against your store.')
  }

  const exposable = !issues.some(issue => issue.severity === 'blocker')
  return { id: label, ...(name ? { name } : {}), exposable, issues }
}

function evaluateEndpoint(
  kind: ProbeKind,
  probes: ProbeEvidence[],
  now: number,
  maxAgeMs: number,
  expectedUrl: string | undefined,
): EndpointReadiness {
  const required = REQUIRED_CAPABILITIES[kind]
  const label = kind.toUpperCase()
  const matching = probes
    .filter(probe => probe && probe.kind === kind && Number.isFinite(probe.checkedAt))
    .sort((a, b) => b.checkedAt - a.checkedAt)
  const latest = matching[0]
  if (!latest) {
    return {
      kind,
      status: 'not_verified',
      missingCapabilities: required,
      message: label + ' endpoint has not been verified. No probe evidence was supplied.',
    }
  }
  const base = { kind, url: latest.url, checkedAt: latest.checkedAt }
  if (latest.origin !== 'server_probe') {
    return {
      ...base,
      status: 'unverified_manual',
      missingCapabilities: required,
      message: label + ' evidence was entered manually, so it is not trusted. Only a server-side probe can verify an endpoint.',
    }
  }
  if (expectedUrl !== undefined && latest.url !== expectedUrl) {
    return {
      ...base,
      status: 'wrong_endpoint',
      missingCapabilities: required,
      message: label + ' probe URL ' + latest.url + ' does not match the expected endpoint ' + expectedUrl + '.',
    }
  }
  if (latest.checkedAt > now + MAX_CLOCK_SKEW_MS) {
    return {
      ...base,
      status: 'invalid_timestamp',
      missingCapabilities: required,
      message: label + ' probe timestamp is in the future, so the evidence is rejected.',
    }
  }
  if (!latest.ok) {
    return {
      ...base,
      status: 'failed',
      missingCapabilities: required,
      message: label + ' probe failed' + (latest.detail ? ': ' + latest.detail : '.'),
    }
  }
  const advertised = new Set(Array.isArray(latest.capabilities) ? latest.capabilities : [])
  const missing = required.filter(name => !advertised.has(name))
  if (missing.length > 0) {
    return {
      ...base,
      status: 'missing_capabilities',
      missingCapabilities: missing,
      message: label + ' endpoint responded but did not list: ' + missing.join(', ') + '.',
    }
  }
  if (now - latest.checkedAt > maxAgeMs) {
    return {
      ...base,
      status: 'stale',
      missingCapabilities: [],
      message: label + ' verification is older than the allowed age. Re-run the probe.',
    }
  }
  return { ...base, status: 'verified', missingCapabilities: [], message: label + ' endpoint verified with all required capabilities.' }
}

function summarize(issues: ReadinessIssue[], severity: Severity): BlockerSummary[] {
  const groups = new Map<string, BlockerSummary>()
  for (const issue of issues) {
    if (issue.severity !== severity) continue
    const group = groups.get(issue.code) ?? { code: issue.code, message: issue.message, count: 0, examples: [] }
    group.count += 1
    if (issue.productId && group.examples.length < 3 && !group.examples.includes(issue.productId)) group.examples.push(issue.productId)
    groups.set(issue.code, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1))
}

export function evaluateCatalogReadiness(input: ReadinessInput): ReadinessReport {
  const now = input.now ?? Date.now()
  const catalogIssues: ReadinessIssue[] = []
  const raw = extractProducts(input.products)

  if (!raw) {
    catalogIssues.push({ code: 'catalog_shape', severity: 'blocker', message: 'Catalog must be an array of products or an object like { "products": [...] }.' })
  } else if (raw.length === 0) {
    catalogIssues.push({ code: 'catalog_empty', severity: 'blocker', message: 'Catalog has no products.' })
  } else if (raw.length > MAX_PRODUCTS) {
    catalogIssues.push({ code: 'catalog_too_large', severity: 'blocker', message: 'Catalog has more than ' + MAX_PRODUCTS + ' products, which the catalog loader rejects.' })
  }

  const entries = raw && raw.length <= MAX_PRODUCTS ? raw : []
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.id === 'string' && entry.id.trim()) {
      const key = entry.id.trim()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const duplicates = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id))
  const products = entries.map((entry, index) => evaluateProduct(entry, index, duplicates))

  let currency: ReadinessReport['currency']
  if (input.currencyCode === undefined || input.currencyCode === '') {
    currency = { status: 'missing', message: 'No currency was supplied. Catalog entries carry no currency, so it cannot be verified.' }
    catalogIssues.push({ code: 'currency_missing', severity: 'blocker', message: currency.message })
  } else {
    try {
      const code = normalizeCurrency(input.currencyCode)
      currency = { status: 'verified', code, message: 'Prices are read as integer cents in ' + code + '. This is the currency you supplied, not one detected from your store.' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Currency is not supported.'
      currency = { status: 'invalid', message }
      catalogIssues.push({ code: 'currency_invalid', severity: 'blocker', message })
    }
  }

  const maxProbeAgeMs = input.maxProbeAgeMs ?? DAY_MS
  const probes = Array.isArray(input.probes) ? input.probes : []
  const expected = input.expectedEndpoints ?? {}
  const endpoints = (['mcp', 'ucp'] as ProbeKind[]).map(kind => evaluateEndpoint(kind, probes, now, maxProbeAgeMs, expected[kind]))
  for (const endpoint of endpoints) {
    if (endpoint.status !== 'verified') {
      catalogIssues.push({ code: 'endpoint_' + endpoint.kind + '_' + endpoint.status, severity: 'blocker', message: endpoint.message })
    }
  }

  const maxCatalogAgeMs = input.maxCatalogAgeMs ?? DAY_MS
  let freshness: ReadinessReport['freshness']
  if (input.lastSyncedAt === undefined || !Number.isFinite(input.lastSyncedAt)) {
    freshness = { status: 'unknown', message: 'No sync time was supplied, so data freshness is unknown.' }
    catalogIssues.push({ code: 'freshness_unknown', severity: 'warning', message: freshness.message })
  } else if (input.lastSyncedAt > now + MAX_CLOCK_SKEW_MS) {
    freshness = { status: 'unknown', message: 'Catalog sync timestamp is in the future; freshness cannot be verified.' }
    catalogIssues.push({ code: 'freshness_future_timestamp', severity: 'warning', message: freshness.message })
  } else {
    const ageMs = Math.max(0, now - input.lastSyncedAt)
    if (ageMs > maxCatalogAgeMs) {
      freshness = { status: 'stale', ageMs, message: 'Catalog data is older than the allowed age. Prices or availability may have changed.' }
      catalogIssues.push({ code: 'freshness_stale', severity: 'warning', message: freshness.message })
    } else {
      freshness = { status: 'fresh', ageMs, message: 'Catalog data is within the allowed age.' }
    }
  }

  const allIssues = [...catalogIssues, ...products.flatMap(product => product.issues)]
  const exposable = products.filter(product => product.exposable).length
  const hasBlocker = allIssues.some(issue => issue.severity === 'blocker')
  const hasWarning = allIssues.some(issue => issue.severity === 'warning')
  const level: ReadinessLevel = hasBlocker ? (exposable === 0 ? 'not_ready' : 'needs_work') : hasWarning ? 'needs_work' : 'ready_for_agent_testing'

  return {
    level,
    disclaimer: READINESS_DISCLAIMER,
    totals: {
      products: products.length,
      exposable,
      withBlockers: products.filter(product => product.issues.some(issue => issue.severity === 'blocker')).length,
      withWarnings: products.filter(product => product.issues.some(issue => issue.severity === 'warning')).length,
    },
    catalogIssues,
    products,
    endpoints,
    currency,
    freshness,
    blockers: summarize(allIssues, 'blocker'),
    warnings: summarize(allIssues, 'warning'),
  }
}
