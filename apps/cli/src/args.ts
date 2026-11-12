/**
 * Command-line surface for `mh`.
 *
 * @module @micro-harness/cli/args
 */

import type { ContentBlock } from '@micro-harness/core/llm'
import { createSearchRouter } from '@micro-harness/web'
import { DeepSeekSearchProvider } from '@micro-harness/web/search-deepseek'
import { ExaSearchProvider } from '@micro-harness/web/search-exa'
import type { ExaSearchType } from '@micro-harness/web/search-exa'
import { createWebSearchTool } from '@micro-harness/web/tools'
import type { WebSearchArgs } from '@micro-harness/web/tools'

/** One-shot direct web search. */
export interface WebSearchInvocation {
  readonly command: 'web-search'
  readonly query: string
  readonly maxResults?: number
}

/** Agent invocation; boot is not implemented yet. */
export interface AgentInvocation {
  readonly command: 'agent'
  /** Profile name. Defaults to `minimal`. */
  readonly profile: string
  /** Extra patch files applied after the profile. */
  readonly patches: readonly string[]
  /** One-shot task, when present. */
  readonly task: string | undefined
}

/** Print usage without touching the network. */
export interface HelpInvocation {
  readonly command: 'help'
}

/** Parsed invocation. */
export type Invocation = WebSearchInvocation | AgentInvocation | HelpInvocation

const USAGE = `Usage:
  mh web-search <query> [--max-results N]
  mh [--profile NAME] [--patch FILE] <task>
  mh --help

web-search environment:
  EXA_API_KEY             primary search provider key
  EXA_BASE_URL            defaults to https://api.exa.ai
  EXA_SEARCH_TYPE         defaults to auto
  DEEPSEEK_API_KEY        fallback search provider key
  WEB_SEARCH_PRIMARY      defaults to exa
  WEB_SEARCH_FALLBACK     defaults to deepseek-official
  WEB_SEARCH_BASE_URL     DeepSeek base URL, defaults to https://api.deepseek.com
  WEB_SEARCH_PATH         DeepSeek search path, defaults to /v1/tools/search
  WEB_SEARCH_API_KEY_ENV  DeepSeek key env, defaults to DEEPSEEK_API_KEY
  WEB_SEARCH_TIMEOUT_MS   overrides both providers' timeouts
`

/**
 * Parse the command line. The first positional selects the subcommand.
 * @param argv - arguments after the executable name.
 * @returns the normalized invocation.
 */
export function parseArgs(argv: readonly string[]): Invocation {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { command: 'help' }
  }
  if (command === 'web-search') return parseWebSearch(rest)
  return parseAgent(argv)
}

/**
 * Boot the selected profile and run one task.
 * @param argv - arguments after the executable name.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
  const invocation = parseArgs(argv)
  switch (invocation.command) {
    case 'help':
      process.stdout.write(USAGE)
      return
    case 'agent':
      throw new Error(
        'agent boot is not implemented yet (P1–P5); use `mh web-search <query>` to exercise the tool',
      )
    case 'web-search':
      await runWebSearch(invocation)
      return
  }
}

/** Parse `web-search <query> [--max-results N]`. */
function parseWebSearch(argv: readonly string[]): WebSearchInvocation {
  let query: string | undefined
  let maxResults: number | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (arg === '--max-results') {
      const raw = argv[index + 1]
      if (raw === undefined) throw new Error('--max-results requires a value')
      maxResults = Number(raw)
      if (!Number.isInteger(maxResults) || maxResults < 1) {
        throw new Error(`--max-results must be a positive integer, got ${raw}`)
      }
      index += 1
      continue
    }
    if (arg.startsWith('-')) throw new Error(`unknown option for web-search: ${arg}`)
    if (query !== undefined) throw new Error('web-search accepts exactly one query')
    query = arg
  }

  if (query === undefined) throw new Error('usage: mh web-search <query> [--max-results N]')
  return maxResults === undefined
    ? { command: 'web-search', query }
    : { command: 'web-search', query, maxResults }
}

/** Parse `[--profile NAME] [--patch FILE] <task>`. */
function parseAgent(argv: readonly string[]): AgentInvocation {
  let profile = 'minimal'
  const patches: string[] = []
  let task: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--profile requires a value')
      profile = value
      index += 1
      continue
    }
    if (arg === '--patch') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--patch requires a value')
      patches.push(value)
      index += 1
      continue
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`)
    if (task !== undefined) throw new Error('agent invocation accepts exactly one task')
    task = arg
  }

  return { command: 'agent', profile, patches, task }
}

/** Run one search through the Exa → DeepSeek route and print it. */
async function runWebSearch(invocation: WebSearchInvocation): Promise<void> {
  const timeoutMs = optionalTimeout('WEB_SEARCH_TIMEOUT_MS')
  const provider = createSearchRouter(
    [buildExaProvider(timeoutMs), buildDeepSeekProvider(timeoutMs)],
    {
      primary: process.env.WEB_SEARCH_PRIMARY ?? 'exa',
      fallback: parseList(process.env.WEB_SEARCH_FALLBACK) ?? ['deepseek-official'],
      fallbackOnEmpty: true,
    },
  )
  const tool = createWebSearchTool({
    provider,
    ...(invocation.maxResults === undefined ? {} : { maxResults: invocation.maxResults }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  const args: WebSearchArgs = {
    query: invocation.query,
    ...(invocation.maxResults === undefined ? {} : { maxResults: invocation.maxResults }),
  }

  const value = await tool.execute(args, {
    callId: 'cli-web-search',
    signal: AbortSignal.timeout(timeoutMs ?? 90_000),
  })
  process.stdout.write(renderBlocks(tool.output.render(args, value)))
}

/** Build the primary Exa provider from environment variables. */
function buildExaProvider(timeoutMs: number | undefined): ExaSearchProvider {
  const type = parseExaType(process.env.EXA_SEARCH_TYPE)
  return new ExaSearchProvider({
    ...(process.env.EXA_BASE_URL === undefined ? {} : { baseURL: process.env.EXA_BASE_URL }),
    ...(type === undefined ? {} : { type }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
}

/** Build the fallback DeepSeek provider from environment variables. */
function buildDeepSeekProvider(timeoutMs: number | undefined): DeepSeekSearchProvider {
  return new DeepSeekSearchProvider({
    baseURL: process.env.WEB_SEARCH_BASE_URL ?? process.env.DEEPSEEK_BASE_URL
      ?? 'https://api.deepseek.com',
    ...(process.env.WEB_SEARCH_PATH === undefined ? {} : { path: process.env.WEB_SEARCH_PATH }),
    ...(process.env.WEB_SEARCH_API_KEY_ENV === undefined
      ? {}
      : { apiKeyEnv: process.env.WEB_SEARCH_API_KEY_ENV }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
}

/**
 * Parse a comma-separated list. An unset variable yields `undefined` so the
 * caller's default applies; an explicitly empty value yields `[]` (disable).
 */
function parseList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  return raw.split(',').map(value => value.trim()).filter(value => value !== '')
}

/** Narrow the `EXA_SEARCH_TYPE` override, leaving the provider default when unknown. */
function parseExaType(raw: string | undefined): ExaSearchType | undefined {
  switch (raw?.trim()) {
    case 'auto':
    case 'lite':
    case 'deep-lite':
    case 'deep':
    case 'fast':
    case 'instant':
    case 'deep-reasoning':
      return raw.trim() as ExaSearchType
    default:
      return undefined
  }
}

/** Read a positive numeric environment override, or `undefined` when unset. */
function optionalTimeout(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

/** Flatten model-facing text blocks into the CLI's stdout representation. */
function renderBlocks(blocks: readonly ContentBlock[]): string {
  return `${blocks.map(block => block.type === 'text' ? block.text : '').join('\n')}\n`
}
