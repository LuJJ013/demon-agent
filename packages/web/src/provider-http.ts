/**
 * Shared HTTP helpers for search providers: bounded body reads, safe error
 * detail extraction, and small JSON predicates.
 *
 * @module @micro-harness/web/provider-http
 */

import { WebError } from './index.ts'

/** Read a bounded response body, rejecting oversized payloads mid-stream. */
export async function readLimited(
  response: Response,
  maxBytes: number,
  providerId: string,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new WebError(
      'WEB_TOO_LARGE',
      `search provider "${providerId}" response is ${declared} bytes, over the ${maxBytes}-byte limit`,
    )
  }

  const reader = response.body?.getReader()
  if (reader === undefined) return ''

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new WebError(
        'WEB_TOO_LARGE',
        `search provider "${providerId}" response exceeded the ${maxBytes}-byte limit`,
      )
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Extract a short provider error message. Supports both OpenAI-style
 * `{ error: { message } }` and Exa-style `{ error, tag }` envelopes without
 * leaking headers or credentials.
 */
export async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text()
    if (text === '') return undefined
    const payload: unknown = JSON.parse(text)
    if (isRecord(payload)) {
      const error = payload.error
      if (typeof error === 'string') {
        const tag = typeof payload.tag === 'string' ? ` (${payload.tag})` : ''
        return truncate(`${error}${tag}`, 300)
      }
      if (isRecord(error) && typeof error.message === 'string') {
        return truncate(error.message, 300)
      }
    }
    return truncate(text, 300)
  } catch {
    return undefined
  }
}

/** Narrow unknown JSON to a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep error text short enough for a model-facing message. */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}
