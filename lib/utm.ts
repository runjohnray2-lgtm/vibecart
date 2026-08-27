export interface UtmParameters {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  term?: string | null
  content?: string | null
}

function clean(value: string | null | undefined, maxLength = 200): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

export function withUtmParameters(destinationUrl: string, params: UtmParameters): string {
  const url = new URL(destinationUrl)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Destination must use http or https")
  }

  const values: Array<[string, string | null]> = [
    ["utm_source", clean(params.source)],
    ["utm_medium", clean(params.medium)],
    ["utm_campaign", clean(params.campaign)],
    ["utm_term", clean(params.term)],
    ["utm_content", clean(params.content)],
  ]

  for (const [key, value] of values) {
    if (value) url.searchParams.set(key, value)
  }

  return url.toString()
}
