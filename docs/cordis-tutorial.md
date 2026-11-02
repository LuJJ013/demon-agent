# Cordis 教程：构建持续并发的抓取 Agent

本文用一个可以运行的例子讲 Cordis 的核心机制：Context、插件、服务、依赖注入、事件和生命周期。

场景是一个持续运行的抓取 agent：

- 维护待抓 URL 队列，自动去重；
- 以受控并发抓取页面，而不是对所有 URL 直接 `Promise.all`；
- 把抓到的页面以事件分发给索引器；
- 定时补充任务，失败按退避重试；
- 插件卸载时停止定时器、清空队列并中止在途请求。

最终结构很小：

```text
main.ts
└── plugins/
    ├── fetcher.ts    # ctx.fetcher：一次 HTTP 抓取
    ├── crawler.ts    # ctx.crawler：队列、并发、调度、重试
    └── indexer.ts    # 监听 crawler/page，保存或建索引
```

依赖关系如下：

```text
Timer ──每 intervalMs──▶ Crawler.pump()
                              │  取队列，受 concurrency 限制
                              ▼
                        Fetcher.fetch()
                              │  HTML
                              ▼
                 ctx.parallel('crawler/page')
                              │
                              ▼
                          Indexer
```

> **版本说明**：示例以本仓库锁定的 `@deepseek-ai/cordis@~4.0.5` 和
> `@deepseek-ai/cordis-plugin-timer@~1.1.7` 为准。上游发行版叫 `cordis`，核心 API
> 一致；如果项目使用上游包，去掉 import 里的 `@deepseek-ai/` 前缀即可。
> 示例用 Node 24 和 `tsx` 直接运行。

## 准备

```bash
pnpm add @deepseek-ai/cordis @deepseek-ai/cordis-plugin-timer

# 第 7 节的配置化装载还需要
pnpm add @deepseek-ai/cordis-plugin-loader @deepseek-ai/cordis-plugin-include
```

完成第 6 节后，用下面的命令运行：

```bash
node --import tsx main.ts
```

入口文件按 ESM 运行，项目的 `package.json` 需要设置 `"type": "module"`。

## 1. Context 与插件

```ts
import { Context, Logger, type Message } from '@deepseek-ai/cordis'

const root = new Context()

const exporter = {
  colors: false,
  export: (message: Message) => {
    console.log(`[${message.name}]`, Logger.format(exporter, message))
  },
}
root.logger.exporter(exporter)

await root.plugin((ctx) => {
  ctx.logger.info('crawler agent started')
})
```

`new Context()` 创建根容器。`root.plugin(fn)` 在根上下文下创建一个子上下文并运行插件，返回一个
`Fiber`；`await` 会等到插件启动完成。插件内部注册的服务、事件监听、定时器和 `effect` 都归属于这个
Fiber，之后调用 `fiber.dispose()` 会一并撤销。

Cordis 的 logger 默认只写入内存缓冲区，所以示例先注册一个 exporter 把日志送到控制台。实际项目可以
换成文件、OTel 或任意日志后端。

## 2. Service：把抓取能力做成可替换的服务

```ts
// plugins/fetcher.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fetcher: Fetcher
  }
}

export interface Config {
  timeoutMs?: number
  userAgent?: string
}

export class Fetcher extends Service {
  private timeoutMs: number
  private userAgent: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'fetcher')
    this.timeoutMs = config.timeoutMs ?? 15_000
    this.userAgent = config.userAgent ?? 'crawler-agent/0.1'
  }

  async fetch(url: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      headers: { 'user-agent': this.userAgent },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    return response.text()
  }
}

export default Fetcher
```

`declare module` 把 `ctx.fetcher` 加入类型系统，消费者无需再做类型断言。构造函数里的
`super(ctx, 'fetcher')` 会立即注册服务；服务随所属 Fiber 卸载自动移除，不需要手写反注册。

`fetch` 把调用方的取消信号与超时信号合并：调用方中止、或超过 `timeoutMs`，底层请求都会终止。

服务类本身就是插件，可以直接挂载并传入配置：

```ts
await root.plugin(Fetcher, { timeoutMs: 5_000 })
```

配置是**每个 Fiber 独立**的。同一个 `Fetcher` 类可以在不同上下文里挂载多次，各自使用不同的超时和
User-Agent。

## 3. inject：消费者只声明依赖

```ts
// plugins/probe.ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'probe'
export const inject = ['fetcher']

export function apply(ctx: Context) {
  ctx.effect(() => {
    const controller = new AbortController()

    void ctx.fetcher
      .fetch('https://example.com', controller.signal)
      .then(html => ctx.logger.info('fetched %d chars', html.length))
      .catch(error => ctx.logger.warn(error))

    return () => controller.abort()
  }, 'probe.request')
}
```

`inject` 声明这个插件必须先拿到 `fetcher`。如果先挂载 `probe`、后挂载 `Fetcher`，`probe` 会停留在
`PENDING` 状态；`fetcher` 出现后自动启动。提供 `fetcher` 的 Fiber 被卸载时，依赖它的插件也会先卸载，
等服务重新出现后再启动。这就是 Cordis 的热插拔基础。

`ctx.effect()` 注册的是“启动时执行、卸载时清理”的逻辑。这里把一个 `AbortController` 和一次请求绑定
到插件生命周期：插件卸载时请求被取消，不会留下悬挂的网络操作。

注意 `crawler.ts` 里的 `import type {} from './fetcher.ts'`：它只加载 `fetcher.ts` 的模块类型声明，
不产生运行时依赖，但能让 TypeScript 看到 `ctx.fetcher`。

## 4. Events：把抓取结果分发给消费者

先声明事件类型：

```ts
// plugins/crawler.ts（类型声明部分）
export interface Page {
  url: string
  html: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'crawler/page'(page: Page): void | Promise<void>
  }
}
```

索引器只关心“页面到了”：

```ts
// plugins/indexer.ts
import type { Context } from '@deepseek-ai/cordis'
import type { Page } from './crawler.ts'

export const name = 'indexer'

export function apply(ctx: Context) {
  const pages = new Map<string, Page>()

  ctx.on('crawler/page', async (page) => {
    pages.set(page.url, page)
    ctx.logger.info('indexed %s (%d bytes, total %d)', page.url, page.html.length, pages.size)
  })
}
```

`ctx.on` 注册的监听器同样归属于当前 Fiber，插件卸载时自动移除。Cordis 提供几种派发方式：

| 方法 | 行为 | 适用场景 |
| --- | --- | --- |
| `ctx.emit(name, ...)` | 同步调用监听器，不等待返回的 Promise | 通知、指标上报 |
| `ctx.parallel(name, ...)` | 并发运行所有监听器并等待全部结束 | 等所有消费者处理完再继续 |
| `ctx.serial(name, ...)` | 按顺序逐个等待 | 有先后依赖的流水线 |
| `ctx.bail(name, ...)` | 同步运行，遇到第一个“拦截值”停止 | 审批、短路 |
| `ctx.waterfall(name, ..., next)` | 用 `next` 串成中间件链 | 改写参数或结果 |

抓取器使用 `ctx.parallel`：

```ts
await ctx.parallel('crawler/page', page)
```

这样 `crawl` 会等到索引完成后再解析链接，形成自然的背压；如果某个索引器抛错，`parallel` 会以
`AggregateError` 拒绝，调用方可以统一处理。

## 5. Crawler：并发、去重与持续调度

```ts
// plugins/crawler.ts
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from './fetcher.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    crawler: Crawler
  }

  interface Events {
    'crawler/page'(page: Page): void | Promise<void>
  }
}

export interface Page {
  url: string
  html: string
}

export interface Config {
  concurrency?: number
  intervalMs?: number
  maxQueue?: number
  maxAttempts?: number
}

export class Crawler extends Service {
  static inject = ['fetcher', 'timer']

  private queue: string[] = []
  private seen = new Set<string>()
  private attempts = new Map<string, number>()
  private inflight = new Set<AbortController>()
  private active = 0
  private stopped = false
  private readonly concurrency: number
  private readonly intervalMs: number
  private readonly maxQueue: number
  private readonly maxAttempts: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'crawler')
    this.concurrency = Math.max(1, config.concurrency ?? 16)
    this.intervalMs = Math.max(100, config.intervalMs ?? 1000)
    this.maxQueue = Math.max(this.concurrency, config.maxQueue ?? 10_000)
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 3)

    ctx.effect(() => () => {
      this.stopped = true
      this.queue.length = 0
      for (const controller of this.inflight) controller.abort()
      this.inflight.clear()
    }, 'crawler.lifecycle')

    ctx.interval(() => this.pump(), this.intervalMs)
  }

  add(urls: string | string[]): void {
    for (const url of typeof urls === 'string' ? [urls] : urls) {
      if (this.seen.has(url) || this.queue.length >= this.maxQueue) continue
      this.seen.add(url)
      this.queue.push(url)
    }
  }

  private pump(): void {
    while (!this.stopped && this.active < this.concurrency && this.queue.length) {
      const url = this.queue.shift()!
      this.active++
      void this.crawl(url).finally(() => {
        this.active--
        if (this.queue.length) this.pump()
      })
    }
  }

  private async crawl(url: string): Promise<void> {
    const controller = new AbortController()
    this.inflight.add(controller)
    try {
      const html = await this.ctx.fetcher.fetch(url, controller.signal)
      if (this.stopped) return

      await this.ctx
        .parallel('crawler/page', { url, html })
        .catch(error => this.ctx.logger.error(error))

      this.add(extractLinks(html, url))
    } catch (error) {
      if (!this.stopped) this.retry(url, error)
    } finally {
      this.inflight.delete(controller)
    }
  }

  private retry(url: string, error: unknown): void {
    const attempts = (this.attempts.get(url) ?? 0) + 1
    this.attempts.set(url, attempts)
    if (attempts >= this.maxAttempts) {
      this.ctx.logger.warn('giving up on %s: %s', url, error)
      return
    }
    this.ctx.timeout(() => {
      if (this.stopped) return
      this.queue.push(url)
      this.pump()
    }, 500 * 2 ** attempts)
  }
}

function extractLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin
  const links = [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => {
      const href = match[1]
      if (!href) return undefined
      try {
        return new URL(href, base).href
      } catch {
        return undefined
      }
    })
    .filter((url): url is string => Boolean(url?.startsWith(origin)))
  return [...new Set(links)]
}

export default Crawler
```

几个关键点：

- `static inject = ['fetcher', 'timer']`：抓取器依赖 HTTP 服务和定时器服务。缺少任何一个时插件不会
  启动，也不会在构造函数里访问到 `undefined`。
- `add` 负责去重和队列上限；`seen` 是内存集合，长期运行时需要加 TTL 或换成持久化去重结构。
- `pump` 是 worker pool 的全部逻辑：只要 `active < concurrency` 且队列非空，就取一个 URL 启动任务。
  没有 `Promise.all(queue.map(...))`，因此连接数和内存都有上界。
- `crawl` 为每个请求创建 `AbortController` 并放进 `inflight`；`ctx.effect` 的清理函数在插件卸载时统一
  `abort()`，在途请求不会拖住进程。
- `retry` 通过 `ctx.timeout` 做指数退避。这个定时器同样属于当前 Fiber，插件卸载后不会再触发。
- 消费者失败只记日志，不重新抓取页面；抓取失败才进入重试。
- `ctx.interval` 来自 timer 插件，负责持续从队列拉取任务；它也会随 Fiber 自动清理。

## 6. 组装

```ts
// main.ts
import { Context, Logger, type Message } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import Fetcher from './plugins/fetcher.ts'
import Crawler from './plugins/crawler.ts'
import * as indexer from './plugins/indexer.ts'

const root = new Context()
root.baseUrl = import.meta.url

const exporter = {
  colors: false,
  export: (message: Message) => {
    console.log(`[${message.name}]`, Logger.format(exporter, message))
  },
}
root.logger.exporter(exporter)

await root.plugin(Timer)
await root.plugin(Fetcher, { timeoutMs: 20_000 })
await root.plugin(indexer)

const crawler = await root.plugin(Crawler, {
  concurrency: 32,
  intervalMs: 500,
})

root.crawler.add(['https://example.com/'])

process.once('SIGINT', () => void crawler.dispose())
process.once('SIGTERM', () => void crawler.dispose())
```

启动顺序是 Timer → Fetcher → indexer → Crawler。顺序并非强制：如果先挂载 Crawler，它会因为缺少
依赖而等待。但让索引器先就绪可以避免第一页抓完时还没有消费者。

`await root.plugin(...)` 返回 Fiber，而不是服务实例；服务通过 `root.crawler` 访问。根上下文没有
`inject` 限制，因此入口文件可以直接取用服务。

收到 `SIGINT` 或 `SIGTERM` 时，只销毁 Crawler Fiber。清理函数会停止定时器、清空队列并中止在途请求；
没有其他活动句柄后，Node 会自然退出。

## 7. 配置化装载

当插件多起来之后，把组合写进 YAML 比在入口文件里逐个 `plugin()` 更容易维护。Cordis 的
`loader` + `include` 可以完成这件事：

```ts
// main.ts（改用配置文件）
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'

const root = new Context()
root.baseUrl = import.meta.url

await root.plugin(Loader)
await root.plugin(Include, { path: './cordis.yml', initial: [] })
await root.loader.await()

root.crawler.add('https://example.com/')
```

```yaml
# cordis.yml
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'

- id: fetcher
  name: './plugins/fetcher.ts'
  config:
    timeoutMs: 20000

- id: indexer
  name: './plugins/indexer.ts'

- id: crawler
  name: './plugins/crawler.ts'
  config:
    concurrency: 32
    intervalMs: 500
```

`id` 用来定位条目，`name` 是模块路径，`config` 原样传给插件。`root.baseUrl` 决定相对路径的解析
基准；设置后，`./plugins/*.ts` 和 `./cordis.yml` 都能按入口文件的位置解析。

Loader 对模块导出有一个约定：如果模块有 `default` 导出，它会优先使用 `default`；否则把整个模块命名
空间当作插件对象。因此：

- 服务类用 `export default class ...`，静态 `inject` 会随类一起带过去；
- 函数插件如果没有 `default` 导出，则使用 `export const name`、`export const inject` 和
  `export function apply`；
- 不要同时写一个“光秃秃”的 `default` 函数，又把 `inject` 挂在命名导出上，否则 loader 只拿到
  `default`，依赖声明会丢失。

本仓库的 `apps/cli/cordis.patch.yml` 展示了更进一步的用法：以条目 `id` 为单位做分层 patch。这里
不再展开，先保证单文件配置可用。

## 8. 与本仓库的对应关系

本文的例子和 `micro-harness` 的骨架可以一一对应：

| 教程中的位置 | 仓库中的能力缝 |
| --- | --- |
| `ctx.fetcher` | `ctx.web` + `web/fetch-http` |
| `ctx.crawler` | 没有独立包；适合作为一个 consumer 插件 |
| `crawler/page` 事件 | `ctx.sessions` 的事件日志 / agent loop 的 tool result |
| `ctx.effect` 清理 | README 约定“注册动作必须可随插件卸载撤销” |
| YAML 组合 | `apps/cli/cordis.patch.yml` |

如果要接 LLM agent，最自然的边界不是把抓取逻辑塞进模型循环，而是：

1. 把 `ctx.crawler.add()` 包装成一个工具，让模型提交 URL；
2. 订阅 `crawler/page`，把页面内容写入 session 或交给索引器；
3. 让 `ctx.agentLoop` 只在需要决策时调用工具，抓取并发仍由 Crawler 自己控制。

## 常见坑

- **忘了 `timer` 依赖**：在 `inject` 里漏掉 `timer` 时，读取 `ctx.interval` 会报
  `cannot get property "interval" without inject`。
- **用 `emit` 等待消费者**：`ctx.emit` 不等待 Promise；需要背压时用 `ctx.parallel` 或
  `ctx.serial`。
- **无限并发**：直接 `Promise.all(urls.map(fetch))` 会在队列变大时耗尽连接和内存；用本文的
  worker pool。
- **忘记清理**：`setInterval`、`addEventListener`、`AbortController` 都应通过 `ctx.effect` 或
  插件 API 注册，否则插件卸载后仍在运行，进程也无法退出。
- **服务名冲突**：同一隔离作用域内同名服务只能注册一次。需要多实例时使用 `ctx.isolate(name)` 创建
  独立作用域，而不是在根上下文重复挂载。
- **日志看不见**：Cordis 的 logger 默认只写入内存缓冲区，记得注册 exporter。

生产环境还需要补上按域名限速、`robots.txt` 合规、ETag 或内容哈希去重、持久化 frontier，以及抓取
指标和告警。

到这里，你已经有一个可运行的最小抓取 agent。继续扩展时，优先新增 provider、consumer 或事件，
而不是修改 Crawler 的内部循环；这样每个能力都能独立挂载、卸载和替换。
