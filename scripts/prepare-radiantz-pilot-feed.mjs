/**
 * Offline-only bridge from a PRIVATE, fully paginated Shopify Admin export
 * to VibeCart's public catalog-source JSON contract.
 *
 * No Shopify network calls, credentials, deployment, database, or checkout.
 * Output is written OUTSIDE the repository; publishing it is a separate,
 * reviewed action after merchant/tenant and staging safety gates.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTsModules, assertCatalogContract } from '../tests/helpers/shopify-test-utils.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_INPUT_BYTES = 25 * 1024 * 1024
const forbiddenKey = /^(?:authorization|access[_-]?token|api[_-]?key|client[_-]?secret|password|customers?|orders?|billing|shipping_address)$/i

function outsideRepo(filePath) {
  // A lexically external path can still resolve into this public repository via
  // a symlinked parent (or an existing symlinked input/output file).
  const canonical = fs.existsSync(filePath)
    ? fs.realpathSync(filePath)
    : path.join(fs.realpathSync(path.dirname(filePath)), path.basename(filePath))
  const relative = path.relative(fs.realpathSync(repoRoot), canonical)
  return relative !== '' && (relative === '..' || relative.startsWith('..' + path.sep))
}

function checkNoPrivateFields(value) {
  if (Array.isArray(value)) {
    value.forEach(checkNoPrivateFields)
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKey.test(key)) throw new Error('export contains private or credential-related fields')
      checkNoPrivateFields(entry)
    }
  } else if (typeof value === 'string' && /shpat_|shpss_|shpca_|sk_(?:live|test)_/i.test(value)) {
    throw new Error('export contains a credential-like value')
  }
}

function validateExport(data) {
  if (!data || typeof data !== 'object' || data.shop?.currencyCode !== 'USD' ||
      !Array.isArray(data.pages) || data.pages.length === 0) {
    throw new Error('expected a complete { shop: { currencyCode: "USD" }, pages: [...] } export')
  }
  checkNoPrivateFields(data)
  const seenProducts = new Set()
  const seenCursors = new Set()
  let activeProducts = 0
  for (let i = 0; i < data.pages.length; i += 1) {
    const page = data.pages[i]
    if (!page || !Array.isArray(page.products) || page.products.length === 0 ||
        typeof page.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('incomplete Shopify product page at index ' + i)
    }
    const more = i < data.pages.length - 1
    if (page.pageInfo.hasNextPage !== more) throw new Error('incomplete product pagination at page ' + i)
    if (more) {
      const cursor = page.pageInfo.endCursor
      if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) {
        throw new Error('missing or repeated product cursor at page ' + i)
      }
      seenCursors.add(cursor)
    }
    for (const product of page.products) {
      if (!product || typeof product.id !== 'string' ||
          !/^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(product.id) ||
          seenProducts.has(product.id)) {
        throw new Error('missing, invalid or repeated Shopify product GID')
      }
      seenProducts.add(product.id)
      if (typeof product.title !== 'string' || /^SYNTHETIC\b/i.test(product.title)) {
        throw new Error('synthetic or missing product title; not a real pilot export')
      }
      if (product.status === 'ACTIVE') activeProducts += 1
      if (!product.variants || typeof product.variants.pageInfo?.hasNextPage !== 'boolean' ||
          product.variants.pageInfo.hasNextPage ||
          !Array.isArray(product.variants.nodes)) {
        throw new Error('variant family is incomplete or not fully hydrated for ' + product.id)
      }
    }
  }
  if (activeProducts === 0) throw new Error('no ACTIVE products in Shopify export')
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output' ||
      !argv[1] || !argv[3]) {
    throw new Error('usage: node scripts/prepare-radiantz-pilot-feed.mjs --input /private/shop-export.json --output /private/catalog-feed.json')
  }
  const input = path.resolve(argv[1])
  const output = path.resolve(argv[3])
  if (!outsideRepo(input) || !outsideRepo(output)) {
    throw new Error('input and output must stay outside the public GitHub repository')
  }
  if (input === output) throw new Error('output must differ from input')
  return { input, output }
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2))
  if (fs.statSync(input).size > MAX_INPUT_BYTES) throw new Error('export exceeds 25 MiB')
  const data = JSON.parse(fs.readFileSync(input, 'utf8'))
  validateExport(data)
  const { syncShopifyCatalog, toCatalogFeed } =
    (await loadTsModules(['lib/shopify-catalog-mapper.ts', 'lib/shopify-catalog-sync.ts']))['shopify-catalog-sync']
  let next = 0
  const result = await syncShopifyCatalog({
    shopCurrencyCode: data.shop.currencyCode,
    expectedCurrencyCode: 'USD',
    fetchPage: async () => {
      const page = data.pages[next++]
      if (!page) throw new Error('export ended before sync completed')
      return page
    },
  })
  if (next !== data.pages.length) throw new Error('not all Shopify product pages were processed')
  const unsafeSkips = result.skipped.filter(item =>
    !/^product status is (?:DRAFT|ARCHIVED)$|^product is not published$/.test(item.reason))
  if (unsafeSkips.length || result.warnings.length) {
    throw new Error('export contains ' + unsafeSkips.length + ' invalid/skipped entries and ' +
      result.warnings.length + ' integrity warnings; feed not generated')
  }
  const feed = toCatalogFeed(result.snapshot)
  assertCatalogContract(feed.products)
  if (feed.products.length === 0) throw new Error('feed contains no eligible variants')
  // Never overwrite an existing file. Keep even the sanitized local export private
  // until merchant provenance, safe publication and staging isolation are reviewed.
  fs.writeFileSync(output, JSON.stringify(feed, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log('Offline feed prepared: ' + feed.products.length + ' variants from ' +
    seenCount(data.pages) + ' Shopify products; ' + result.skipped.length +
    ' inactive/unpublished products excluded. No live Shopify or VibeCart calls. ' +
    'Source freshness, public hosting and checkout sellability NOT verified.')
}

function seenCount(pages) { return pages.reduce((sum, page) => sum + page.products.length, 0) }

main().catch(error => {
  console.error('Offline pilot feed not generated: ' + (error instanceof Error ? error.message : 'unknown error'))
  process.exitCode = 1
})
