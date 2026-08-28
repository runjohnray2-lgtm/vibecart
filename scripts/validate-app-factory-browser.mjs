import { chromium } from "@playwright/test"
import { randomBytes } from "node:crypto"

const baseUrl = "https://vibecart.vercel.app"
const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`
const email = `appfactory-ui-${stamp}@example.com`
const password = `VibeCart-${randomBytes(18).toString("base64url")}!9`
const slug = `ui-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()

try {
  await page.goto(`${baseUrl}/auth/sign-in?next=/apps/links`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Need an account? Create one" }).click()
  await page.getByLabel("Name").fill("App Factory Browser Validation")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL("**/apps/links", { timeout: 15000 })
  await page.getByRole("heading", { name: "Link + QR + UTM Manager" }).waitFor()
  console.log("PASS browser account creation and app entry")

  await page.getByLabel("Title").fill("Browser validation link")
  await page.getByLabel("Short code").fill(slug)
  await page.getByLabel("Destination URL").fill(`${baseUrl}/apps?browser=1`)
  await page.getByLabel("UTM source").fill("vibecart")
  await page.getByLabel("UTM medium").fill("browser-test")
  await page.getByLabel("UTM campaign").fill("first-app-launch")
  await page.getByRole("button", { name: "Create short link + QR" }).click()

  const card = page.locator("article").filter({ hasText: slug })
  await card.waitFor({ state: "visible", timeout: 15000 })
  if (await card.locator("svg").count() < 1) throw new Error("QR SVG did not render")
  console.log("PASS created-link card and QR render")

  const downloadPromise = page.waitForEvent("download")
  await card.getByRole("button", { name: "QR SVG" }).click()
  const download = await downloadPromise
  if (download.suggestedFilename() !== `${slug}-qr.svg`) throw new Error(`wrong QR filename: ${download.suggestedFilename()}`)
  console.log("PASS QR SVG download")

  const popupPromise = page.waitForEvent("popup")
  await card.getByRole("link", { name: "Open" }).click()
  const popup = await popupPromise
  await popup.waitForLoadState("domcontentloaded")
  const finalUrl = new URL(popup.url())
  if (finalUrl.pathname !== "/apps" || finalUrl.searchParams.get("browser") !== "1" || finalUrl.searchParams.get("utm_source") !== "vibecart" || finalUrl.searchParams.get("utm_medium") !== "browser-test" || finalUrl.searchParams.get("utm_campaign") !== "first-app-launch") {
    throw new Error(`browser redirect mismatch: ${popup.url()}`)
  }
  await popup.close()
  console.log("PASS browser Open redirect and UTM merge")

  await page.getByRole("button", { name: "Refresh analytics" }).click()
  await page.waitForTimeout(1000)
  const clicksText = await card.textContent()
  if (!clicksText || !/Clicks\s*[1-9]/s.test(clicksText)) throw new Error(`click analytics not visible in card: ${clicksText}`)
  console.log("PASS browser analytics refresh")

  console.log(JSON.stringify({ ok: true, email, slug }, null, 2))
} finally {
  await browser.close()
}
