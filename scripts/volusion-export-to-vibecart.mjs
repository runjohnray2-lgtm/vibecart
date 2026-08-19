import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function textOf(node, names) {
  for (const name of names) {
    const match = node.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))
    if (match) return decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim())
  }
  return ""
}

function cents(value, field, productCode) {
  if (!value) return null
  const normalized = value.replace(/[$,\s]/g, "")
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid ${field} for ${productCode || "unknown product"}`)
  }
  return Math.round(amount * 100)
}

function findProductNodes(xml) {
  const nodes = []
  const tagPattern = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g
  let match
  while ((match = tagPattern.exec(xml))) {
    const body = match[2]
    if (/<ProductCode(?:\s[^>]*)?>/i.test(body) && /<ProductName(?:\s[^>]*)?>/i.test(body)) {
      nodes.push(body)
    }
  }
  if (nodes.length) return nodes

  // Some Volusion exports flatten records under generic row elements. Split on ProductCode as a safe fallback.
  const parts = xml.split(/(?=<ProductCode(?:\s[^>]*)?>)/i)
  return parts.filter(part => /<ProductCode(?:\s[^>]*)?>/i.test(part) && /<ProductName(?:\s[^>]*)?>/i.test(part))
}

export function convertVolusionXml(xml) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("Volusion XML input is empty")

  const products = []
  const seen = new Set()
  for (const node of findProductNodes(xml)) {
    const id = textOf(node, ["ProductCode", "p.ProductCode"])
    const name = textOf(node, ["ProductName", "p.ProductName"])
    if (!id || !name || seen.has(id)) continue

    const productPrice = cents(textOf(node, ["ProductPrice", "pe.ProductPrice"]), "ProductPrice", id)
    const salePrice = cents(textOf(node, ["SalePrice", "pe.SalePrice"]), "SalePrice", id)
    const priceCents = salePrice !== null && salePrice > 0 ? salePrice : productPrice
    if (priceCents === null) throw new Error(`Missing ProductPrice for ${id}`)

    const description = textOf(node, ["ProductDescriptionShort", "ProductDescriptionShrt", "ProductDescription", "ProductFeatures"])
    const image = textOf(node, ["PhotoURLLarge", "PhotoURL", "PhotoURLSmall"])

    products.push({
      id,
      name,
      description: description.slice(0, 5000),
      priceCents,
      image: image.startsWith("https://") ? image : "",
    })
    seen.add(id)
  }

  if (!products.length) throw new Error("No Volusion products with ProductCode and ProductName were found")
  return { products }
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/volusion-export-to-vibecart.mjs <volusion.xml> <catalog.json>")
    process.exitCode = 2
    return
  }
  const xml = await readFile(inputPath, "utf8")
  const catalog = convertVolusionXml(xml)
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
  console.log(`Converted ${catalog.products.length} Volusion products to ${outputPath}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
