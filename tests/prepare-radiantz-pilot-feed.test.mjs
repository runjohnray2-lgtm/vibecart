import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { syntheticPages, syntheticShop } from './fixtures/radiantz-synthetic.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts/prepare-radiantz-pilot-feed.mjs')

function completeFixture() {
  const pages = structuredClone(syntheticPages)
  for (const page of pages) {
    page.products = page.products
      .filter(p => p.variants.pageInfo.hasNextPage === false)
      .map(p => ({ ...p, title: p.title.replace(/^SYNTHETIC /, 'Fixture ') }))
  }
  return { shop: syntheticShop, pages }
}

function run(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecart-pilot-'))
  const input = path.join(dir, 'private-export.json')
  const output = path.join(dir, 'private-feed.json')
  fs.writeFileSync(input, JSON.stringify(data))
  const result = spawnSync(process.execPath, [script, '--input', input, '--output', output], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  })
  const feed = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null
  const mode = fs.existsSync(output) ? fs.statSync(output).mode & 0o777 : null
  fs.rmSync(dir, { recursive: true, force: true })
  return { ...result, feed, mode }
}

test('offline pilot bridge creates only sanitized VibeCart feed from complete pages', () => {
  const result = run(completeFixture())
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.feed.products.length, 5)
  assert.ok(result.feed.products.every(p =>
    p.id.startsWith('gid://shopify/ProductVariant/') &&
    Number.isSafeInteger(p.priceCents) &&
    !('inventoryPolicy' in p) && !('inventoryQuantity' in p) &&
    !('sku' in p)))
  assert.equal(result.mode, 0o600)
  assert.match(result.stdout, /Source freshness, public hosting and checkout sellability NOT verified/)
})

test('offline pilot bridge refuses truncated Shopify variant families', () => {
  const data = completeFixture()
  data.pages[1].products.push({
    ...structuredClone(syntheticPages[1].products.at(-1)),
    title: 'Fixture truncated variants',
  })
  const result = run(data)
  assert.notEqual(result.status, 0)
  assert.equal(result.feed, null)
  assert.match(result.stderr, /variant family is incomplete/)
})

test('offline pilot bridge refuses incomplete product pagination', () => {
  const data = completeFixture()
  data.pages[0].pageInfo.hasNextPage = false
  const result = run(data)
  assert.notEqual(result.status, 0)
  assert.equal(result.feed, null)
  assert.match(result.stderr, /incomplete product pagination/)
})

test('offline pilot bridge refuses secret fields and labelled synthetic exports', () => {
  const secret = completeFixture()
  secret.access_token = 'placeholder'
  const a = run(secret)
  assert.notEqual(a.status, 0)
  assert.equal(a.feed, null)
  assert.match(a.stderr, /private or credential-related fields/)
  const b = run({ shop: syntheticShop, pages: syntheticPages })
  assert.notEqual(b.status, 0)
  assert.equal(b.feed, null)
  assert.match(b.stderr, /synthetic or missing product title/)
})

test('offline pilot bridge rejects repo-local output paths before writing', () => {
  const result = spawnSync(process.execPath, [
    script, '--input', '/tmp/private-export.json', '--output', path.join(root, 'pilot-feed.json'),
  ], { cwd: root, encoding: 'utf8', timeout: 30000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /outside the public GitHub repository/)
})

test('offline pilot bridge rejects symlinked directories resolving inside the public repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecart-pilot-symlink-'))
  try {
    const link = path.join(dir, 'linked-repo')
    fs.symlinkSync(root, link, 'dir')
    const result = spawnSync(process.execPath, [
      script, '--input', path.join(dir, 'missing-export.json'),
      '--output', path.join(link, 'pilot-feed-symlink-check.json'),
    ], { cwd: root, encoding: 'utf8', timeout: 30000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside the public GitHub repository/)
    assert.equal(fs.existsSync(path.join(root, 'pilot-feed-symlink-check.json')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
