import assert from "node:assert/strict"
import test from "node:test"
import { convertVolusionXml, fetchVolusionXml, inspectVolusionXml } from "../scripts/volusion-export-to-vibecart.mjs"

const sample = `<?xml version="1.0"?>
<Volusion>
  <Product>
    <ProductCode>RAD-001</ProductCode>
    <ProductName>Radiantz Test Strip</ProductName>
    <ProductDescriptionShort><![CDATA[Flexible LED strip]]></ProductDescriptionShort>
    <ProductPrice>69.00</ProductPrice>
    <SalePrice>59.95</SalePrice>
    <PhotoURLLarge>https://example.com/rad-001.jpg</PhotoURLLarge>
  </Product>
  <Product>
    <ProductCode>RAD-002</ProductCode>
    <ProductName>Radiantz Test Module</ProductName>
    <ProductPrice>$29.50</ProductPrice>
  </Product>
</Volusion>`

test("Volusion XML maps to the trusted VibeCart catalog contract", () => {
  const catalog = convertVolusionXml(sample)
  assert.deepEqual(catalog.products, [
    {
      id: "RAD-001",
      name: "Radiantz Test Strip",
      description: "Flexible LED strip",
      priceCents: 5995,
      image: "https://example.com/rad-001.jpg",
    },
    {
      id: "RAD-002",
      name: "Radiantz Test Module",
      description: "",
      priceCents: 2950,
      image: "",
    },
  ])
})

test("real Generic Products plural rows exclude hidden products", () => {
  const xml = `<xmldata>
    <Products><HideProduct>Y</HideProduct><ProductCode>OLD-1</ProductCode><ProductName>Hidden old item</ProductName><ProductPrice>99.00</ProductPrice></Products>
    <Products><ProductCode>LIVE-1</ProductCode><ProductName>Visible item</ProductName><ProductPrice>37.42</ProductPrice></Products>
  </xmldata>`
  assert.deepEqual(inspectVolusionXml(xml), { sourceRows: 2, hiddenRows: 1 })
  assert.deepEqual(convertVolusionXml(xml).products, [{
    id: "LIVE-1",
    name: "Visible item",
    description: "",
    priceCents: 3742,
    image: "",
  }])
})

test("sale price is used only when it is positive", () => {
  const xml = `<root><Product><ProductCode>A</ProductCode><ProductName>A</ProductName><ProductPrice>10.00</ProductPrice><SalePrice>0</SalePrice></Product></root>`
  assert.equal(convertVolusionXml(xml).products[0].priceCents, 1000)
})

test("duplicate Volusion rows do not create duplicate VibeCart IDs", () => {
  const row = `<Product><ProductCode>A</ProductCode><ProductName>A</ProductName><ProductPrice>10.00</ProductPrice></Product>`
  assert.equal(convertVolusionXml(`<root>${row}${row}</root>`).products.length, 1)
})

test("invalid or missing prices fail closed", () => {
  const bad = `<root><Product><ProductCode>A</ProductCode><ProductName>A</ProductName><ProductPrice>free</ProductPrice></Product></root>`
  assert.throws(() => convertVolusionXml(bad), /Invalid ProductPrice/)
})

test("live Volusion source requires HTTPS and refuses redirects", async () => {
  await assert.rejects(() => fetchVolusionXml("http://example.com/products"), /must use HTTPS/)

  let options
  const xml = await fetchVolusionXml("https://example.com/products", async (_url, init) => {
    options = init
    return new Response(sample, { status: 200, headers: { "content-type": "text/xml" } })
  })
  assert.equal(xml, sample)
  assert.equal(options.redirect, "error")
})

test("live Volusion source fails closed on upstream errors", async () => {
  await assert.rejects(
    () => fetchVolusionXml("https://example.com/products", async () => new Response("denied", { status: 401 })),
    /HTTP 401/,
  )
})
