/**
 * Offline tests for primary/fallback search routing.
 *
 * Run explicitly:
 *
 *   ./.local/node/bin/node --import tsx --test tests/web-search-router.spec.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSearchRouter, searchWithFallback, WebError } from '../packages/web/src/index.ts'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '../packages/web/src/index.ts'

const request: WebSearchRequest = { query: 'cordis', maxResults: 5 }

test('a retryable primary failure falls through to the fallback', async () => {
  const primary = fakeProvider('exa', () => {
    throw new WebError('WEB_SEARCH_FAILED', 'primary exploded', { retryable: true })
  })
  const fallback = fakeProvider('deepseek-official', () => result('https://example.com/fallback'))

  const value = await searchWithFallback([primary, fallback], request, signal(), {
    primary: 'exa',
    fallback: ['deepseek-official'],
  })

  assert.equal(value.provider, 'deepseek-official')
  assert.deepEqual(value.sources.map(source => source.url), ['https://example.com/fallback'])
})

test('an empty primary result falls through to the fallback', async () => {
  const primary = fakeProvider('exa', () => ({ sources: [] }))
  const fallback = fakeProvider('deepseek-official', () => result('https://example.com/fallback'))

  const value = await searchWithFallback([primary, fallback], request, signal(), {
    primary: 'exa',
    fallback: ['deepseek-official'],
  })

  assert.equal(value.provider, 'deepseek-official')
  assert.equal(value.sources.length, 1)
})

test('fallbackOnEmpty: false keeps an empty primary result', async () => {
  let fallbackCalls = 0
  const primary = fakeProvider('exa', () => ({ sources: [] }))
  const fallback = fakeProvider('deepseek-official', () => {
    fallbackCalls += 1
    return result('https://example.com/fallback')
  })

  const value = await searchWithFallback([primary, fallback], request, signal(), {
    primary: 'exa',
    fallback: ['deepseek-official'],
    fallbackOnEmpty: false,
  })

  assert.equal(value.provider, 'exa')
  assert.deepEqual(value.sources, [])
  assert.equal(fallbackCalls, 0)
})

test('policy failures never fall back', async () => {
  let fallbackCalls = 0
  const primary = fakeProvider('exa', () => {
    throw new WebError('WEB_BLOCKED_ADDRESS', 'blocked address')
  })
  const fallback = fakeProvider('deepseek-official', () => {
    fallbackCalls += 1
    return result('https://example.com/fallback')
  })

  await assert.rejects(
    searchWithFallback([primary, fallback], request, signal(), {
      primary: 'exa',
      fallback: ['deepseek-official'],
    }),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_BLOCKED_ADDRESS',
  )
  assert.equal(fallbackCalls, 0)
})

test('an unavailable primary falls through without being called', async () => {
  let primaryCalls = 0
  const primary = fakeProvider('exa', () => {
    primaryCalls += 1
    return result('https://example.com/primary')
  }, false)
  const fallback = fakeProvider('deepseek-official', () => result('https://example.com/fallback'))

  const value = await searchWithFallback([primary, fallback], request, signal(), {
    primary: 'exa',
    fallback: ['deepseek-official'],
  })

  assert.equal(value.provider, 'deepseek-official')
  assert.equal(primaryCalls, 0)
})

test('all providers unavailable is reported as such', async () => {
  const primary = fakeProvider('exa', () => result('https://example.com/a'), false)
  const fallback = fakeProvider('deepseek-official', () => result('https://example.com/b'), false)

  await assert.rejects(
    searchWithFallback([primary, fallback], request, signal(), {
      primary: 'exa',
      fallback: ['deepseek-official'],
    }),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_PROVIDER_UNAVAILABLE',
  )
})

test('the last retryable error surfaces when every provider fails', async () => {
  const primary = fakeProvider('exa', () => {
    throw new WebError('WEB_SEARCH_FAILED', 'exa down', { retryable: true })
  })
  const fallback = fakeProvider('deepseek-official', () => {
    throw new WebError('WEB_PROVIDER_QUOTA', 'deepseek out of credits')
  })

  await assert.rejects(
    searchWithFallback([primary, fallback], request, signal(), {
      primary: 'exa',
      fallback: ['deepseek-official'],
    }),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_PROVIDER_QUOTA',
  )
})

test('the router is itself a provider that applies the configured order', async () => {
  const primary = fakeProvider('exa', () => result('https://example.com/primary'))
  const fallback = fakeProvider('deepseek-official', () => result('https://example.com/fallback'))
  const router = createSearchRouter([primary, fallback], {
    primary: 'exa',
    fallback: ['deepseek-official'],
  })

  assert.equal(router.available(), true)
  const value = await router.search(request, signal())
  assert.equal(value.provider, 'exa')
})

test('a single available provider is auto-selected', async () => {
  const only = fakeProvider('exa', () => result('https://example.com/only'))

  const value = await searchWithFallback([only], request, signal())
  assert.equal(value.provider, 'exa')
})

test('multiple available providers without configuration are ambiguous', async () => {
  const exa = fakeProvider('exa', () => result('https://example.com/exa'))
  const deepseek = fakeProvider('deepseek-official', () => result('https://example.com/deepseek'))

  await assert.rejects(
    searchWithFallback([exa, deepseek], request, signal()),
    (error: unknown) => error instanceof WebError && error.code === 'WEB_PROVIDER_AMBIGUOUS',
  )
})

/** Build a provider with controllable behavior and availability. */
function fakeProvider(
  id: string,
  search: (request: WebSearchRequest, signal: AbortSignal) => Promise<WebSearchResult> | WebSearchResult,
  available = true,
): WebSearchProvider {
  return {
    id,
    available: () => available,
    search: async (input, signal) => search(input, signal),
  }
}

/** One-source result for `url`. */
function result(url: string): WebSearchResult {
  return { sources: [{ title: 'Example', url }] }
}

/** A fresh, non-aborted signal. */
function signal(): AbortSignal {
  return AbortSignal.timeout(5_000)
}
