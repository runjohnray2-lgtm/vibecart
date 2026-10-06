type BusinessQuestionContext = {
  workspace:{id:string;name:string}
  question:string
  customers:unknown[]
  rules:unknown[]
  memories:unknown[]
  imports:unknown[]
  customerCount:number
}

export type BusinessAnswer = {
  answer:string
  known:string[]
  unknown:string[]
  evidence:string[]
  model:string | null
  usage:{inputTokens:number;outputTokens:number;estimatedCostUsd:number} | null
}

const MODEL = process.env.BUSINESS_BRAIN_MODEL || "gpt-6-luna"
const MAX_OUTPUT_TOKENS = 500
const MAX_CONTEXT_CHARS = 18000
const MAX_ESTIMATED_COST_USD = 0.02

function contextText(context:BusinessQuestionContext) {
  return JSON.stringify({
    business:context.workspace.name,
    customerCount:context.customerCount,
    matchingCustomers:context.customers,
    activeRules:context.rules,
    memories:context.memories,
    recentImports:context.imports,
  }).slice(0,MAX_CONTEXT_CHARS)
}

function outputText(data:any) {
  if (typeof data?.output_text === "string") return data.output_text.trim()
  const parts = Array.isArray(data?.output) ? data.output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[]) : []
  return parts.filter((part:any)=>part?.type === "output_text" && typeof part.text === "string").map((part:any)=>part.text).join("\n").trim()
}

function estimateCost(model:string,inputTokens:number,outputTokens:number) {
  // Standard short-context prices per 1M tokens. Conservative fallback stays under the per-call guard.
  const rates:Record<string,[number,number]> = {"gpt-6-luna":[0.05,0.25]}
  const [inputRate,outputRate] = rates[model] || [1,5]
  return (inputTokens*inputRate + outputTokens*outputRate)/1_000_000
}

export async function answerBusinessQuestion(context:BusinessQuestionContext):Promise<BusinessAnswer> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error("Business Brain AI is not configured yet. Add OPENAI_API_KEY to the Vercel project.")
  const grounding = contextText(context)
  const estimatedMax = estimateCost(MODEL,Math.ceil(grounding.length/3)+500,MAX_OUTPUT_TOKENS)
  if (estimatedMax > MAX_ESTIMATED_COST_USD) throw new Error("Business Brain cost guard blocked this request.")

  const instructions = [
    "You are Business Brain for one company.",
    "Answer only from the supplied BUSINESS DATA. Do not invent facts.",
    "Permanent business rules are mandatory constraints.",
    "If the data does not answer part of the question, say what is unknown.",
    "Keep the answer concise and operational.",
    "End with exactly two short sections: Known: and Unknown:.",
  ].join(" ")

  const res = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"authorization":`Bearer ${key}`,"content-type":"application/json"},
    body:JSON.stringify({
      model:MODEL,
      instructions,
      input:`QUESTION:\n${context.question}\n\nBUSINESS DATA:\n${grounding}`,
      max_output_tokens:MAX_OUTPUT_TOKENS,
      store:false,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(String(data?.error?.message || "AI provider request failed"))
  const answer = outputText(data)
  if (!answer) throw new Error("AI provider returned no answer")
  const inputTokens = Number(data?.usage?.input_tokens || 0)
  const outputTokens = Number(data?.usage?.output_tokens || 0)
  const estimatedCostUsd = estimateCost(MODEL,inputTokens,outputTokens)
  return {
    answer,
    known:[`${context.customerCount} customers stored`,`${context.rules.length} active rules retrieved`,`${context.memories.length} memories retrieved`,`${context.customers.length} matching customers retrieved`],
    unknown:context.customers.length ? [] : ["No customer rows matched the question terms."],
    evidence:[...context.rules.slice(0,5).map((r:any)=>`Rule: ${r.rule_text}`),...context.memories.slice(0,5).map((m:any)=>`Memory: ${m.content}`)],
    model:MODEL,
    usage:{inputTokens,outputTokens,estimatedCostUsd},
  }
}
