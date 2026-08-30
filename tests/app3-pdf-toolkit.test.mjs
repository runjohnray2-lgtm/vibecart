import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const page = fs.readFileSync("app/apps/pdf/page.tsx", "utf8")
const component = fs.readFileSync("components/pdf-toolkit.tsx", "utf8")
const library = fs.readFileSync("app/apps/page.tsx", "utf8")
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))

test("PDF Toolkit is entitlement-gated behind authenticated VibeCart account access", () => {
  assert.match(page, /getAuth\(\)\.getSession\(\)/)
  assert.match(page, /redirect\("\/auth\/sign-in\?next=\/apps\/pdf"\)/)
  assert.match(page, /ensureInitialAppTrial\(data\.user\.id, "pdf"\)/)
  assert.match(page, /hasAppAccess\(data\.user\.id, "pdf"\)/)
})

test("PDF Toolkit keeps source PDF processing in the browser", () => {
  assert.match(component, /"use client"/)
  assert.match(component, /file\.arrayBuffer\(\)/)
  assert.match(component, /PDFDocument\.load/)
  assert.doesNotMatch(component, /fetch\(/)
  assert.doesNotMatch(component, /FormData/)
  assert.match(page, /not uploaded to VibeCart/)
})

test("PDF Toolkit exposes merge extract split reorder rotate and removal workflows", () => {
  assert.match(component, /mergeFiles/)
  assert.match(component, /extractPages/)
  assert.match(component, /splitIndividual/)
  assert.match(component, /movePage/)
  assert.match(component, /rotatePage/)
  assert.match(component, /deletePage/)
  assert.match(component, /downloadOrganized/)
})

test("PDF Toolkit is listed in the shared App Factory library", () => {
  assert.match(library, /PDF Toolkit/)
  assert.match(library, /href: "\/apps\/pdf"/)
  assert.equal(packageJson.dependencies["pdf-lib"], "^1.17.1")
})
