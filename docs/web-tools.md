# Web 工具设计：web_search 与 web_fetch

> **状态**：设计稿（2026-11-09）  
> **范围**：P4（`web_fetch`）、P5（`web_search`）  
> **依据**：FR-14～FR-17、FR-24、FR-39、NFR-9/10/14；架构约束 C-2/C-3/G-5。

## 1. 目标与非目标

### 目标

- 给模型提供两个稳定的工具：`web_search` 负责发现来源，`web_fetch` 负责读取单个来源。
- 工具只依赖 `ctx.web` 服务缝，不感知 DeepSeek、HTTP 库或 provider 配置。
- 所有进入模型上下文的网页内容有明确来源、抓取时间、大小与截断状态。
- 默认拒绝内网地址、非法协议、非文本响应和越界大小；凭证不进入日志或模型上下文。
- 首版实现保持最小：单次搜索、单次抓取，不做网页正文抽取与爬虫调度。

### 非目标

| 非目标 | 归属 |
| --- | --- |
| 正文抽取、去导航/广告、实体与事件抽取 | FR-35 起的领域包 |
| frontier、并发调度、域名限速、robots 解析、重试与续跑 | FR-27～FR-34 的 crawl 领域包 |
| 搜索 provider 的合成答案作为证据 | 本设计明确不采纳 |
| 登录、付费墙、验证码、代理轮换 | NG-6，明确禁止 |
| 浏览器渲染、JavaScript 执行 | 首版只做 HTTP 文本抓取 |

## 2. 架构位置

```text
agent-loop
  → ctx.tools
    → web_search / web_fetch        （packages/web/src/tools.ts）
      → ctx.web                     （packages/web/src/index.ts）
        → WebSearchProvider         （packages/web/src/search-deepseek.ts）
        → WebFetchProvider          （packages/web/src/fetch-http.ts）
          → HTTP(S)
```

职责边界：

- **`ctx.web`**：provider 注册、执行时选择、统一错误；不执行 I/O。
- **provider**：协议、传输、超时、大小、内容类型、SSRF 防护；不定义模型 schema。
- **tool**：模型可见的名称、描述、参数、结果渲染、工具级上限；不读取 provider 配置。
- **session**：记录工具调用的规范化结果，保证可追溯；不保存原始 provider 响应。

### 2.1 Cordis 生命周期

- provider 插件导出 `name`、`inject`、`apply(ctx, config)`。
- 注册动作通过 `ctx.effect()` 绑定到插件，卸载时精确移除。
- tool 插件 `inject: ['tools', 'web', 'systemPrompt']`；缺少 `ctx.web` 时由 Cordis 保持 `PENDING`，不抛半初始化错误（FR-20）。
- `ctx.web` 在执行时选择 provider，因此替换 provider 不需要重新注册工具。

## 3. 服务缝契约

### 3.1 统一错误

```ts
export type WebErrorCode =
  | 'WEB_PROVIDER_UNAVAILABLE'
  | 'WEB_PROVIDER_AMBIGUOUS'
  | 'WEB_INVALID_URL'
  | 'WEB_UNSUPPORTED_PROTOCOL'
  | 'WEB_BLOCKED_ADDRESS'
  | 'WEB_REDIRECT_LIMIT'
  | 'WEB_TIMEOUT'
  | 'WEB_HTTP_STATUS'
  | 'WEB_UNSUPPORTED_CONTENT_TYPE'
  | 'WEB_TOO_LARGE'
  | 'WEB_BAD_RESPONSE'
  | 'WEB_FETCH_FAILED'
  | 'WEB_SEARCH_FAILED'

export class WebError extends Error {
  readonly code: WebErrorCode
  readonly retryable: boolean
}
```

- 错误信息面向模型：说明失败的操作、URL 或 query、可定位的上下文。
- 不在 message 中放 API key、Cookie、Authorization 或完整响应头。
- `retryable` 只表达“重试可能成功”：超时、429、5xx 为 true；4xx、非法 URL、SSRF 为 false。
- provider 负责把底层错误归一化为 `WebError`；tool 不解析底层异常。

### 3.2 provider 注册与选择

```ts
export class WebRuntime extends Service {
  registerSearchProvider(provider: WebSearchProvider): () => void
  registerFetchProvider(provider: WebFetchProvider): () => void

  search(request: WebSearchRequest, signal: AbortSignal): Promise<WebSearchResult>
  fetch(request: WebFetchRequest, signal: AbortSignal): Promise<WebFetchResult>
}
```

选择规则：

1. 配置了 `searchProvider` / `fetchProvider` 时，只使用该 id；不存在或 `available() === false` 时返回 `WEB_PROVIDER_UNAVAILABLE`，不静默降级。
2. 未配置时，只考虑 `available() === true` 的 provider：
   - 恰好一个：使用它；
   - 零个：`WEB_PROVIDER_UNAVAILABLE`；
   - 多个：`WEB_PROVIDER_AMBIGUOUS`，要求部署配置显式选择。
3. 重复注册同一 id 直接报错；注册返回的 disposer 由 `ctx.effect()` 持有。

本文使用的 provider id：抓取为 `http`，搜索为 `deepseek-official`；id 只出现在部署配置与日志，不进入模型可见的工具 schema。

### 3.3 结果字段

在现有 `WebFetchResult` 上补三个字段：

```ts
export interface WebFetchResult {
  readonly url: string
  readonly finalUrl: string
  readonly status: number
  readonly contentType?: string
  readonly fetchedAt: number
  readonly truncated: boolean
  readonly body: WebFetchBody
}
```

- `finalUrl` 是跟随重定向后的地址；`url` 保留请求地址。
- `fetchedAt` 由 provider 在收到响应时写入，单位毫秒。
- `truncated` 表示字符上限截断；字节上限是硬错误，不进入结果。
- 搜索结果保持现有结构：`{ sources }`，不增加 provider 合成答案。

## 4. `web_search` 设计

### 4.1 模型可见 schema

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 搜索词，去除首尾空白后不得为空，长度上限 512 字符。 |
| `maxResults` | integer | 否 | 期望结果数；调用时夹在 `1..searchMaxResults`。 |

```ts
parameters: {
  query: {
    type: 'string',
    description: 'Search query. Use concise keywords, not a full question.',
    required: true,
  },
  maxResults: {
    type: 'integer',
    description: 'Maximum number of sources to return.',
  },
}
```

模型不能选择 provider、模型、超时或 API 版本；这些全部来自部署配置。

工具描述必须明确边界：

> Search the public web and return source titles, URLs, and snippets. Results are discovery aids, not evidence; fetch a source before citing it.

现有骨架中的 `searchMaxQueries`、`searchSummaryMaxChars` 首版不启用：一次调用只发一个 query，provider 的合成答案不进入工具结果。待 Q-5 明确后再决定删除或启用。

### 4.2 执行流程

1. 校验并规范化参数：`query.trim()`、空值拒绝、`maxResults` 夹取。
2. 用 `AbortSignal.any([execution.signal, timeoutSignal])` 组合取消信号。
3. 调用 `ctx.web.search({ query, maxResults }, signal)`。
4. 归一化并去重来源：
   - `title` 去空白后为空：丢弃；
   - `url` 必须是绝对的 `http:` / `https:`：否则丢弃；
   - 规范化 URL 用于去重：小写 scheme/host、去 fragment、去默认端口；保留查询参数；
   - 相同 URL 只保留第一次出现；
   - 按 provider 返回顺序截断到 `maxResults`。
5. 若 provider 返回了条目但全部被丢弃：`WEB_BAD_RESPONSE`。
6. 若 provider 返回零条：成功，返回空列表，由渲染层明确写“没有结果”。
7. 不自动抓取结果页；抓取是模型的下一步显式动作。

### 4.3 渲染

```text
Web search: "nintendo switch 2 delay"
Sources: 3
[1] Nintendo delays Switch 2 in Japan
    https://example.com/news/switch-2-delay
    The company said the launch would move to...
[2] ...
Search results are discovery aids. Fetch a source before citing it.
```

规则：

- 每个来源最多保留 `snippet` 400 字符；超出时截断并加 `…`。
- 不输出 provider 原始 JSON、请求 id、计费信息或内部排名。
- 不把 provider 的合成答案放进结果；若 provider 返回，只保留 `sources`。
- 工具结果作为普通文本块写回；session 中保存规范化后的 `{ query, sources }`。

### 4.4 provider 要求

`DeepSeekSearchProvider` 或其他实现必须：

- 从 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）读取凭证；缺失时 `available()` 为 false。
- 请求体只包含查询、结果数与部署配置；不把模型上下文或 session 内容发给搜索服务。
- 对响应做最小 schema 校验；字段缺失或类型错误归一化为 `WEB_BAD_RESPONSE`。
- 响应体有大小上限（建议 1 MiB），超限报 `WEB_TOO_LARGE`。
- 单次请求一次尝试，不做自动重试；重试由 crawl 层按 `retryable` 决定。
- 不记录 API key；错误信息中只出现 provider id 与 HTTP 状态。

## 5. `web_fetch` 设计

### 5.1 模型可见 schema

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 要抓取的公开 HTTP(S) URL。 |

```ts
parameters: {
  url: {
    type: 'string',
    description: 'Public HTTP(S) URL to fetch. Private and non-text targets are rejected.',
    required: true,
  },
}
```

模型不能指定输出格式、最大字节数或重定向次数；这些由 `fetch-http` 与 tool 配置控制，避免模型绕过上限。

### 5.2 provider 行为

#### URL 与 SSRF

1. 用 `new URL()` 解析；解析失败或缺少 hostname：`WEB_INVALID_URL`。
2. 只允许 `http:` / `https:`；其他协议：`WEB_UNSUPPORTED_PROTOCOL`。
3. 拒绝 URL 中的 username/password。
4. 拒绝 loopback、私有、链路本地、保留地址与云元数据地址：
   - IPv4：`0.0.0.0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.168/16`、`198.18/15`、`224/4`、`240/4` 等；
   - IPv6：`::`、`::1`、`fc00::/7`、`fe80::/10`、IPv4-mapped 私有地址等。
5. 对 hostname 做 DNS 解析，任一解析结果为上述地址即拒绝：`WEB_BLOCKED_ADDRESS`。
6. 每一跳重定向都重新执行 1～5；不能只校验初始 URL。
7. DNS rebinding 的说明：预解析能覆盖常见场景，但不能完全消除“解析后换地址”。首版记录该残余风险；若部署要求强保证，后续用固定解析地址的 undici dispatcher，不在本设计内提前实现。

#### 重定向

- 使用手动重定向（`redirect: 'manual'`），自己跟随并校验 `Location`。
- 最多 `maxRedirects` 跳；超限：`WEB_REDIRECT_LIMIT`。
- 重定向目标必须是绝对或可解析的 HTTP(S) URL；相对地址按当前 URL 解析。
- 不携带 Cookie；不自动添加 Authorization。

#### 请求头与超时

- `User-Agent` 可配置，默认 `micro-harness/<version>`；不使用伪装浏览器标识。
- `Accept` 只声明可处理的文本类型；不发送 `Authorization`、Cookie 或 Referer。
- 超时由 provider 与 tool 双重控制：
  - provider 用 `timeoutMs` 中止底层请求；
  - tool 把同一个 `AbortSignal` 传给 provider，并设置协作式 `timeoutMs`。
- 超时：`WEB_TIMEOUT`，`retryable = true`。

#### 状态码与内容类型

- 只接受最终 `2xx`；其余状态：`WEB_HTTP_STATUS`。
- `408`、`425`、`429`、`5xx` 标记 `retryable = true`；其他 `4xx` 为 false。
- 允许的内容类型：
  - `text/*`
  - `application/xhtml+xml`
  - `application/json`、`+json`
  - `application/xml`、`+xml`
- 其他类型（图片、PDF、压缩包、二进制）：`WEB_UNSUPPORTED_CONTENT_TYPE`。
- 缺少 `Content-Type` 时按 `text/plain` 处理，但仍受大小与解码限制。

#### 大小、解码与截断

两层上限，职责不同：

| 配置 | 作用 | 超限行为 |
| --- | --- | --- |
| `maxResponseBytes` | 限制网络读取的原始字节 | 立即中止并报 `WEB_TOO_LARGE` |
| `maxBodyChars` | 限制解码后的正文字符 | 截断并设置 `truncated: true` |
| `fetchMaxOutputChars` | 限制最终交给模型的文本 | 再次截断并加显式标记 |

- 先检查 `Content-Length`；声明值超限时直接拒绝，不读取 body。
- 流式读取时累计实际读取的字节，超过 `maxResponseBytes` 立即取消读取。压缩响应按解压后的读取字节计；`Content-Length` 在压缩场景下只作提前判断，不能替代流式上限。
- 按 `Content-Type` 的 charset 解码，默认 UTF-8；解码失败使用替换字符，不让请求失败。
- 截断只发生在字符层；字节层永远是硬错误，避免内存无界。
- 不静默截断：渲染结果必须包含 `Truncated: yes` 与实际上限。

### 5.3 HTML 转文本

Q-4 尚未最终确认。首版建议：

- provider 只返回原始 `html` / `text`，不做正文抽取。
- tool 配置 `fetchFormat: 'text' | 'html'`，默认 `text`。
- `text` 模式是确定性的轻量转换，不是 FR-35 的正文抽取：
  - 移除 `script`、`style`、`noscript`、`template`、`svg` 的内容；
  - 块级标签转换为换行；
  - 解码常见 HTML 实体；
  - 折叠连续空白与空行。
- `html` 模式返回原始 HTML，仅用于调试或后续抽取管线。
- 不做可读性评分、广告识别、正文边界推断；这些属于领域抽取包。

### 5.4 渲染

```text
Fetched: https://example.com/final
Status: 200
Content-Type: text/html; charset=utf-8
Fetched-At: 2026-11-09T10:30:00.000Z
Truncated: no

Nintendo said the launch would move to...
```

规则：

- `requestedUrl` 与 `finalUrl` 不同时，额外输出 `Requested:`。
- 内容放在独立文本块；元数据与正文之间空行分隔。
- 截断时输出 `Truncated: yes (maxBodyChars=100000, output=50000)`。
- 工具结果写入 session 时保存规范化值；模型只看到渲染文本。

## 6. 安全与合规

| 风险 | 措施 |
| --- | --- |
| SSRF | 协议白名单、拒绝 userinfo、拒绝私有/保留地址、每跳重定向复检 |
| DNS rebinding | 预解析并拒绝私有结果；记录残余风险，后续可用固定地址 dispatcher |
| 超大响应 | 字节硬上限 + 字符截断 + 输出上限 |
| 非文本内容 | `Content-Type` 白名单，其他明确报错 |
| 凭证泄露 | 只从环境变量读取；日志与错误信息脱敏 |
| 登录/付费墙绕过 | 不携带 Cookie/Authorization，不实现验证码或代理轮换 |
| robots 与限速 | 由 crawl/frontier 层在调用前执行；`web_fetch` 是单次传输原语，不代替爬虫策略 |
| 模型误用 | 工具描述明确“搜索结果是线索，不是证据”；抓取结果保留 URL 与时间 |

`web_fetch` 不解析 robots.txt。原因：

- robots 是“是否允许抓取某路径”的爬虫策略，需要与域名、路径、UA、缓存和限速一起判断；放在单次传输 provider 里会与 FR-31 的调度职责重复。
- crawl 插件必须在入队前完成 robots 与域名策略检查，再把允许的 URL 交给 `ctx.web.fetch`。
- 若后续需要独立使用 `web_fetch` 也遵守 robots，可增加 opt-in provider 配置，不改变工具契约。

这意味着一个部署边界必须明确：**如果直接把 `web_fetch` 暴露给模型，而不经过 crawl 的 robots/域名策略层，模型就可能抓取被 robots 禁止的路径。** P4/P5 的默认组合应把它视为受控任务内的传输原语；需要面向开放 URL 时，在外层加 robots/域名策略插件，或把 `web_fetch` 标记为仅 crawl 内部使用。该选择列入待确认项。

## 7. 配置

沿用 `apps/cli/cordis.patch.yml` 的现有行：

```yaml
- id: web
  name: '@micro-harness/web'
  config:
    searchProvider: deepseek-official
    fetchProvider: http

- id: web-fetch-http
  name: '@micro-harness/web/fetch-http'
  config:
    maxResponseBytes: 5242880
    maxBodyChars: 100000
    timeoutMs: 30000
    maxRedirects: 5
    userAgent: micro-harness/0.0.0

- id: web-search-deepseek
  name: '@micro-harness/web/search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: https://api.deepseek.com
    maxResults: 8

- id: tool-web
  name: '@micro-harness/web/tools'
  config:
    search: true
    fetch: true
    searchMaxResults: 8
    searchTimeoutMs: 60000
    fetchTimeoutMs: 30000
    fetchMaxOutputChars: 50000
    fetchFormat: text
```

建议默认值：

| 配置 | 默认 | 说明 |
| --- | ---: | --- |
| `maxResponseBytes` | 5 MiB | 网络字节硬上限 |
| `maxBodyChars` | 100,000 | 解码后正文上限 |
| `fetchMaxOutputChars` | 50,000 | 模型可见输出上限 |
| `timeoutMs` / `fetchTimeoutMs` | 30 s | 抓取超时 |
| `searchTimeoutMs` | 60 s | 搜索超时 |
| `maxRedirects` | 5 | 重定向跳数 |
| `searchMaxResults` | 8 | 搜索来源上限 |
| `fetchFormat` | `text` | `text` 或 `html` |

限制只能由部署配置提高或降低，模型参数不能覆盖。

## 8. 会话与可追溯

- session 记录工具调用的规范化结果，不记录 provider 原始响应。
- `web_search` 记录 `{ query, sources }`；`snippet` 明确标注为搜索摘要。
- `web_fetch` 记录 `{ requestedUrl, finalUrl, status, contentType, fetchedAt, truncated, content }`。
- 渲染函数只做确定性文本转换；同一结果重复渲染得到相同文本。
- 报告或结论引用网页时，至少使用 `finalUrl`、`fetchedAt` 与原文片段；只有 `snippet` 不足以作为证据（NFR-10、FR-39）。
- 日志记录 provider id、URL/query、状态、字节/字符数、耗时、错误码；不记录 API key、Cookie、完整响应头或完整正文。

## 9. 错误与重试语义

| 场景 | 错误码 | retryable |
| --- | --- | --- |
| 没有可用 provider / 配置的 provider 不存在 | `WEB_PROVIDER_UNAVAILABLE` | false |
| 多个可用 provider 且未配置 | `WEB_PROVIDER_AMBIGUOUS` | false |
| URL 解析失败 / 缺 hostname | `WEB_INVALID_URL` | false |
| `file:`、`ftp:`、`data:` 等 | `WEB_UNSUPPORTED_PROTOCOL` | false |
| 私有、回环、链路本地、元数据地址 | `WEB_BLOCKED_ADDRESS` | false |
| 重定向超限或目标非法 | `WEB_REDIRECT_LIMIT` | false |
| 超时 | `WEB_TIMEOUT` | true |
| 4xx（除 408/425/429） | `WEB_HTTP_STATUS` | false |
| 408/425/429/5xx | `WEB_HTTP_STATUS` | true |
| 非文本内容类型 | `WEB_UNSUPPORTED_CONTENT_TYPE` | false |
| 超过 `maxResponseBytes` | `WEB_TOO_LARGE` | false |
| 搜索响应结构不合法 / 来源全部无效 | `WEB_BAD_RESPONSE` | false |
| DNS、TLS、连接失败 | `WEB_FETCH_FAILED` | true |
| 搜索请求失败 | `WEB_SEARCH_FAILED` | 按状态码判断 |

tool 抛出 `WebError`；`ctx.tools` 的执行器负责把它转换为 `isError: true` 的 tool message，交回模型（FR-4）。tool 不把错误包装成成功文本。

## 10. 测试

离线测试使用本地 HTTP stub，不访问外网；联网测试由环境变量显式开启（NFR-3）。

| 用例 | 期望 |
| --- | --- |
| 搜索返回 3 条合法来源 | 渲染编号列表，URL 原样保留 |
| 搜索来源 URL 重复 | 只保留第一次出现 |
| 搜索来源 URL 非 HTTP(S) | 丢弃；全部无效时报 `WEB_BAD_RESPONSE` |
| 搜索空结果 | 成功，渲染“没有结果” |
| 未配置 provider 且有多个可用 provider | `WEB_PROVIDER_AMBIGUOUS` |
| 抓取 200 HTML | 返回文本、状态、finalUrl、fetchedAt |
| 抓取 404 | `WEB_HTTP_STATUS`，retryable=false |
| 抓取 500 / 429 | `WEB_HTTP_STATUS`，retryable=true |
| 重定向到私有地址 | `WEB_BLOCKED_ADDRESS` |
| 超过最大重定向 | `WEB_REDIRECT_LIMIT` |
| 超时 | `WEB_TIMEOUT` |
| `Content-Length` 超限 | `WEB_TOO_LARGE`，不读取完整 body |
| 流式 body 超过字节上限 | 中止读取并报 `WEB_TOO_LARGE` |
| 字符超限 | 成功，`truncated: true`，渲染标记 |
| 图片/PDF 响应 | `WEB_UNSUPPORTED_CONTENT_TYPE` |
| `file://` / `ftp://` | `WEB_UNSUPPORTED_PROTOCOL` |
| 私有 IPv4 / IPv6 / localhost / 元数据地址 | `WEB_BLOCKED_ADDRESS` |
| 工具参数缺 `query` 或空字符串 | 参数校验失败，错误回传模型 |
| 工具注销后 | 对应工具不再出现在 schema 与执行集合中 |

测试文件按约定放在 `tests/*.spec.ts`，使用 `node:test`；显式运行，例如：

```bash
./.local/node/bin/node --import tsx --test tests/web-tools.spec.ts
```

联网测试可沿用 `FETCH_URL` 开关，默认 skip。

## 11. 实现顺序

1. `ctx.web`：`WebError`、provider 注册、执行时选择、统一错误。
2. `fetch-http`：URL/SSRF、重定向、超时、内容类型、字节/字符上限。
3. `web_fetch`：schema、渲染、错误映射、session 记录。
4. `search-deepseek`：凭证、请求、响应校验、来源归一化与去重。
5. `web_search`：schema、渲染、上限。
6. 配置与文档：YAML 默认值、README 文档入口、测试。
7. 后续接入 crawl：robots、域名限速、重试分类、frontier 持久化。

与里程碑对应：步骤 1～3 属于 P4，步骤 4～5 属于 P5。

## 12. 待确认

| 编号 | 问题 | 本设计建议 |
| --- | --- | --- |
| Q-4 | `web_fetch` 输出 HTML、纯文本还是 Markdown | 默认 `text`；保留 `html` 配置；不做正文抽取 |
| Q-5 | 搜索 provider 与官方 API 形态 | 保持 `WebSearchProvider` 契约；DeepSeek 不可用时替换 provider，不改工具 |
| Q-17 | robots、站点条款与存档边界 | robots 在 crawl 层执行；`web_fetch` 不绕过访问控制 |
| 新增 | 直接暴露 `web_fetch` 时如何保证 robots | 默认视为受控任务内的传输原语；开放 URL 时加 robots/域名策略插件，或仅限 crawl 内部使用 |
| 新增 | 搜索摘要是否进入工具结果 | 首版不进入；只返回 sources，避免无来源结论 |
| 新增 | DNS rebinding 的强保证 | 首版预解析并记录残余风险；生产要求时再加固定地址 dispatcher |
