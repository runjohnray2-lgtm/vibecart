import { randomUUID } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { cloudDeliveryRequested, forwardStoredOrderEvent, type CloudForwardResult } from "@/lib/cloud-events"
import { getStoredOrder } from "@/lib/order-store"

const MAX_OUTBOX_ATTEMPTS = 12
const LEASE_SECONDS = 120
const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
]

type CloudOutboxStatus = "pending" | "processing" | "delivered" | "dead_letter"

type CloudOutboxRow = {
  id: string
  order_id: string
  merchant_id: string
  event_id: string
  event_type: "checkout.session.completed" | "checkout.session.async_payment_succeeded"
  event_created_at: string | Date
  status: CloudOutboxStatus
  attempt_count: number
  next_attempt_at: string | Date
  lease_token: string | null
  lease_until: string | Date | null
  last_attempt_at: string | Date | null
  delivered_at: string | Date | null
  last_status_code: number | null
  last_error: string
  created_at: string | Date
  updated_at: string | Date
}

export interface CloudOutboxDrainResult {
  claimed: number
  delivered: number
  deferred: number
  deadLettered: number
  skipped: boolean
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("VibeCart order storage is not configured")
  return value
}

function sql() {
  return neon(databaseUrl())
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function retryDelayMs(attemptCount: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount, 0), RETRY_DELAYS_MS.length - 1)]
}

async function claimOutboxForOrder(orderId: string): Promise<CloudOutboxRow | null> {
  if (!cloudDeliveryRequested()) return null
  const rows = await sql()`
    UPDATE vibecart_cloud_outbox
    SET status = 'processing',
        lease_token = ${randomUUID()},
        lease_until = now() + (${LEASE_SECONDS} * interval '1 second'),
        last_attempt_at = now(),
        updated_at = now()
    WHERE order_id = ${orderId}
      AND status = 'pending'
      AND next_attempt_at <= now()
    RETURNING *
  `
  return rows[0] as CloudOutboxRow | undefined ?? null
}

async function claimDueOutbox(limit: number): Promise<CloudOutboxRow[]> {
  if (!cloudDeliveryRequested()) return []
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 10
  const rows = await sql()`
    WITH due AS (
      SELECT id
      FROM vibecart_cloud_outbox
      WHERE (
          status = 'pending'
          OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= now())
        )
        AND next_attempt_at <= now()
        AND attempt_count < ${MAX_OUTBOX_ATTEMPTS}
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vibecart_cloud_outbox AS outbox
    SET status = 'processing',
        lease_token = ${randomUUID()},
        lease_until = now() + (${LEASE_SECONDS} * interval '1 second'),
        last_attempt_at = now(),
        updated_at = now()
    FROM due
    WHERE outbox.id = due.id
    RETURNING outbox.*
  `
  return rows as CloudOutboxRow[]
}

async function markDelivered(row: CloudOutboxRow, result: CloudForwardResult) {
  await sql()`
    UPDATE vibecart_cloud_outbox
    SET status = 'delivered',
        attempt_count = ${row.attempt_count + 1},
        lease_until = NULL,
        lease_token = NULL,
        delivered_at = now(),
        last_status_code = ${result.status ?? null},
        last_error = '',
        updated_at = now()
    WHERE id = ${row.id} AND status = 'processing'
      AND lease_token = ${row.lease_token}
  `
}

async function markFailed(row: CloudOutboxRow, result: CloudForwardResult | null, fallbackReason: string) {
  const nextAttemptCount = row.attempt_count + 1
  const deadLetter = nextAttemptCount >= MAX_OUTBOX_ATTEMPTS
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(nextAttemptCount)).toISOString()
  const reason = (result?.reason ?? fallbackReason).slice(0, 200)

  await sql()`
    UPDATE vibecart_cloud_outbox
    SET status = ${deadLetter ? "dead_letter" : "pending"},
        attempt_count = ${nextAttemptCount},
        next_attempt_at = ${nextAttemptAt},
        lease_until = NULL,
        lease_token = NULL,
        last_status_code = ${result?.status ?? null},
        last_error = ${reason},
        updated_at = now()
    WHERE id = ${row.id} AND status = 'processing'
      AND lease_token = ${row.lease_token}
  `
  return deadLetter
}

async function processClaimed(row: CloudOutboxRow): Promise<{ delivered: boolean; deadLettered: boolean }> {
  try {
    const order = await getStoredOrder(row.order_id)
    if (!order || order.merchantId !== row.merchant_id) {
      const deadLettered = await markFailed(row, null, "durable_order_missing_or_mismatched")
      return { delivered: false, deadLettered }
    }

    const result = await forwardStoredOrderEvent({
      eventId: row.event_id,
      eventType: row.event_type,
      eventCreatedAt: iso(row.event_created_at),
      order,
    })

    if (result.delivered) {
      await markDelivered(row, result)
      return { delivered: true, deadLettered: false }
    }

    const deadLettered = await markFailed(row, result, "cloud_not_delivered")
    return { delivered: false, deadLettered }
  } catch (error) {
    console.warn(
      `[vibecart outbox] Delivery attempt failed for ${row.id}`,
      error instanceof Error ? error.message : "unknown"
    )
    const deadLettered = await markFailed(row, null, "outbox_delivery_exception")
    return { delivered: false, deadLettered }
  }
}

export async function attemptCloudOutboxForOrder(orderId: string): Promise<CloudForwardResult | null> {
  const row = await claimOutboxForOrder(orderId)
  if (!row) return null

  const order = await getStoredOrder(row.order_id)
  if (!order || order.merchantId !== row.merchant_id) {
    await markFailed(row, null, "durable_order_missing_or_mismatched")
    return { configured: true, delivered: false, retryable: true, reason: "cloud_rejected" }
  }

  let result: CloudForwardResult
  try {
    result = await forwardStoredOrderEvent({
      eventId: row.event_id,
      eventType: row.event_type,
      eventCreatedAt: iso(row.event_created_at),
      order,
    })
  } catch (error) {
    console.warn(
      `[vibecart outbox] Immediate Cloud delivery failed for ${row.id}`,
      error instanceof Error ? error.message : "unknown"
    )
    await markFailed(row, null, "outbox_delivery_exception")
    return { configured: true, delivered: false, retryable: true, reason: "network" }
  }

  if (result.delivered) await markDelivered(row, result)
  else await markFailed(row, result, "cloud_not_delivered")
  return result
}

export async function drainCloudOutbox(limit = 10): Promise<CloudOutboxDrainResult> {
  if (!cloudDeliveryRequested()) {
    return { claimed: 0, delivered: 0, deferred: 0, deadLettered: 0, skipped: true }
  }

  const rows = await claimDueOutbox(limit)
  let delivered = 0
  let deadLettered = 0

  for (const row of rows) {
    const result = await processClaimed(row)
    if (result.delivered) delivered += 1
    if (result.deadLettered) deadLettered += 1
  }

  return {
    claimed: rows.length,
    delivered,
    deferred: rows.length - delivered - deadLettered,
    deadLettered,
    skipped: false,
  }
}
