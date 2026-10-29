import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Node 20 has no TypeScript loader in this repo, so tests transpile the real .ts files
 * into a temp directory (rewriting the @/lib/ alias to relative imports) and import them.
 * Returns an object keyed by file name without extension.
 */
export async function loadTsModules(sourcePaths) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecart-ts-'))
  const names = sourcePaths.map(p => path.basename(p, '.ts'))
  sourcePaths.forEach((sourcePath, index) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    const rewritten = outputText.replace(/from (['"])@\/lib\/([\w-]+)\1/g, "from './$2.mjs'")
    fs.writeFileSync(path.join(dir, names[index] + '.mjs'), rewritten)
  })
  const loaded = {}
  for (const name of names) {
    loaded[name] = await import(pathToFileURL(path.join(dir, name + '.mjs')).href)
  }
  return loaded
}

/** Mirrors the rules enforced by parseProduct and parseCatalogDocument in lib/catalog-source.ts. */
export function assertCatalogContract(products) {
  const seen = new Set()
  for (const p of products) {
    assert.ok(typeof p.id === 'string' && p.id.length >= 1 && p.id.length <= 200)
    assert.ok(typeof p.name === 'string' && p.name.length >= 1 && p.name.length <= 500)
    assert.ok(Number.isSafeInteger(p.priceCents) && p.priceCents >= 0)
    assert.equal(typeof p.description, 'string')
    assert.ok(p.description.length <= 5000)
    assert.ok(p.image === '' || new URL(p.image).protocol === 'https:')
    assert.ok(p.variant === undefined || (typeof p.variant === 'string' && p.variant.length <= 500))
    assert.ok(!seen.has(p.id), 'duplicate id ' + p.id)
    seen.add(p.id)
  }
  assert.ok(products.length <= 10000)
}
