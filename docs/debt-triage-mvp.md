# Debt Triage AI — MVP

## Goal
Help a U.S. consumer understand a debt-collection notice quickly and identify the safest next step without pretending to be a law firm.

## Core user story
A user uploads or photographs a collection letter, debt-related email, credit-report collection screenshot, or court-related notice. The app extracts the key facts, identifies deadlines and risk signals, explains the situation in plain English, and gives the user a short action plan.

## MVP flow
1. Upload image/PDF/screenshot.
2. Extract collector, original creditor if shown, amount, account/reference number, dates, dispute deadline, court information, and contact information.
3. Classify the matter: VERIFY, DISPUTE, PAYMENT/SETTLEMENT OPTIONS, LAWSUIT/COURT, POSSIBLE SCAM, or UNKNOWN/NEEDS REVIEW.
4. Display a plain-English summary: what this is, what deadline matters, what information is missing, and what the user should consider doing next.
5. Preserve the uploaded document and extracted facts as evidence.
6. Generate an appropriate self-help document only when the situation supports it, such as a debt dispute/verification request or contact-preference letter.
7. Track follow-up documents, collector contacts, and deadlines in the same matter.

## Product differentiation
Do not compete as a generic budgeting app or simple dispute-letter generator. The product is a triage/orchestration layer: determine what situation the consumer is actually in before recommending a document or action.

## Federal rule baseline for MVP
- FDCPA / Regulation F validation notice requirements.
- 30-day validation/dispute period where applicable.
- Collector communication/call-frequency rules.
- Time-barred debt warning checks where data is sufficient.
- Basic collector identity / scam warning checks.

State-specific rules must be modular and separately verified before being surfaced as authoritative.

## Safety / legal boundary
- Educational/self-help software; not a law firm.
- Do not present AI output as a definitive legal conclusion.
- For lawsuits, unclear service/deadline questions, unusual state-law issues, or high-risk matters, clearly recommend licensed legal help and preserve the evidence packet for counsel.
- Do not automatically tell every user to dispute a debt.

## First screen promise
"Upload the notice. We’ll show you what it means, what deadline matters, and your next options."

## Initial classification output
- Matter type
- Risk level: LOW / MEDIUM / HIGH / URGENT
- Next deadline
- Amount claimed
- Collector
- Original creditor (if stated)
- What appears complete
- What appears missing or questionable
- Recommended next-step category
- Evidence checklist

## Monetization hypothesis
Free: one document scan, extraction, deadline detection, and plain-English explanation.

Paid: ongoing matter tracking, evidence vault, deadline reminders, correspondence generation, certified-mail integration, contact logging, follow-up analysis, and verified state rule packs.

Potential later revenue: carefully structured referrals to licensed consumer attorneys or nonprofit credit counseling where legally permitted and clearly disclosed.

## Validation metrics
- % of visitors who upload a document
- % who receive a confident classification
- % who save/create a matter
- % who generate a next-step document
- % who return with a collector response
- free-to-paid conversion
- attorney/counseling escalation rate
- false-positive / low-confidence rate

## Current market evidence
CFPB complaint reporting shows debt-not-owed and written-notification problems are major debt-collection complaint categories. Current competitors prove demand for digital debt-help tools, but simple scan-to-dispute-letter workflows already exist. The MVP should therefore win on triage, clarity, evidence organization, and action sequencing.
