import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'https://vibecart.vercel.app'
const email = `app2-smoke-${Date.now()}@example.com`
const password = `Smoke-${Date.now()}-A9!`
const downloadPath = '/tmp/vibecart-app2-smoke.jpg'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()

try {
  await page.goto(`${base}/auth/sign-in?next=/apps/images`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Need an account? Create one' }).click()
  await page.getByLabel('Name').fill('App2 Smoke Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/apps/images', { timeout: 30000 })
  await page.getByRole('heading', { name: 'Image Toolkit' }).waitFor()

  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#123456'
    ctx.fillRect(0, 0, 320, 180)
    ctx.fillStyle = '#ffffff'
    ctx.font = '32px sans-serif'
    ctx.fillText('VibeCart App #2', 32, 100)
    return canvas.toDataURL('image/png')
  })
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64')
  await page.locator('input[type=file]').setInputFiles({ name: 'test-image.png', mimeType: 'image/png', buffer })
  await page.getByText('320×180').waitFor()

  await page.locator('select').nth(0).selectOption('width')
  await page.locator('input[type=number]').fill('160')
  await page.locator('select').nth(1).selectOption('image/jpeg')
  await page.getByRole('button', { name: /Process 1 image/ }).click()
  await page.getByRole('heading', { name: 'Ready to download' }).waitFor({ timeout: 30000 })
  await page.getByText('160×90', { exact: false }).waitFor()
  await page.getByText('test-image-vibecart.jpg').waitFor()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download test-image.png' }).click()
  const download = await downloadPromise
  await download.saveAs(downloadPath)
  const bytes = await fs.readFile(downloadPath)
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Downloaded output is not a valid-looking JPEG (${bytes.length} bytes)`)
  }

  const size = await page.evaluate(async base64 => {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
    const out = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return out
  }, bytes.toString('base64'))
  if (size.width !== 160 || size.height !== 90) throw new Error(`Expected 160x90 output, got ${size.width}x${size.height}`)

  console.log(JSON.stringify({ ok: true, email, input: '320x180 PNG', output: `${size.width}x${size.height} JPEG`, bytes: bytes.length }))
} finally {
  await browser.close()
}
