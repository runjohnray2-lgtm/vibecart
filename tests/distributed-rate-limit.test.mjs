import assert from "node:assert/strict"
import { readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import ts from "typescript"

async function loadRateLimiterWithoutDatabase() {
  const source = await readFile("lib/distributed-rate-limit.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
    .replace('import { neon } from "@neondatabase/serverless";', 'const neon = () => { throw new Error("database should not be reached") };')
  const path = join(tmpdir(), `vibecart-rate-limit-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
  await writeFile(path, compiled, "utf8")
  const limiter = await import(`${pathToFileURL(path).href}?t=${Date.now()}`)
  return { limiter, cleanup: () => rm(path, { force: true }) }
}

function withDatabaseEnv(value, fn) {
  const previousDatabase = process.env.DATABASE_URL
  const previousPostgres = process.env.POSTGRES_URL
  if (value === undefined) {
    delete process.env.DATABASE_URL
    delete process.env.POSTGRES_URL
  } else {
    process.env.DATABASE_URL = value
    delete process.env.POSTGRES_URL
  }
  return Promise.resolve().then(fn).finally(() => {
    if (previousDatabase === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabase
    if (previousPostgres === undefined) delete process.env.POSTGRES_URL
    else process.env.POSTGRES_URL = previousPostgres
  })
}

test("rate policies separate reads, state changes and checkout", async () => {
  const { limiter, cleanup } = await loadRateLimiterWithoutDatabase()
  try {
    assert.deepEqual(limiter.RATE_LIMIT_POLICIES.catalogRead, {
      scope: "catalog-read",
      limit: 60,
      windowSeconds: 60,
      failClosed: false,
    })
    assert.deepEqual(limiter.RATE_LIMIT_POLICIES.commerceWrite, {
      scope: "commerce-write",
      limit: 30,
      windowSeconds: 60,
      failClosed: true,
    })
    assert.deepEqual(limiter.RATE_LIMIT_POLICIES.checkout, {
      scope: "checkout",
      limit: 20,
      windowSeconds: 60,
      failClosed: true,
    })
  } finally {
    await cleanup()
  }
})

test("read traffic explicitly degrades open if the shared limiter is unavailable", async () => {
  const { limiter, cleanup } = await loadRateLimiterWithoutDatabase()
  try {
    await withDatabaseEnv(undefined, async () => {
      const result = await limiter.consumeRateLimit(
        new Request("https://example.test/mcp", { headers: { "x-forwarded-for": "203.0.113.10" } }),
        limiter.RATE_LIMIT_POLICIES.catalogRead,
      )
      assert.equal(result.allowed, true)
      assert.equal(result.degraded, true)
      assert.equal(result.backendUnavailable, true)
      assert.equal(result.retryAfterSeconds, 0)
    })
  } finally {
    await cleanup()
  }
})

test("state-changing commerce fails closed if the shared limiter is unavailable", async () => {
  const { limiter, cleanup } = await loadRateLimiterWithoutDatabase()
  try {
    await withDatabaseEnv(undefined, async () => {
      for (const policy of [limiter.RATE_LIMIT_POLICIES.commerceWrite, limiter.RATE_LIMIT_POLICIES.checkout]) {
        const result = await limiter.consumeRateLimit(
          new Request("https://example.test/api/checkout", { headers: { "x-forwarded-for": "203.0.113.11" } }),
          policy,
        )
        assert.equal(result.allowed, false)
        assert.equal(result.degraded, true)
        assert.equal(result.backendUnavailable, true)
        assert.ok(result.retryAfterSeconds > 0)
      }
    })
  } finally {
    await cleanup()
  }
})

test("durable limiter uses one atomic database row per scope and hashed request key", async () => {
  const source = await readFile("lib/distributed-rate-limit.ts", "utf8")
  assert.match(source, /sha256Hex/)
  assert.match(source, /ON CONFLICT \(scope, key_hash\) DO UPDATE SET/)
  assert.match(source, /request_count = CASE/)
  assert.match(source, /vibecart_rate_limits\.request_count \+ 1/)
  assert.doesNotMatch(source, /new Map/)
  assert.doesNotMatch(source, /console\.error\([^\n]*clientAddress/)
})

test("middleware applies stable retry metadata and separate MCP tool budgets", async () => {
  const middleware = await readFile("middleware.ts", "utf8")
  assert.match(middleware, /vibecart\.create_checkout/)
  assert.match(middleware, /create_cart/)
  assert.match(middleware, /update_cart/)
  assert.match(middleware, /cancel_cart/)
  assert.match(middleware, /RATE_LIMIT_POLICIES\.catalogRead/)
  assert.match(middleware, /RATE_LIMIT_POLICIES\.commerceWrite/)
  assert.match(middleware, /RATE_LIMIT_POLICIES\.checkout/)
  assert.match(middleware, /retry-after/)
  assert.match(middleware, /x-ratelimit-limit/)
  assert.match(middleware, /x-ratelimit-remaining/)
  assert.match(middleware, /x-ratelimit-reset/)
  assert.match(middleware, /RATE_LIMIT_BACKEND_UNAVAILABLE/)
  assert.match(middleware, /RATE_LIMITED/)
})

test("migration never stores a raw client address", async () => {
  const migration = await readFile("migrations/002_distributed_rate_limits.sql", "utf8")
  assert.match(migration, /key_hash text NOT NULL/)
  assert.match(migration, /PRIMARY KEY \(scope, key_hash\)/)
  assert.match(migration, /updated_at/)
  assert.doesNotMatch(migration, /\bip_address\b|\bclient_ip\b/i)
})
