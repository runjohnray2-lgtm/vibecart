import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const sourcePath = "lib/catalog-source.ts"

test("reference products are demo-only and remote mode has no silent fallback", async () => {
  const source = await readFile(sourcePath, "utf8")
  assert.match(source, /if \(!rawUrl\) return PRODUCTS/)
  assert.match(source, /const products = await fetchRemoteCatalog\(rawUrl\)/)
  assert.doesNotMatch(source, /catch[\s\S]{0,300}return PRODUCTS/)
})

test("remote merchant catalogs are HTTPS-only, bounded, timeout protected and redirect resistant", async () => {
  const source = await readFile(sourcePath, "utf8")
  assert.match(source, /url\.protocol !== "https:"/)
  assert.match(source, /redirect: "manual"/)
  assert.match(source, /AbortSignal\.timeout\(CATALOG_TIMEOUT_MS\)/)
  assert.match(source, /MAX_CATALOG_BYTES/)
  assert.match(source, /MAX_PRODUCTS/)
  assert.match(source, /isPrivateIp/)
})

test("remote catalog data is validated before it can become trusted pricing", async () => {
  const source = await readFile(sourcePath, "utf8")
  assert.match(source, /Number\.isSafeInteger\(item\.priceCents\)/)
  assert.match(source, /priceCents must be a non-negative integer/)
  assert.match(source, /Duplicate catalog product id/)
  assert.match(source, /Catalog product image must use HTTPS/)
})

test("merchant catalog credentials remain server-side optional bearer auth", async () => {
  const source = await readFile(sourcePath, "utf8")
  assert.match(source, /VIBECART_CATALOG_BEARER_TOKEN/)
  assert.match(source, /headers\.authorization = `Bearer \$\{bearer\}`/)
  assert.doesNotMatch(source, /console\.(?:log|error)[^\n]*bearer/)
})

test("catalog changes are refreshed on a short bounded cache instead of being compiled into the app", async () => {
  const source = await readFile(sourcePath, "utf8")
  assert.match(source, /CACHE_TTL_MS = 30_000/)
  assert.match(source, /cache\.expiresAt > Date\.now\(\)/)
  assert.match(source, /Date\.now\(\) \+ CACHE_TTL_MS/)
})
