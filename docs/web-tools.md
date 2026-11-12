# Web 工具设计：搜索、抓取、正文抽取与多子代理深度采集

> **状态**：设计稿 v2（2026-11-12）
> **范围**：P4/P5 工具层；P8/P9 深度采集与抽取；P12 视频/媒体（后续）
> **依据**：FR-14～FR-17、FR-24、FR-27～FR-39、FR-59、FR-61；NFR-3/5/8/9/10/14；C-2/C-3/C-8
> **当前实现**：`web_search` 的 Exa（主）/ DeepSeek（备）provider、primary/fallback 路由、工具定义、CLI `mh web-search` 与离线测试已落地；`web_fetch`、正文抽取、`ctx.crawl`、多子代理与视频采集仍为设计或骨架。工具层目标目录见 §2.6。

## 0. 结论先行

本设计把“网页能力”拆成四层，避免把搜索、传输、正文抽取和 agent 推理混在一个工具里：

```text
搜索发现（search） → 单页传输（fetch） → 正文抽取（extract） → 深度采集/推理（crawl + agents）
```

关键决策：

1. **`web_search` 只负责发现来源**，返回标题、URL、摘要、站点与时间；不把搜索摘要当证据。
2. **`web_fetch` 默认返回正文**，不是标题或 snippet：正文 Markdown + 元数据 + 抓取时间 + 内容哈希。
3. **搜索 provider 可插拔**：当前选定 **Exa（主）+ DeepSeek（备）**，通过 `searchProvider` / `searchFallback` 配置；其他候选见 §3.3。
4. **“深度采集”不等于“多调几次 `web_fetch`”**：用 `ctx.crawl` 管理 frontier、并发、限速、robots、去重与续跑。
5. **多子代理用于决策与阅读，不用于逐 URL 抓取**：确定性调度内核负责吞吐，子代理负责拆解、选源、阅读、验证与综述。
6. **视频是独立媒体域**：先做元数据与字幕，ASR、关键帧/OCR 后续；不绕过 DRM、付费墙或登录。
7. **所有进入模型上下文的内容必须可追溯**：URL、最终 URL、抓取时间、内容哈希、抽取器版本与原文片段。

### 0.1 从“标题”到“正文”的演进

| 阶段 | 能力 | 产物 | 归属 |
| --- | --- | --- | --- |
| S0 | 搜索发现 | title / url / snippet | P5，已实现 |
| S1 | 单页正文 | 标题、作者、发布时间、正文 Markdown | P4b，本设计重点 |
| S2 | 多页正文语料 | 一批 Document + Passage | P8，`ctx.crawl` |
| S3 | 结构化证据 | Claim / Evidence / 时间线 | P9 |
| S4 | 视频内容 | 元数据、字幕、转写稿 | P12（后续） |

## 1. 目标与非目标

### 1.1 目标

- 给模型提供稳定的 `web_search` / `web_fetch` 工具，并给上层研究流程提供 `deep_research` 能力。
- 搜索不绑定单一厂商：同一套工具可以接 DeepSeek、Brave、Bocha、Tavily、Exa、SearXNG 等。
- 抓取不止一次、不止标题：单页返回正文；深度采集可以批量抓取、抽取、去重、续跑。
- 正文抽取保留元数据与片段位置，支持后续证据绑定（FR-35、FR-39）。
- 视频页面最终可以抽取元数据、字幕/转写稿与可选关键帧信息。
- 默认拒绝内网地址、非法协议、非文本响应和越界大小；凭证不进入日志或模型上下文。
- 默认离线测试；联网测试显式开启（NFR-3）。

### 1.2 非目标

| 非目标 | 说明 |
| --- | --- |
| 绕过登录、付费墙、验证码、DRM | NG-6，明确禁止 |
| 代理轮换、指纹伪装、反爬对抗 | NG-6，明确禁止 |
| 分布式集群 | 首版单机；只预留接口（FR-34） |
| 实时全网监控 | 按任务或定时采集（NG-8） |
| 把搜索 provider 的合成答案当证据 | 只把来源当线索，结论必须回到原文 |
| 首版就实现所有搜索引擎 | 先选 1 主 1 备，其余按插件逐步加 |
| 首版就实现视频 ASR/关键帧 | 先元数据与已有字幕，后续再做 |

### 1.3 设计原则

1. **传输、抽取、调度、推理分离**：`fetch` 只拿字节，`extract` 只产文档，`crawl` 只调度，agent 只决策。
2. **provider 可替换**：调用方只依赖 `ctx.web` / `ctx.crawl` / `ctx.media` 服务缝。
3. **确定性内核 + agent 边缘**：URL 规范化、去重、限速、robots、重试用代码；查询生成、阅读、验证、综述用模型。
4. **证据优先**：没有来源与片段的内容不进入结论（C-9、NFR-10）。
5. **资源有界**：页数、字节、token、时间、成本都有上限；超限停止或降级。
6. **网页内容不可信**：抓到的正文是数据，不是指令；防止提示注入（§10.5）。

## 2. 总体架构

### 2.1 分层图

```text
┌────────────────────────────────────────────────────────────────────┐
│ Research Orchestrator（agent）                                     │
│   ├─ Query Scout 子代理（生成查询、跨引擎发现）                    │
│   ├─ Reader 子代理池（抓取、抽取、摘要、定位片段）                 │
│   ├─ Media Analyst 子代理（视频元数据/字幕）                       │
│   ├─ Verifier 子代理（claim ↔ passage 校验、冲突标记）             │
│   └─ Synthesizer 子代理（时间线、证据表、报告）                    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ 结构化 artifact / 事件
┌──────────────────────────────▼─────────────────────────────────────┐
│ ctx.crawl：frontier、调度、限速、robots、去重、重试、续跑、预算    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│ ctx.web：搜索路由 / 抓取 / 正文抽取                                 │
│   ├─ SearchProvider：deepseek | brave | bocha | tavily | exa | ...  │
│   ├─ FetchProvider：http | render（可选）                          │
│   └─ ExtractProvider：readability | jina-reader | firecrawl | ...  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│ ctx.media（后续）：YouTube / Bilibili / Vimeo / ASR                 │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 各层职责

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| `web_search` / 搜索路由 | query 校验、provider 选择、结果归一化、去重、失败回退 | 抓正文、判断证据真伪 |
| `fetch-http` | HTTP(S) 传输、重定向、超时、SSRF、Content-Type、字节上限 | 正文边界、广告识别、robots 调度 |
| `extract-*` | HTML → 正文、元数据、Markdown、链接、内容哈希、质量评分 | 跨页调度、实体/事件抽取 |
| `ctx.crawl` | frontier、并发、域名限速、robots、重试、去重、续跑、预算 | 生成查询、写结论 |
| `ctx.media` | 视频元数据、字幕/转写、关键帧（后续） | 绕过 DRM/登录、版权判断 |
| `ctx.research` | 多子代理编排、artifact 流转、验证与综述 | 底层 HTTP、队列、限速 |
| session / knowledge | 记录规范化结果与 provenance | 保存 provider 原始响应 |

### 2.3 Cordis 服务与包映射

| 服务 / 包 | 内容 | 状态 |
| --- | --- | --- |
| `@micro-harness/web` | `ctx.web`：search/fetch/extract registry、错误、路由 | 已有骨架，search 部分已实现 |
| `@micro-harness/web/search-exa` | Exa Search provider（主搜索） | 已实现 |
| `@micro-harness/web/search-deepseek` | DeepSeek 官方 Search provider（备用） | 已实现 |
| `@micro-harness/web/search-brave` 等 | 其他搜索 provider | 待实现（按选择） |
| `@micro-harness/web/fetch-http` | HTTP 抓取 provider | 骨架 |
| `@micro-harness/web/web-tools` | 模型可见工具插件：注册 `web_search` / `web_fetch` | `web_search` 已实现，`web_fetch` 待实现 |
| `@micro-harness/web/extract-readability` | 本地正文抽取 | 待实现 |
| `@micro-harness/crawl`（新增） | `ctx.crawl`：frontier/调度/robots/去重/续跑 | 待实现 |
| `@micro-harness/media`（新增） | `ctx.media`：视频/音频 | 后续 |
| `@micro-harness/research`（新增） | `ctx.research`：多子代理编排 | 后续 |
| `@micro-harness/knowledge`（P9） | Document/Passage/Claim/Evidence | 后续 |

包名与拆分粒度仍按 Q-21 讨论；本设计只要求“新增能力不破坏 `ctx.web` 的调用方”。

### 2.4 一次深度采集的数据流

```text
objective
  → planner 拆解子问题、时间窗、语言、来源类型、预算
  → query scouts 生成查询变体
  → search router 调 1～N 个 provider，归一化 + 去重
  → candidate pool（title/url/snippet/date/site/provider/discoveredFrom）
  → crawl frontier 入队（robots + 域名策略 + 优先级）
  → fetch worker 抓取（并发 + 限速 + 重试）
  → extract worker 抽正文/元数据/Markdown/片段
  → document store（正文、哈希、抓取时间、抽取器版本）
  → reader 子代理读文档、产摘要与关键片段
  → verifier 校验 claim ↔ passage，标记冲突/缺口
  → synthesizer 产时间线/证据表/报告
```

### 2.5 与现有代码的关系

- `packages/web/src/index.ts`：已有 `WebRuntime`、`WebError`、search/fetch provider 注册与执行时选择。本设计在其上增加**搜索路由**与**extract registry**，保持 `web.search()` / `web.fetch()` 调用方式不变。
- `packages/web/src/search-exa.ts` / `search-deepseek.ts`：已实现，分别作为 `exa`（主）与 `deepseek-official`（备）provider；回退策略在 `index.ts` 的 `searchWithFallback`。
- `packages/web/src/web-tools/`：模型可见工具层（详见 §2.6）。`web_search` 已有 schema、校验、归一化、渲染；`web_fetch` 待实现。新增来源字段必须可选，避免破坏现有测试。
- `packages/web/src/fetch-http.ts`：只有插件元数据与配置；P4 实现传输与 SSRF。
- `apps/cli`：`mh web-search` 可直连；agent 驱动仍待 P2。

### 2.6 工具层代码目录（目标结构）

模型可见工具统一放在 `packages/web/src/web-tools/`，每个工具一个子目录，schema、校验、归一化、渲染与类型都放在自己的目录内：

```text
packages/web/src/
├── index.ts                  # ctx.web：registry、WebError、搜索路由
├── provider-http.ts          # provider 共享的 HTTP 读取/错误解析
├── search-exa.ts             # 主搜索 provider（exa）
├── search-deepseek.ts        # 备用搜索 provider（deepseek-official）
├── fetch-http.ts             # HTTP 抓取 provider（P4）
├── extract-readability.ts    # 正文抽取 provider（P4b）
└── web-tools/                # 模型可见工具层（唯一工具入口）
    ├── index.ts              # Cordis 插件：按配置注册 web_search / web_fetch
    ├── web-search/
    │   ├── index.ts          # createWebSearchTool()
    │   ├── args.ts           # schema、参数校验、query/maxResults 上限
    │   ├── normalize.ts      # 来源归一化、URL 去重、截断
    │   ├── render.ts         # 模型可见文本
    │   └── types.ts          # WebSearchArgs / WebSearchValue / 配置
    └── web-fetch/
        ├── index.ts          # createWebFetchTool()
        ├── args.ts           # schema、URL 校验入口
        ├── normalize.ts      # WebFetchResult → WebDocument（正文/元数据/哈希）
        ├── render.ts         # Markdown + 元数据渲染
        └── types.ts          # WebFetchArgs / WebFetchValue / 配置
```

规则：

1. **工具层只依赖契约**：`web-tools/**` 只 import `ctx.web` 的 `WebSearchProvider` / `WebFetchProvider` / `WebDocument` 类型和 `@micro-harness/core/tools`，不 import 任何具体 provider（`search-exa.ts` 等）；provider 由 `ctx.web` 在执行时选择。
2. **目录自包含**：每个工具的参数 schema、校验、归一化、渲染、类型都在自己的子目录；只有真正跨工具的逻辑（例如插件注册、共享错误映射）才放 `web-tools/index.ts`。
3. **插件入口唯一**：`web-tools/index.ts` 导出 `name` / `inject` / `apply(ctx, config)`，取代当前 `packages/web/src/tools.ts`。
4. **包导出**：`package.json` 改为
   `./web-tools` → `./src/web-tools/index.ts`、
   `./web-tools/web-search` → `./src/web-tools/web-search/index.ts`、
   `./web-tools/web-fetch` → `./src/web-tools/web-fetch/index.ts`；
   迁移期保留 `./tools` 与 `./web-search` 作为 re-export，迁移完成后删除。
5. **CLI 直连路径不变**：`apps/cli` 仍可 `new` provider + `createWebSearchTool()` 直接调用，不依赖 Cordis 插件注册。
6. **测试镜像实现**：`tests/web-search*.spec.ts`、新增 `tests/web-fetch.spec.ts` 按工具分文件；包内单测放 `packages/web/tests/web-tools/<tool>.spec.ts`。

迁移步骤（先文档、后代码）：

1. `packages/web/src/web-search/` → `packages/web/src/web-tools/web-search/`（按 `index/args/normalize/render/types` 拆分）。
2. `packages/web/src/tools.ts` → `packages/web/src/web-tools/index.ts`。
3. 新增 `packages/web/src/web-tools/web-fetch/` 骨架。
4. 更新 `packages/web/package.json` exports、`apps/cli/src/args.ts` import、`tests/*` 路径。
5. 删除旧路径与临时 re-export，跑 typecheck/lint/test。

## 3. 搜索层设计

### 3.1 SearchProvider 契约

在现有 `WebSearchProvider` 上做**向后兼容扩展**：新增字段全部可选，现有 DeepSeek 实现不需要改调用方。

```ts
export interface SearchCapabilities {
  readonly web: boolean
  readonly news: boolean
  readonly images: boolean
  readonly videos: boolean
  readonly chinese: 'high' | 'medium' | 'low'
  readonly bodyContent: boolean
  readonly freshness: boolean
  readonly siteFilter: boolean
}

export interface SearchRequest {
  readonly query: string
  readonly count: number
  readonly language?: string
  readonly mediaType?: 'web' | 'news' | 'images' | 'videos'
  readonly freshness?: 'day' | 'week' | 'month' | 'year'
  readonly siteFilter?: readonly string[]
  readonly includeContent?: boolean
}

export interface SearchSource {
  readonly title: string
  readonly url: string
  readonly snippet?: string
  readonly content?: string          // 仅当 provider 明确返回正文时
  readonly date?: string
  readonly siteName?: string
  readonly authority?: number
  readonly provider?: string         // 由路由层填充
  readonly rank?: number             // 由路由层填充
}

export interface SearchProvider {
  readonly id: string
  readonly capabilities: SearchCapabilities
  available(): boolean
  search(request: SearchRequest, signal: AbortSignal): Promise<{ sources: readonly SearchSource[] }>
  estimateCost?(request: SearchRequest): number
}
```

规则：

- provider 只做“查询 → 来源”，不抓取结果页，不做正文抽取。
- `content` 只在 provider 原生返回且部署显式开启时使用；默认关闭，正文交给 `web_fetch`。
- provider 不自动重试；重试与回退由路由层/crawl 层决定（§9）。
- 凭证只从环境变量读取；错误信息只出现 provider id、HTTP 状态与官方错误消息。

### 3.2 多 provider 路由

`ctx.web.search()` 内部按部署策略选择 provider：

```ts
export interface SearchPolicy {
  readonly primary: string
  readonly fallback?: readonly string[]
  readonly merge?: boolean
  readonly maxProvidersPerQuery?: number
  readonly byLanguage?: Record<string, readonly string[]>
  readonly byMediaType?: Record<string, readonly string[]>
}
```

选择规则：

1. **primary**：优先使用；不可用或返回零结果时，按 `fallback` 顺序尝试。
2. **byLanguage**：查询语言命中时覆盖 primary/fallback；例如中文走 `deepseek-official` → `bocha`，英文走 `brave` → `tavily`。
3. **byMediaType**：`videos` 只路由到声明 `videos: true` 的 provider。
4. **merge**：为 true 时并发调用多个 provider，用 RRF（Reciprocal Rank Fusion）合并：
   `score = Σ 1 / (60 + rank_i)`；再按 URL 去重，保留最高分。
5. **失败语义**：
   - provider 不可用、超时、429、5xx、响应结构错误：可以回退到下一个 provider。
   - 非法 URL、SSRF、robots 拒绝、参数错误：**不回退**，直接报错。
6. **预算**：每次搜索记录 provider、请求数、估算成本；超过任务预算时停止回退。
7. **可追溯**：每个来源保留 `provider` 与 `rank`；合并结果保留所有命中 provider（`providers: string[]`）。

### 3.3 搜索引擎候选清单

> 价格与额度会变化，下表是 2026-11 的公开信息，接入前以官网为准。

#### 3.3.1 通用/国际搜索 API

| ID | 服务 | 类型 | 中文 | 正文 | 视频 | 成本/接入 | 主要限制 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brave` | Brave Search API | 独立索引 | 中 | 仅 snippet / extra_snippets | 有 `/videos/search` | 官方 API；$5/1k 请求；每月 $5 免费额度 | 存储结果/训练需单独安排；正文要另抓 | **推荐备选** |
| `tavily` | Tavily | Agent/RAG 搜索 | 中 | `include_raw_content` 可返回全文 | 无专用 | 官方 API；Free 1,000 credits/月，付费套餐 | 英文强、中文一般；raw content 可能为空 | **推荐（RAG 场景）** |
| `exa` | Exa | 神经/语义搜索 | 中 | `contents.text` | 无专用 | 官方 API；Search $7/1k，Contents $1/1k 页/内容类型 | 偏英文/技术；不是关键词 SERP | **已选主搜索**（语义/研究） |
| `serper` | Serper.dev | Google SERP | 高 | 仅 snippet（另有 scrape） | 可查 Google 视频结果 | 第三方；约 $0.30–1.00/1k | 非官方，ToS/稳定性风险 | 低成本 Google 结果 |
| `serpapi` | SerpAPI | 多引擎 SERP | 高 | 仅 snippet | 支持 YouTube/Baidu 等 | 第三方；中高 | 非官方；成本高 | 多引擎对比 |
| `you` | You.com API | AI 搜索 | 中 | 可返回正文/摘要 | 无专用 | 官方；付费 | 生态较封闭；英文为主 | 备选 |
| `kagi` | Kagi Search API | 付费索引 | 中 | 仅结果 | 需核实 | 订阅 + API；价格高 | 规模小、额度有限 | 高质量/隐私备选 |
| `perplexity` | Perplexity Sonar | 答案引擎 | 中 | 合成答案 + 引用 | 无专用 | 官方；中高 | 合成答案不能当证据 | 快速综述，不作主搜索 |
| `searxng` | SearXNG | 自托管元搜索 | 取决于引擎 | 否 | 取决于引擎 | 自托管；免费 | 无 SLA；上游限流/ToS；需维护 | **自托管推荐** |
| `mojeek` | Mojeek | 独立索引 | 低 | 仅 snippet | 否 | 官方 API；低 | 覆盖小 | 补充来源 |
| `commoncrawl` | Common Crawl | 归档索引 | 中 | WARC 原文 | 否 | 免费/自建 | 非实时；需处理 WARC | 批量历史网页 |

#### 3.3.2 中文搜索

| ID | 服务 | 类型 | 中文 | 正文 | 成本/接入 | 主要限制 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `deepseek-official` | DeepSeek 官方 Search API | AI 搜索 | 高 | `need_content` 可选 | 官方；约 $0.75/1k 请求；100 QPS | 结果是 AI 排序/摘要，需校验 | **已选备用搜索**（中文回退） |
| `bocha` | 博查 Web Search | 中文 AI 搜索 | 高 | summary / 正文片段 | 官方；约 ¥0.036/次；1,000 次免费 | 海外覆盖一般；与 DeepSeek 结果可能重叠 | **中文首选备选** |
| `zhipu` | 智谱 Web Search | 中文 AI 搜索 | 高 | `content_size` 可控 | 官方；¥0.01–0.05/次 | 与智谱生态绑定；最多 10 条 | 中文备选 |
| `baidu` / `360` / `sogou` | 百度/360/搜狗 | 中文通用搜索 | 高 | 否 | **无面向公众的通用 API** | 只能走第三方 SERP 或商务合作 | 暂不直接接入 |
| `bing` | Bing Web Search | — | — | — | 已于 2025-08-11 退役 | 迁移到 Azure Grounding 或其它 | **不推荐** |
| `google-cse` | Google Custom Search JSON API | Google 索引 | 高 | 仅 snippet | 100/天免费，$5/1k，10k/天上限 | 2025 起新客户关闭，2027-01-01 停止 | **不推荐新项目** |

> 博查对外宣称是 DeepSeek 官方搜索的合作方；若属实，DeepSeek 与博查的结果可能高度重叠，主/备二选一即可，接入前向服务商确认。

#### 3.3.3 抓取/正文抽取型服务

| ID | 服务 | 能力 | 成本/接入 | 主要限制 | 适合 |
| --- | --- | --- | --- | --- | --- |
| `readability` | `@mozilla/readability` + `linkedom`/`jsdom` + `turndown` | 本地 HTML → 正文 Markdown | 免费、无网络 | 不执行 JS；对复杂站点需调参 | **默认抽取器** |
| `trafilatura` | Trafilatura（Python） | 高质量正文抽取 | 免费；需 sidecar/子进程 | 非 TypeScript 原生；部署多一个运行时 | 质量优先 |
| `jina-reader` | Jina Reader `r.jina.ai` | URL → Markdown；支持 PDF/图片 | 按 token；约 $0.045–0.05/M tokens；10M 免费 | 外部服务；隐私/allowlist | **PDF/JS 回退** |
| `firecrawl` | Firecrawl scrape/crawl | 抓取 + JS 渲染 + Markdown | 1,000 credits/月免费；1 credit/页 | 外部服务；成本 | JS 页面、深度抓取 |
| `tavily-extract` | Tavily Extract | URL → 清洗正文 | 1 credit/5 页（basic） | 外部服务；按页计费 | 已有 Tavily 时复用 |
| `exa-contents` | Exa Contents | URL → text/highlights/summary | $1/1k 页/内容类型 | 外部服务；按内容类型计费 | 研究/语义场景 |
| `playwright` | Playwright/Browserless | 浏览器渲染 | 自托管或付费 | 资源重；只解决 JS，不做反爬 | 可选 render provider |

#### 3.3.4 视频/媒体（后续）

| ID | 服务 | 能力 | 成本/接入 | 主要限制 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `youtube-data` | YouTube Data API v3 | 搜索、元数据、频道/播放列表 | 免费配额 10k units/天；`search.list` 100 次/天 | `captions.download` 只对自有/有权限视频有效 | **元数据首选** |
| `youtube-transcript` | 第三方/非官方字幕 | 公共视频字幕 | 非官方；可能被限流 | 违反 ToS 风险；云 IP 常被 block | 仅合规评估后使用 |
| `bilibili` | Bilibili 内部 API | 元数据、字幕（WBI 签名 + 登录） | 非官方公开 API | 无官方字幕 API；需 SESSDATA；ToS 风险 | 受限，默认不做 |
| `vimeo` | Vimeo API | 元数据 | 官方；OAuth | 字幕能力有限 | 备选 |
| `tiktok-research` | TikTok Research API | 元数据 | 学术申请 | 非通用商业用途 | 研究场景 |
| `yt-dlp+whisper` | yt-dlp + Whisper | 元数据/字幕/音频转写 | 自托管；ASR 成本 | ToS/版权；仅允许内容 | 可选 ASR 回退 |
| `apify` / `hasdata` | 第三方抓取器 | 元数据/字幕 | 付费 | ToS/稳定性 | 非默认 |

### 3.4 分场景推荐组合

| 场景 | 主搜索 | 备搜索 | 正文抽取 | 说明 |
| --- | --- | --- | --- | --- |
| A. 中文优先、最快落地 | DeepSeek | Bocha 或智谱 | 本地 Readability | 与现有实现衔接最好 |
| B. 英文研究/RAG | Brave | Tavily / Exa | Readability + Jina 回退 | 独立索引 + 语义补充 |
| C. 低成本/自托管 | SearXNG | Brave | 本地 Readability | 无外部搜索 key；需维护 |
| D. Google 结果、低成本 | Serper | Brave | 本地 Readability | 接受第三方 SERP ToS 风险 |
| E. JS 重/深度抓取 | Brave | SearXNG | Firecrawl + Readability | 外部抽取需 allowlist |
| F. 视频发现 | Brave `/videos/search` | YouTube Data API | — | 字幕另走 media 域 |

### 3.5 已确认的选择

用户已确认：**主搜索 Exa，备用 DeepSeek**。

- **主搜索：Exa**（语义/自然语言查询强，`contents.highlights` 直接提供与查询相关的片段；新账号 $20 试用额度 + 每月 $10 免费额度）。
- **备搜索：DeepSeek 官方 Search API**（中文好、按请求计费、100 QPS；已在 `packages/web/src/search-deepseek.ts` 实现）。
- **回退条件**：主搜索不可用、可重试错误（超时/429/5xx）、或返回 0 条结果时切换；策略错误（SSRF、非法 URL、robots、不支持的内容类型）不切换。
- **正文抽取：本地 Readability**（免费、确定性、可离线测试）；PDF/JS 页面再按需加 Jina Reader 或 Firecrawl。
- **不建议作为新项目主搜索**：Google CSE（2027 停止）、Bing（已退役）、DuckDuckGo（无官方 API）。
- **第三方 SERP（Serper/SerpAPI）**：只有在接受其 ToS/稳定性风险时才启用。

实现状态：`packages/web/src/search-exa.ts` 与 `packages/web/src/index.ts` 的 `searchWithFallback`/`createSearchRouter` 已落地；CLI 与默认 `cordis.patch.yml` 已切换为 `exa → deepseek-official`。

### 3.6 搜索结果归一化与排序

1. 标题去空白后为空：丢弃。
2. URL 必须是绝对 `http:` / `https:`；否则丢弃。
3. 去重键：小写 scheme/host、去 fragment、去默认端口、移除跟踪参数（`utm_*`、`fbclid`、`gclid`）；保留业务查询参数。
4. 同一 URL 保留第一次出现；合并时保留最高 rank 与所有 provider。
5. 按 `maxResults` 截断；不足时返回空列表，不报错。
6. 不把 provider 的 `summary` / `answer` 放进 `sources`；只保留 `title/url/snippet/date/siteName`。
7. `authority` 只在 provider 原生提供时保留，不由本系统臆造。

### 3.7 `web_search` 工具变更

P5 保持现有 schema：`query`、`maxResults`。新增字段只做**输出扩展**，不要求模型填写：

| 字段 | 变化 |
| --- | --- |
| `query` | 不变，1–128 Unicode 字符 |
| `maxResults` | 不变，夹在 `1..50`，部署上限优先 |
| `sources[].date` | 可选，渲染为 `站点 · 日期` |
| `sources[].siteName` | 可选 |
| `sources[].provider` | 可选，只在调试/日志中显示，不进入模型文本 |
| `mediaType` | P12 预留，暂不暴露给模型 |

工具描述保持不变的核心边界：

> Search the public web and return source titles, URLs, and snippets. Results are discovery aids, not evidence; fetch a source before citing it.

实现位置（迁移后）：`packages/web/src/web-tools/web-search/`；provider 路由仍在 `packages/web/src/index.ts`。

## 4. 抓取层设计

### 4.1 FetchProvider 契约

```ts
export interface FetchRequest {
  readonly url: string
  readonly accept?: readonly string[]
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

export interface FetchResponse {
  readonly requestedUrl: string
  readonly finalUrl: string
  readonly status: number
  readonly contentType?: string
  readonly charset?: string
  readonly fetchedAt: number
  readonly etag?: string
  readonly lastModified?: string
  readonly truncated: boolean
  readonly body: { readonly kind: 'html' | 'text' | 'binary'; readonly content: string | Uint8Array }
}
```

现有 `WebFetchResult` 的 `{ url, finalUrl, status, body }` 是新结构的子集；新增字段全部可选或由 provider 填充。

### 4.2 URL 与 SSRF

1. 用 `new URL()` 解析；失败或缺 hostname：`WEB_INVALID_URL`。
2. 只允许 `http:` / `https:`；其他协议：`WEB_UNSUPPORTED_PROTOCOL`。
3. 拒绝 URL 中的 username/password。
4. 拒绝 loopback、私有、链路本地、保留地址与云元数据地址：
   - IPv4：`0.0.0.0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.168/16`、`198.18/15`、`224/4`、`240/4` 等；
   - IPv6：`::`、`::1`、`fc00::/7`、`fe80::/10`、IPv4-mapped 私有地址等。
5. 对 hostname 做 DNS 解析，任一解析结果为上述地址即拒绝：`WEB_BLOCKED_ADDRESS`。
6. 每一跳重定向都重新执行 1～5；不能只校验初始 URL。
7. DNS rebinding：预解析覆盖常见场景，但不能完全消除“解析后换地址”。首版记录残余风险；生产要求强保证时用固定解析地址的 undici dispatcher。

### 4.3 重定向

- 手动重定向（`redirect: 'manual'`），自己跟随并校验 `Location`。
- 最多 `maxRedirects` 跳；超限：`WEB_REDIRECT_LIMIT`。
- 重定向目标必须是绝对或可解析的 HTTP(S) URL；相对地址按当前 URL 解析。
- 不携带 Cookie；不自动添加 Authorization。
- 跨协议降级（https → http）默认拒绝；确需允许时由部署显式配置。

### 4.4 请求头与超时

- `User-Agent` 可配置，默认 `micro-harness/<version>`；不使用伪装浏览器标识。
- `Accept` 只声明可处理的文本类型；不发送 `Authorization`、Cookie 或 Referer。
- 超时由 provider 与 tool 双重控制；超时：`WEB_TIMEOUT`，`retryable = true`。
- 连接、TLS、DNS 失败：`WEB_FETCH_FAILED`，`retryable = true`。

### 4.5 状态码与内容类型

- 只接受最终 `2xx`；其余状态：`WEB_HTTP_STATUS`。
- `408`、`425`、`429`、`5xx` 标记 `retryable = true`；其他 `4xx` 为 false。
- 允许的内容类型：
  - `text/*`
  - `application/xhtml+xml`
  - `application/json`、`+json`
  - `application/xml`、`+xml`
  - `application/pdf`（仅当 PDF 抽取器开启）
- 其他类型（图片、压缩包、二进制）：`WEB_UNSUPPORTED_CONTENT_TYPE`。
- 缺少 `Content-Type` 时按 `text/plain` 处理，但仍受大小与解码限制。
- 对 HTML 做基本嗅探；`Content-Type` 与内容明显不符时按二进制拒绝，避免把图片当正文。

### 4.6 大小、解码与截断

| 配置 | 作用 | 超限行为 |
| --- | --- | --- |
| `maxResponseBytes` | 限制网络读取的原始字节 | 立即中止并报 `WEB_TOO_LARGE` |
| `maxBodyChars` | 限制解码后的正文字符 | 截断并设置 `truncated: true` |
| `maxOutputChars` | 限制最终交给模型的文本 | 再次截断并加显式标记 |
| `maxRedirects` | 重定向跳数 | `WEB_REDIRECT_LIMIT` |
| `timeoutMs` | 单次请求超时 | `WEB_TIMEOUT` |

- 先检查 `Content-Length`；声明值超限时直接拒绝，不读取 body。
- 流式读取累计实际字节；压缩响应按解压后的读取字节计。
- 按 charset 解码，默认 UTF-8；解码失败使用替换字符，不让请求失败。
- 截断只发生在字符层；字节层永远是硬错误，避免内存无界。
- 不静默截断：渲染结果必须包含 `Truncated: yes` 与实际上限。

### 4.7 可选 render provider

用于 JS 渲染的页面，不用于反爬：

- 候选：Playwright（自托管）、Browserless、Firecrawl。
- 仍然执行 URL/SSRF/robots/限速检查；渲染器不获得额外的网络豁免。
- 资源上限：页面数、内存、单页等待时间、总时长。
- 默认关闭；只有 `render: playwright` 或 `render: firecrawl` 时启用。
- 不实现验证码识别、登录、代理轮换。

### 4.8 robots 与限速边界

`web_fetch` 是**单次传输原语**，不解析 robots.txt。原因：

- robots 是“是否允许抓取某路径”的爬虫策略，需要与域名、路径、UA、缓存和限速一起判断；放在单次传输 provider 里会与 FR-31 的调度职责重复。
- `ctx.crawl` 必须在入队前完成 robots 与域名策略检查，再把允许的 URL 交给 `ctx.web.fetch`。
- 若直接把 `web_fetch` 暴露给模型而不经过 crawl 层，模型就可能抓取被 robots 禁止的路径。

部署边界：

- **默认组合**：`web_fetch` 只作为受控任务内的传输原语；需要面向开放 URL 时，在外层加 robots/域名策略插件，或把 `web_fetch` 标记为仅 crawl 内部使用。
- **直接暴露给模型时**：加一个 `web-policy` 插件，在调用 provider 前执行 robots、域名白/黑名单与限速；该插件不改变工具 schema。

## 5. 正文抽取层设计

### 5.1 为什么单独一层

- `fetch` 只负责拿到字节；正文边界、导航/广告去除、元数据解析是独立问题。
- 抽取器可以替换：本地 Readability、Trafilatura、Jina Reader、Firecrawl、Tavily Extract。
- 抽取结果需要稳定的 schema 和 content hash，供去重、缓存、证据绑定使用。
- 把抽取放在 provider 里会让“换搜索/换抓取”牵连正文逻辑；单独一层可以独立测试。

### 5.2 ExtractedDocument 契约

```ts
export interface ExtractedDocument {
  readonly requestedUrl: string
  readonly finalUrl: string
  readonly canonicalUrl?: string
  readonly title: string
  readonly byline?: string
  readonly publishedAt?: string
  readonly updatedAt?: string
  readonly language?: string
  readonly siteName?: string
  readonly excerpt?: string
  readonly markdown: string
  readonly text: string
  readonly links: readonly { url: string; text?: string }[]
  readonly images: readonly { url: string; alt?: string }[]
  readonly contentHash: string
  readonly wordCount: number
  readonly truncated: boolean
  readonly extractor: { readonly id: string; readonly version: string }
  readonly quality: { readonly score: number; readonly signals: readonly string[] }
}
```

规则：

- `markdown` 是模型可见的主正文；`text` 是去格式版本，供检索/哈希。
- `contentHash` 用规范化 `text` 的 SHA-256；用于跨 URL 去重与变更检测。
- `publishedAt`/`updatedAt` 只接受可解析的时间；不确定时不猜。
- `quality.score` 为 0–1；低于阈值时标记 `low_quality`，不直接丢弃，由上层决定。
- `truncated` 表示字符上限截断；字节上限仍是硬错误。

### 5.3 抽取流水线

```text
Content-Type
  ├─ text/html ──→ HTML parse → boilerplate removal → main content
  │                 → metadata (JSON-LD/OG/meta/time)
  │                 → Markdown → links/images absolutize
  │                 → text normalize → content hash → quality score
  ├─ application/pdf ──→ PDF text extractor（可选）
  ├─ text/plain|json|xml ──→ 直接规范化
  └─ 其他 ──→ WEB_UNSUPPORTED_CONTENT_TYPE
```

正文抽取步骤：

1. 解析 HTML；移除 `script`、`style`、`noscript`、`template`、`svg`、隐藏节点。
2. 用 Readability 类算法找主体；失败时退回启发式（`article`、`main`、最大文本块）。
3. 去导航、页脚、侧栏、评论、分享按钮、cookie 横幅。
4. 解析元数据：`<title>`、`og:*`、`twitter:*`、JSON-LD、`<time>`、`meta[name=author]`、`link[rel=canonical]`。
5. 相对链接/图片转绝对 URL；保留链接文本。
6. 转 Markdown；折叠连续空行；保留标题层级、列表、引用、代码块。
7. 计算 text 与 hash；统计质量信号（正文长度、段落数、链接密度、标题/日期是否存在）。
8. 按 `maxOutputChars` 截断并标记。

### 5.4 抽取器候选

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| `@mozilla/readability` + `linkedom` + `turndown` | 本地、免费、确定性、可离线测试 | 不执行 JS；复杂站点需调参 | **P4 默认** |
| Trafilatura | 正文质量高、支持多语言 | Python sidecar；部署复杂 | 质量优先时可选 |
| Jina Reader | Markdown 质量好、支持 PDF/图片 | 外部服务、按 token、隐私 | PDF/JS 回退 |
| Firecrawl | JS 渲染、Markdown、结构化抽取 | 外部服务、按 credit | JS 重站点 |
| Tavily Extract | 与 Tavily 搜索复用 | 外部服务、按页 | 已有 Tavily 时 |
| Exa Contents | text/highlights/summary | 外部服务、按内容类型 | 研究场景 |

**安全约束**：外部抽取服务如果自己按 URL 抓取，必须在发送前执行与 `fetch-http` 相同的 URL/SSRF 策略；内网/私有 URL 一律不发送给外部服务。默认 allowlist 只允许公网 HTTP(S)。

### 5.5 `web_fetch` 输出重设计

模型可见 schema 仍然只有 `url`：

```ts
parameters: {
  url: {
    type: 'string',
    description: 'Public HTTP(S) URL to fetch. Returns extracted body text and metadata.',
    required: true,
  },
}
```

部署配置决定输出模式：

- `fetchMode: 'extract'`（默认）：返回正文 Markdown + 元数据。
- `fetchMode: 'raw'`：返回原始 HTML/文本，仅调试或后续抽取管线使用。
- `fetchMode: 'text'`：轻量 HTML→纯文本，无 Readability；作为抽取失败的回退。

渲染示例：

```text
Fetched: https://example.com/news/switch-2-delay
Status: 200
Content-Type: text/html; charset=utf-8
Title: Nintendo delays Switch 2 in Japan
Site: Example News
Published: 2026-11-10T09:00:00+09:00
Fetched-At: 2026-11-12T10:30:00.000Z
Language: en
Truncated: no
Content-Hash: sha256:9f2c...

# Nintendo delays Switch 2 in Japan

Nintendo said on Monday that the launch would move to...
```

规则：

- `requestedUrl` 与 `finalUrl` 不同时，额外输出 `Requested:`。
- 正文放在独立文本块；元数据与正文之间空行分隔。
- 截断时输出 `Truncated: yes (maxOutputChars=50000)`。
- 不输出 provider 原始 JSON、响应头、Cookie、API key。
- 工具结果写入 session 时保存规范化 `WebDocument`；模型只看到渲染文本。
- 长页面按 `maxOutputChars` 截断；后续可增加 `focus` 参数做定向片段抽取，但不在 P4 首版暴露。

实现位置（目标）：`packages/web/src/web-tools/web-fetch/`；`web_fetch` 只消费 `ctx.web.fetch()` / extract 结果，不直接 import `fetch-http.ts` 或 `extract-*`。

### 5.6 失败与回退

| 情况 | 行为 |
| --- | --- |
| Readability 抽不出正文 | 回退 `text` 模式；仍为空则 `WEB_EXTRACT_FAILED` |
| 页面是登录墙/付费墙/验证码 | `WEB_ACCESS_RESTRICTED`；不尝试绕过 |
| 页面需要 JS | 有 render provider 时重试一次；否则返回原始文本/错误 |
| PDF | 有 PDF 抽取器时抽取；否则 `WEB_UNSUPPORTED_CONTENT_TYPE` |
| 外文编码 | 按 charset 解码；失败用替换字符 |
| 正文过短/质量低 | 成功返回，但标记 `low_quality`，由上层决定是否使用 |

### 5.7 片段与证据绑定

```ts
export interface Passage {
  readonly id: string            // passage:<documentId>:<start>-<end>
  readonly documentId: string
  readonly start: number
  readonly end: number
  readonly text: string
  readonly hash: string
}
```

- 以段落/句子为边界切分，保留 `start/end` 偏移。
- `Claim` 只绑定 `Passage`，不直接绑定“整页摘要”。
- 报告引用至少包含：`finalUrl`、`fetchedAt`、`contentHash`、原文片段。
- 只有 `snippet` 不足以作为证据（NFR-10、FR-39）。

## 6. 视频内容采集设计（后续）

### 6.1 范围

- **V0**：视频元数据（标题、频道、发布时间、时长、简介、缩略图）。
- **V1**：已有字幕/转写稿（官方 API 或页面提供的 caption）。
- **V2**：ASR 回退（下载允许的音频 → Whisper 等转写）。
- **V3**：关键帧/OCR/场景摘要（可选，成本高）。

明确不做：

- 绕过 DRM、付费墙、登录、地区限制。
- 下载/转写未授权内容用于再分发。
- 用非官方接口大规模抓取平台字幕而不做合规评估。

### 6.2 MediaDocument 契约

```ts
export interface TranscriptSegment {
  readonly start: number       // 秒
  readonly end: number
  readonly text: string
  readonly speaker?: string
}

export interface MediaDocument {
  readonly platform: 'youtube' | 'bilibili' | 'vimeo' | 'other'
  readonly videoId: string
  readonly url: string
  readonly title: string
  readonly channel?: string
  readonly publishedAt?: string
  readonly durationSec?: number
  readonly description?: string
  readonly thumbnailUrl?: string
  readonly language?: string
  readonly transcript: readonly TranscriptSegment[]
  readonly transcriptSource: 'official' | 'page' | 'asr' | 'none'
  readonly keyframes?: readonly { atSec: number; imageUrl?: string; ocrText?: string }[]
  readonly fetchedAt: number
  readonly contentHash?: string
}
```

### 6.3 流水线

```text
URL
  → 平台识别（域名/URL 模式/oEmbed）
  → 元数据 provider（官方 API 优先）
  → 字幕发现（官方 caption / 页面 caption track）
  → 字幕归一化（时间轴、语言、去重）
  → 可选 ASR（仅允许的内容）
  → 可选关键帧/OCR
  → MediaDocument + Passage（按时间段）
```

### 6.4 provider 候选

| 平台/方案 | 元数据 | 字幕/转写 | 合规/限制 | 建议 |
| --- | --- | --- | --- | --- |
| YouTube Data API v3 | 官方、稳定 | `captions.download` 仅自有/有权限视频 | 10k units/天；`search.list` 100 次/天 | 元数据首选 |
| YouTube 第三方字幕 | 非官方 | 公共视频字幕 | ToS/限流/云 IP 封锁 | 仅合规评估后 |
| Bilibili | 内部 API | WBI 签名 + 登录；无官方字幕 API | ToS/登录/稳定性 | 受限，默认不做 |
| Vimeo API | 官方 | 字幕能力有限 | OAuth | 备选 |
| TikTok Research API | 官方 | 研究用途 | 学术申请 | 研究场景 |
| yt-dlp + Whisper | 自托管 | 可下载允许的音频并转写 | ToS/版权/成本 | 可选 ASR 回退 |
| Apify/HasData 等 | 第三方 | 元数据/字幕 | 付费/ToS | 非默认 |

### 6.5 限制与合规

- 时长上限（如 2 小时）、音频字节上限、转写分钟数上限、单任务成本上限。
- 字幕保留时间轴，便于引用“某视频 12:30–13:10”。
- 转写内容标注 `transcriptSource=asr`，不能冒充官方字幕。
- 不存储完整视频；音频临时文件用完即删。
- 版权/隐私：只处理允许抓取的内容；报告引用链接与时间点，不复制大段字幕。

### 6.6 工具面

- `web_search` 增加 `mediaType: 'videos'`（P12，路由到 Brave Videos / YouTube Search）。
- 新增 `video_probe`：只取元数据，不转写。
- 新增 `video_transcript`：取字幕/转写；无字幕时按配置决定是否 ASR。
- 不把视频塞进 `web_fetch` 的返回体；`web_fetch` 遇到视频页面只返回页面正文/元数据，并提示使用 `video_*`。

## 7. 深度采集与调度（`ctx.crawl`）

### 7.1 职责

- 维护 frontier：URL 状态、优先级、重试次数、发现来源。
- 调度：全局并发 + 每域名并发/速率 + robots 门禁 + 背压。
- 去重：URL 规范化、canonical、内容哈希、ETag/Last-Modified。
- 重试与退避：按错误分类。
- 持久化与续跑：进程重启不重复抓取、不丢结果。
- 预算：页数、字节、token、时间、成本。
- 事件：向抽取/索引/agent 消费者广播。

### 7.2 Frontier 数据模型

```ts
export type UrlState = 'pending' | 'inflight' | 'done' | 'failed' | 'skipped' | 'blocked'

export interface FrontierEntry {
  readonly url: string
  readonly normalizedUrl: string
  readonly canonicalUrl?: string
  readonly state: UrlState
  readonly priority: number
  readonly depth: number
  readonly discoveredFrom: {
    readonly type: 'search' | 'sitemap' | 'rss' | 'link' | 'manual' | 'media'
    readonly ref: string
  }
  readonly attempts: number
  readonly nextEligibleAt?: number
  readonly lastError?: { readonly code: string; readonly retryable: boolean }
  readonly contentHash?: string
  readonly etag?: string
  readonly lastModified?: string
  readonly fetchedAt?: number
}
```

状态机：

```text
pending → inflight → done
              ├→ failed（可重试 → pending；不可重试 → failed）
              ├→ skipped（重复/低质量/越界）
              └→ blocked（robots/域名策略/访问限制）
```

### 7.3 站点发现

优先级从高到低：

1. 官方 API / RSS / Atom / sitemap（FR-24、Q-23）。
2. 搜索引擎结果（`web_search`）。
3. 已抓取页面的链接扩展（同域/深度限制）。
4. canonical / hreflang / alternate / 分页（`rel=next`）。
5. 人工种子。

每个 URL 记录 `discoveredFrom`，报告中可以回答“这个来源是怎么发现的”。

### 7.4 调度、限速与背压

- 全局并发 `concurrency`；每域名并发 `perDomainConcurrency`；每域名速率 `perDomainRps`。
- 全局令牌桶 + 每域名令牌桶；robots `Crawl-delay` 取更严格者。
- 优先级：来源权威性 + 查询相关性 + 新鲜度 - 深度惩罚。
- 队列有界；满时停止发现或丢弃最低优先级，并记录 `crawl/budget` 事件。
- 单域名失败不影响其他域名（NFR-15）。
- 所有定时器/在途请求通过 `ctx.effect()` 绑定生命周期，卸载时中止（NFR-2）。

### 7.5 去重

| 层级 | 方法 | 说明 |
| --- | --- | --- |
| URL | 规范化 + 跟踪参数移除 | 同一资源不同写法 |
| 声明 | `link[rel=canonical]` | 尊重站点 canonical |
| 内容 | SHA-256(text) | 完全相同/近似相同正文 |
| 近似 | SimHash/MinHash | 转载、通稿、模板差异 |
| 增量 | ETag / Last-Modified | 二次抓取只处理变化 |
| 跨来源 | 聚类 | 同一事件多篇报道保留来源集合（FR-40） |

去重只影响“是否重复处理”，不删除来源关系；报告中保留 aliases。

### 7.6 持久化与续跑

```ts
export interface CrawlStore {
  enqueue(entry: FrontierEntry): Promise<void>
  lease(workerId: string, limit: number): Promise<FrontierEntry[]>
  complete(url: string, result: { contentHash: string; documentId: string }): Promise<void>
  fail(url: string, error: { code: string; retryable: boolean }, nextEligibleAt?: number): Promise<void>
  stats(runId: string): Promise<CrawlStats>
  resume(runId: string): Promise<void>
}
```

建议：

- 首版用 SQLite（Node 24 自带 `node:sqlite`；若实验性 API 不稳定则 `better-sqlite3`），WAL 模式。
- 表：`frontier`、`documents`、`domains`、`robots_cache`、`runs`。
- `inflight` 带 lease 过期时间；进程崩溃后过期任务回到 `pending`。
- 也可先用 JSONL 追加日志做 MVP，但 FR-27 要求续跑，SQLite 更合适。
- 文档正文与快照可以放文件系统，数据库只存元数据与哈希。

### 7.7 预算与停止条件

- `maxPages`、`maxBytes`、`maxTokens`、`maxSeconds`、`maxCostUsd`。
- 到达上限：停止发现，完成在途任务，产出部分结果 + 缺口报告。
- 每个子代理、每次 run、每个 provider 都有独立预算；成本可归因到任务（NFR-13）。
- 超预算不是“静默截断”：必须在运行记录与报告中标记。

### 7.8 事件

| 事件 | 何时 | 消费者 |
| --- | --- | --- |
| `crawl/queued` | URL 入队 | 指标、调试 |
| `crawl/leased` | worker 取到任务 | 指标 |
| `crawl/fetched` | 抓取完成 | 抽取器 |
| `crawl/extracted` | 正文抽取完成 | 索引、agent、知识库 |
| `crawl/failed` | 最终失败 | 质量报告、缺口分析 |
| `crawl/skipped` | 重复/越界/robots | 审计 |
| `crawl/budget` | 预算变化/耗尽 | 编排器 |
| `crawl/stats` | 周期统计 | CLI、报告 |

用 `ctx.parallel()` 等待消费者，形成背压；用 `ctx.emit()` 发指标，不等待。

### 7.9 增量采集

- 条件请求：`If-None-Match` / `If-Modified-Since`。
- 304 或内容哈希未变：只更新 `lastSeenAt`，不重新抽取/不重复进入上下文。
- 变更检测：内容哈希变化时生成新 `Document` 版本，保留旧版本。
- 域名 TTL：新闻/博客/官网可配置不同重访周期。
- 二次运行复用未变化文档（FR-32、FR-53）。

### 7.10 robots.txt

- 按 RFC 9309 解析 `User-agent`、`Disallow`、`Allow`、`Crawl-delay`、`Sitemap`。
- 每个 origin 缓存 robots，带 TTL；`ctx.crawl` 统一执行，不交给 `web_fetch`。
- robots 不可达：默认按“暂时允许 + 保守限速”处理，并记录；可配置为严格拒绝。
- 被禁止的 URL 进入 `blocked`，不重试；报告中记录原因。
- 不绕过 401/403/451/验证码/付费墙。

## 8. 多子代理采集架构

### 8.1 为什么是“混合”而不是“全 agent”

- **逐 URL 抓取不适合用 agent**：成本高、慢、不可控；用确定性 worker pool。
- **查询生成、来源取舍、阅读摘要、交叉验证、报告写作适合用 agent**：需要判断与语言理解。
- **调度与限速必须集中**：子代理各自抓取会绕过全局并发/域名限速，导致被封。
- 因此：`ctx.crawl` 是共享的确定性内核；子代理是受预算约束的“认知 worker”。

### 8.2 角色分工

| 角色 | 职责 | 输入 | 输出 | 工具 | 限制 |
| --- | --- | --- | --- | --- | --- |
| **Orchestrator** | 拆解目标、分配预算、选择来源、决定终止/补采 | objective、约束、预算 | plan、final result | `plan`、`spawn`、`search`、`crawl_status` | maxSteps 12；maxSubagents 6；总 deadline |
| **Query Scout** | 生成查询变体、跨引擎搜索、候选去重 | 子问题、语言、来源提示 | `CandidateSet` | `web_search` | 1–3 查询；最多 50 候选 |
| **Reader** | 抓取/抽取/摘要/定位片段 | URL 批次、抽取 schema | `DocumentDigest` + passages | `web_fetch`、`knowledge_write` | 每批 5–10 URL；单页 1–2 步 |
| **Media Analyst** | 视频元数据、字幕/转写 | 视频 URL/主题 | `MediaDocument` | `video_probe`、`video_transcript` | 时长/字节/成本上限 |
| **Verifier** | claim ↔ passage 校验、冲突标记 | claims、passages | `Verification` | `knowledge_query`、必要时 `web_search` | 不重复抓已抓页面 |
| **Synthesizer** | 时间线、证据表、报告 | 全部 artifacts | `Report` | `knowledge_query`、`report_write` | 不引入无来源事实 |

### 8.3 拓扑与生命周期

```text
Orchestrator
  ├─ Scout(zh) ─┐
  ├─ Scout(en) ─┼→ CandidatePool → ReaderPool(4) → DocumentDigest[]
  └─ Scout(site)┘                         │
                                          ▼
                                    VerifierPool(2)
                                          │
                                          ▼
                                    Synthesizer → Report
```

规则：

- Scout 并行；Reader 并行但受 `ctx.crawl` 的全局/域名限速约束。
- 最大深度 2：Orchestrator → worker；worker 不允许再 spawn 子代理。
- 最大 fanout 6；最大并发子代理 4–8（可配置）。
- 每个子代理有自己的 session、system prompt、工具子集与预算。
- Orchestrator 可在第一波结果后**重规划一次**（补查询/补来源），然后必须收敛。
- 父级 `AbortSignal` 取消时，所有子代理与在途抓取一并中止。

### 8.4 子代理通信协议

子代理之间不自由聊天；只交换结构化 artifact：

```ts
export interface Artifact<T> {
  readonly id: string
  readonly taskId: string
  readonly parentId?: string
  readonly agentId: string
  readonly type:
    | 'candidate_set'
    | 'document_digest'
    | 'media_document'
    | 'verification'
    | 'report'
    | 'gap'
  readonly schemaVersion: 1
  readonly createdAt: string
  readonly provenance: {
    readonly urls: readonly string[]
    readonly toolCalls: number
    readonly model: string
    readonly promptVersion: string
  }
  readonly payload: T
}
```

- `CandidateSet`：`{ query, sources[], rationale }`。
- `DocumentDigest`：`{ documentId, title, publishedAt, keyPassages[], entities[], claimsDraft[] }`。
- `Verification`：`{ claimId, stance, evidencePassageIds[], confidence, notes }`。
- `Report`：`{ summary, timeline[], evidenceTable[], gaps[], citations[] }`。

共享黑板（P8 可先用内存，P9 换持久化）：

```ts
export interface ResearchStore {
  put(artifact: Artifact<unknown>): Promise<void>
  get(id: string): Promise<Artifact<unknown> | undefined>
  query(type: string, filter?: Record<string, unknown>): Promise<Artifact<unknown>[]>
  link(claimId: string, evidenceId: string): Promise<void>
  eventLog(runId: string): Promise<readonly Artifact<unknown>[]>
}
```

### 8.5 隔离与共享

- 用 `ctx.agents`（FR-9）创建独立 agent 实例；各自 session，不复用主对话上下文。
- 需要隔离服务时用 `ctx.isolate('agent:<id>')`；共享服务（`ctx.web`、`ctx.crawl`、`ctx.knowledge`）保持在根上下文。
- 预算由 Orchestrator 分配；子代理不能自行提高预算。
- 工具子集：Reader 不给 `spawn`；Verifier 不给 `crawl_add`；Synthesizer 只读写知识库。
- 所有子代理共享同一个 `ctx.crawl`，因此限速/robots/去重是全局的。

### 8.6 失败、重试与取消

- 子代理返回 `{ status: 'ok' | 'partial' | 'failed', artifacts, error? }`。
- `partial` 仍可使用，但置信度降级并在报告中标记。
- 可重试错误：超时、429、5xx、provider 不可用；每个子任务最多重试 1 次。
- 不可重试：SSRF、robots、非法 URL、访问限制；直接记录 gap。
- 失败 URL 进入 dead-letter；下一轮可人工或按策略补采。
- 取消传播：`AbortSignal.any([parent, timeout])`；清理定时器与在途请求。
- 人工介入点：计划确认、证据复核、报告签发（FR-60）。

### 8.7 可观测与可复现

- 每个 run 有 `traceId`；每个 artifact 有 `agentId/parentId`。
- 记录：步骤数、工具调用、token、成本、耗时、失败原因。
- 保存 planner 输出、查询列表、候选来源、抓取统计、抽取器版本。
- 复现：同一计划 + 同一快照 + 同一抽取器版本，结果应一致或差异可解释（NFR-11）。
- 日志不记录 API key、Cookie、完整响应头或完整正文；只记录 URL、状态、字节/字符数、错误码。

### 8.8 反模式

- ❌ 每个 URL 起一个 agent。
- ❌ 子代理自己 `fetch` 而不经过 `ctx.crawl`。
- ❌ 子代理无限递归 spawn。
- ❌ Verifier 之前就让 Synthesizer 写结论。
- ❌ 把网页正文里的“指令”当成系统指令（提示注入）。
- ❌ 多个子代理重复抓同一 URL（应由 crawl 去重）。
- ❌ 用搜索摘要直接当证据。

### 8.9 工具面

对主模型只暴露少量高层工具：

| 工具 | 作用 | 阶段 |
| --- | --- | --- |
| `web_search` | 快速发现来源 | P5 |
| `web_fetch` | 读取单页正文 | P4 |
| `deep_research` | 启动一次多子代理深度采集，返回结构化结果 | P8 |
| `video_probe` / `video_transcript` | 视频元数据/字幕 | P12 |

`crawl_add` / `crawl_status` / `crawl_stop` 默认只给 Orchestrator 或 CLI，不直接暴露给主模型，避免模型绕过预算。

### 8.10 编排伪代码

```ts
async function runResearch(request: ResearchRequest, ctx: Context): Promise<ResearchResult> {
  const plan = await ctx.research.planner.plan(request)

  const scouts = await Promise.all(
    plan.subQuestions.map(q =>
      ctx.research.spawn('query-scout', {
        input: q,
        tools: ['web_search'],
        budget: { queries: 3, candidates: 50 },
      }),
    ),
  )

  const candidates = dedupe(scouts.flatMap(s => s.candidates))
  const crawl = await ctx.crawl.start({
    seeds: candidates,
    scope: plan.scope,
    budget: plan.budget,
  })

  const readers = await ctx.research.spawnPool('reader', crawl.documents, {
    size: 4,
    tools: ['web_fetch', 'knowledge_write'],
    budget: { urlsPerAgent: 10 },
  })

  const claims = readers.flatMap(r => r.claimsDraft)
  const verifications = await ctx.research.spawnPool('verifier', claims, {
    size: 2,
    tools: ['knowledge_query'],
  })

  return ctx.research.synthesizer.run({ plan, candidates, readers, verifications })
}
```

## 9. 统一错误与重试

### 9.1 错误码扩展

在现有 `WebErrorCode` 上增加：

```ts
| 'WEB_ROBOTS_DENIED'
| 'WEB_RATE_LIMITED'
| 'WEB_EXTRACT_FAILED'
| 'WEB_ACCESS_RESTRICTED'
| 'WEB_MEDIA_UNSUPPORTED'
| 'WEB_TRANSCRIPT_UNAVAILABLE'
| 'WEB_BUDGET_EXCEEDED'
| 'WEB_CANCELLED'
| 'WEB_PROVIDER_QUOTA'
| 'WEB_RENDER_FAILED'
```

### 9.2 重试矩阵

| 场景 | 错误码 | retryable | 是否回退 provider |
| --- | --- | --- | --- |
| 没有可用 provider / 配置的 provider 不存在 | `WEB_PROVIDER_UNAVAILABLE` | false | 是（下一个 provider） |
| 多个可用 provider 且未配置 | `WEB_PROVIDER_AMBIGUOUS` | false | 否 |
| URL 解析失败 / 缺 hostname | `WEB_INVALID_URL` | false | 否 |
| `file:`、`ftp:`、`data:` 等 | `WEB_UNSUPPORTED_PROTOCOL` | false | 否 |
| 私有、回环、链路本地、元数据地址 | `WEB_BLOCKED_ADDRESS` | false | 否 |
| robots 禁止 | `WEB_ROBOTS_DENIED` | false | 否 |
| 重定向超限或目标非法 | `WEB_REDIRECT_LIMIT` | false | 否 |
| 超时 | `WEB_TIMEOUT` | true | 是 |
| 4xx（除 408/425/429） | `WEB_HTTP_STATUS` | false | 否 |
| 408/425/429/5xx | `WEB_HTTP_STATUS` / `WEB_RATE_LIMITED` | true | 是（退避后） |
| 非文本内容类型 | `WEB_UNSUPPORTED_CONTENT_TYPE` | false | 否 |
| 超过 `maxResponseBytes` | `WEB_TOO_LARGE` | false | 否 |
| 正文抽取失败 | `WEB_EXTRACT_FAILED` | true（换抽取器） | 是（换抽取器，不是同 provider） |
| 登录/付费墙/验证码 | `WEB_ACCESS_RESTRICTED` | false | 否 |
| 视频/媒体不支持 | `WEB_MEDIA_UNSUPPORTED` | false | 否 |
| 无字幕且未启用 ASR | `WEB_TRANSCRIPT_UNAVAILABLE` | false | 否 |
| 预算耗尽 | `WEB_BUDGET_EXCEEDED` | false | 否（停止） |
| 调用方取消 | `WEB_CANCELLED` | false | 否 |
| provider 配额耗尽 | `WEB_PROVIDER_QUOTA` | false | 是（下一个 provider） |
| 渲染失败 | `WEB_RENDER_FAILED` | true | 是（换渲染器） |

规则：

- `retryable` 只表达“重试可能成功”，不保证一定成功。
- provider 不自动重试；由 crawl/路由层统一退避，避免多层重试放大流量。
- 回退只发生在 provider 级错误；政策错误（SSRF、robots、非法 URL）绝不回退。
- 错误信息面向模型/用户：说明失败操作、URL/query、provider id、HTTP 状态；不含密钥与完整响应头。
- tool 错误交给 `ctx.tools` 转成 `isError: true` 的 tool message（FR-4）。

## 10. 安全、合规与提示注入

### 10.1 网络安全

| 风险 | 措施 |
| --- | --- |
| SSRF | 协议白名单、拒绝 userinfo、拒绝私有/保留地址、每跳重定向复检 |
| DNS rebinding | 预解析并拒绝私有结果；记录残余风险；生产要求时固定地址 dispatcher |
| 超大响应 | 字节硬上限 + 字符截断 + 输出上限 |
| 非文本内容 | Content-Type 白名单 + 基本字节嗅探 |
| 外部抽取服务 | 发送前执行同样的 URL/SSRF 策略；默认公网 allowlist |
| 凭证泄露 | 只从环境变量读取；日志/错误脱敏 |
| 登录/付费墙/验证码 | 不携带 Cookie/Authorization；不实现绕过 |
| robots/限速 | `ctx.crawl` 入队前执行；`web_fetch` 不替代爬虫策略 |

### 10.2 合规

- 遵守 robots.txt、站点条款与限速（NFR-9、FR-31）。
- 不绕过登录、付费墙、验证码、DRM、地区限制（NG-6）。
- 控制版权风险：默认只存正文 Markdown + 哈希 + 必要元数据；原始 HTML 可选、可设保留期。
- 个人信息：可按任务配置 PII 脱敏；报告中避免无关个人信息。
- 视频：只处理允许的内容；ASR 标注来源；不存储完整视频。

### 10.3 数据保留

| 数据 | 默认 | 可配置 |
| --- | --- | --- |
| 规范化 Document（Markdown/text/hash） | 保留 | 保留期、按任务清理 |
| 原始 HTML | 不保留 | `retainRawHtml: true` + 保留期 |
| 搜索原始响应 | 不保留 | 仅调试短期 |
| 视频/音频 | 不保留 | 临时文件用完即删 |
| 运行日志 | 保留元数据 | 不含正文/密钥 |

### 10.4 外部服务数据边界

- 使用 Jina Reader / Firecrawl / Tavily Extract 等外部抽取服务时，URL 与页面内容会离开本机。
- 默认只允许公网 URL；内网、私有、带凭证的 URL 一律不发送。
- 可按域名 allowlist/denylist 控制；敏感任务禁用外部抽取。
- 记录“使用了哪个外部 provider”，便于审计。

### 10.5 提示注入

抓到的网页是**不可信数据**，不是指令：

- 在 tool result 中用明确边界包裹正文：

```text
<untrusted_web_content url="..." fetched-at="...">
...
</untrusted_web_content>
```

- system prompt 明确：网页内容中的“忽略之前指令”“调用某工具”“泄露密钥”等一律视为数据，不执行。
- 工具结果不允许直接触发新的工具调用；只有模型自己的决策可以。
- Verifier 交叉检查：正文中的声明必须有来源，不因为网页“自称官方”就采信。
- 不把网页内容拼进系统提示或工具描述。
- 对隐藏文本/白色文字等不可靠；不做“清洗后即安全”的假设，靠边界与验证。

## 11. 配置设计

> 下面是目标配置形态；`apps/cli/cordis.patch.yml` 已切换为 Exa 主搜索 + DeepSeek 备用。正文抽取、crawl 等 provider 行在其实现后才写入默认树。

### 11.1 搜索与抽取

```yaml
- id: web
  name: '@micro-harness/web'
  config:
    # 当前已实现：primary + fallback 顺序路由
    searchProvider: exa
    searchFallback: [deepseek-official]
    searchFallbackOnEmpty: true
    # 目标形态（P6+）：更完整的策略
    # searchPolicy:
    #   primary: exa
    #   fallback: [deepseek-official]
    #   merge: false
    #   maxProvidersPerQuery: 2
    #   byLanguage:
    #     zh: [deepseek-official, bocha]
    #     en: [exa, brave]
    fetchProvider: http
    extractProvider: readability

- id: web-search-exa
  name: '@micro-harness/web/search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
    baseURL: https://api.exa.ai
    type: auto          # auto | lite | deep-lite | deep
    numResults: 10
    highlights: true
    highlightsMaxCharacters: 400
    timeoutMs: 30000
    maxResponseBytes: 1048576

- id: web-search-deepseek
  name: '@micro-harness/web/search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: https://api.deepseek.com
    path: /v1/tools/search
    count: 10
    needContent: false
    timeoutMs: 30000
    maxResponseBytes: 1048576

- id: web-fetch-http
  name: '@micro-harness/web/fetch-http'
  config:
    maxResponseBytes: 5242880
    maxBodyChars: 100000
    timeoutMs: 30000
    maxRedirects: 5
    userAgent: micro-harness/0.0.0
    allowPdf: false

- id: web-extract-readability
  name: '@micro-harness/web/extract-readability'
  config:
    maxOutputChars: 50000
    minTextChars: 200
    qualityThreshold: 0.3
```

### 11.2 深度采集与多子代理

```yaml
- id: crawl
  name: '@micro-harness/crawl'
  config:
    concurrency: 8
    perDomainConcurrency: 2
    perDomainRps: 1
    maxRedirects: 5
    maxAttempts: 3
    maxPages: 200
    maxBytes: 209715200
    maxSeconds: 1800
    robots: true
    state: sqlite
    statePath: .mh/crawl.db
    userAgent: micro-harness/0.0.0

- id: research
  name: '@micro-harness/research'
  config:
    maxSubagents: 6
    maxDepth: 2
    maxStepsPerAgent: 8
    maxConcurrentReaders: 4
    maxConcurrentVerifiers: 2
    budget:
      pages: 200
      tokens: 500000
      minutes: 30
      costUsd: 5

- id: media
  name: '@micro-harness/media'
  config:
    enabled: false
    maxDurationSec: 7200
    maxAudioBytes: 209715200
    maxTranscriptChars: 200000
    asr: false
```

### 11.3 默认值

| 配置 | 默认 | 说明 |
| --- | ---: | --- |
| `searchMaxResults` | 8 | 模型可见来源上限 |
| `searchTimeoutMs` | 60 s | 工具级搜索超时 |
| `maxResponseBytes` | 5 MiB | 网络字节硬上限 |
| `maxBodyChars` | 100,000 | 解码后正文上限 |
| `maxOutputChars` | 50,000 | 模型可见输出上限 |
| `fetchTimeoutMs` | 30 s | 抓取超时 |
| `maxRedirects` | 5 | 重定向跳数 |
| `minTextChars` | 200 | 低于此值标记低质量 |
| `concurrency` | 8 | 全局抓取并发 |
| `perDomainConcurrency` | 2 | 单域名并发 |
| `perDomainRps` | 1 | 单域名速率 |
| `maxPages` | 200 | 单任务页数上限 |
| `maxAttempts` | 3 | 重试次数 |
| `maxSubagents` | 6 | 单次研究子代理上限 |
| `maxDepth` | 2 | 代理递归深度 |
| `maxDurationSec` | 7,200 | 视频时长上限 |

限制只能由部署配置提高或降低；模型参数不能覆盖。

## 12. 数据模型与可追溯

### 12.1 核心实体

```ts
export interface Source {
  readonly id: string
  readonly url: string
  readonly finalUrl: string
  readonly canonicalUrl?: string
  readonly title: string
  readonly siteName?: string
  readonly publishedAt?: string
  readonly fetchedAt: number
  readonly contentType?: string
  readonly contentHash: string
  readonly provider?: string
}

export interface Document {
  readonly id: string
  readonly sourceId: string
  readonly title: string
  readonly byline?: string
  readonly publishedAt?: string
  readonly language?: string
  readonly markdown: string
  readonly text: string
  readonly contentHash: string
  readonly extractor: { readonly id: string; readonly version: string }
  readonly quality: number
  readonly truncated: boolean
  readonly snapshotPath?: string
}

export interface Claim {
  readonly id: string
  readonly text: string
  readonly type: 'fact' | 'inference' | 'rumor' | 'unknown'
  readonly confidence: number
  readonly evidenceIds: readonly string[]
}

export interface Evidence {
  readonly id: string
  readonly claimId: string
  readonly passageId: string
  readonly sourceId: string
  readonly stance: 'support' | 'refute' | 'neutral'
  readonly quote: string
}
```

### 12.2 ID 与哈希

- `sourceId = source:<sha256(normalizedUrl)>`
- `documentId = doc:<sha256(contentHash + extractorVersion)>`
- `passageId = passage:<documentId>:<start>-<end>`
- `contentHash = sha256(normalize(text))`
- schema 版本化；迁移时保留旧版本与映射（FR-49）。

### 12.3 可追溯要求

- 每个结论至少绑定一个 `Passage`。
- 每个 `Passage` 能回到 `Document` → `Source` → `finalUrl` + `fetchedAt`。
- 报告中每个引用包含 URL、发布时间（若有）、抓取时间、原文片段。
- 抽取器版本、查询、候选来源、抓取统计进入运行记录（FR-59）。
- 支持人工复核：接受/驳回/补充证据留痕（FR-60）。

## 13. 测试策略

### 13.1 离线优先

- 默认 `pnpm test` 不访问外网（NFR-3）。
- 本地 HTTP stub 提供搜索、页面、robots、sitemap、视频页面 fixture。
- 联网测试用环境变量显式开启：`WEB_LIVE=1`、`BRAVE_API_KEY=...` 等。

### 13.2 测试分层

| 层级 | 内容 | 文件建议 |
| --- | --- | --- |
| 单元 | URL 规范化、SSRF 判定、参数校验、渲染、错误映射 | `tests/web-search.spec.ts`、`tests/web-fetch.spec.ts` |
| Provider 契约 | 每个 search/fetch/extract provider 用录制 fixture 验证请求/响应 | `tests/providers/*.spec.ts` |
| 抽取质量 | 新闻页、博客、官网公告、导航密集页、JS 空壳页、付费墙 | `tests/extract.spec.ts` + fixtures |
| 调度 | 并发上限、域名限速、重试、去重、续跑 | `tests/crawl.spec.ts` |
| 多代理 | 角色分工、fanout、预算、取消、部分失败 | `tests/research-agents.spec.ts` |
| 安全 | SSRF、重定向到私有地址、超大响应、提示注入页面 | `tests/web-security.spec.ts` |
| 视频 | 元数据、字幕归一化、无字幕、ASR 开关 | `tests/media.spec.ts` |

### 13.3 关键用例

- 搜索返回 3 条合法来源 → 编号列表，URL 原样保留。
- 搜索来源 URL 重复 → 只保留第一次出现。
- 主 provider 超时、备 provider 成功 → 回退并记录 provider。
- 两个 provider 合并 → URL 去重，RRF 排序稳定。
- 抓取 200 HTML → 返回标题、发布时间、正文 Markdown、contentHash。
- 导航密集页 → 正文不包含菜单/页脚。
- 抽取失败 → 回退 text；仍为空 → `WEB_EXTRACT_FAILED`。
- 404 → `WEB_HTTP_STATUS`，不可重试。
- 500/429 → 可重试，退避。
- 重定向到私有地址 → `WEB_BLOCKED_ADDRESS`。
- 超过字节上限 → `WEB_TOO_LARGE`，不读取完整 body。
- robots 禁止 → `WEB_ROBOTS_DENIED`，不入队。
- 100 个本地 URL 并发抓取 → 内存/连接有界，单域名不超限。
- 中断后重启 → 不重复抓取已完成 URL，frontier 恢复。
- 多代理：3 scouts + 4 readers + 2 verifiers → 不超过预算，artifact 完整。
- 提示注入页面 → 模型不执行页面中的指令，内容被标记为不可信。
- 视频无字幕 + ASR 关闭 → `WEB_TRANSCRIPT_UNAVAILABLE`。

### 13.4 运行命令

```bash
# 现有离线搜索测试
./.local/node/bin/node --import tsx --test tests/web-search.spec.ts

# 后续
./.local/node/bin/node --import tsx --test tests/web-fetch.spec.ts
./.local/node/bin/node --import tsx --test tests/crawl.spec.ts
./.local/node/bin/node --import tsx --test tests/research-agents.spec.ts

# 联网（显式开启）
WEB_LIVE=1 BRAVE_API_KEY=... pnpm test:live
```

## 14. 里程碑与实现顺序

| 阶段 | 交付物 | 完成标准 | 状态 |
| --- | --- | --- | --- |
| P4a | `fetch-http`：SSRF、重定向、超时、Content-Type、字节/字符上限 | 本地 stub 页面可抓取；安全用例通过 | 骨架 |
| P4b | `extract-readability` + `web_fetch` 正文输出 | 新闻页返回标题、时间、正文 Markdown；导航被去除 | 待实现 |
| P5a | 搜索路由 + 第二个 provider（Brave 或 Bocha） | 主备回退、去重、provider 标记 | 待实现 |
| P5b | `web_search` 输出扩展（date/siteName） | 现有测试不破坏；新增字段可选 | 待实现 |
| P8a | `ctx.crawl`：frontier、并发、限速、robots、去重、SQLite 续跑 | 100 页本地站点可抓取；中断可续跑 | 待实现 |
| P8b | `ctx.research`：多子代理编排 + `deep_research` 工具 | 3+4+2 角色可运行；预算/取消/部分失败 | 待实现 |
| P9 | `ctx.knowledge`：Document/Passage/Claim/Evidence | claim → passage → source 可追溯；冲突标记 | 待实现 |
| P12 | `ctx.media`：视频元数据、字幕、可选 ASR/关键帧 | YouTube 元数据 + 允许的字幕；ASR 可开关 | 后续 |
| P6 | 流式、取消、快照、profile 分层、打包 | 回归测试与发布产物 | 后续 |

实现原则：每个阶段只新增 provider/consumer/schema，不修改已稳定的 `ctx.web` 调用方（C-2/C-3）。

## 15. 待确认问题与选择

### 15.1 已收敛的问题

| 编号 | 原问题 | 本设计结论 |
| --- | --- | --- |
| Q-4 | `web_fetch` 输出 HTML、纯文本还是 Markdown？是否做正文抽取？ | **默认正文 Markdown + 元数据**；raw HTML 仅调试；正文抽取是必需能力 |
| Q-5 | 搜索 provider 与官方 API 形态 | Exa Search API 为主、DeepSeek 官方 API 为备；两者均已实现 |
| Q-W1 | 主搜索引擎 | **Exa**（语义搜索，`contents.highlights` 提供查询相关片段） |
| Q-W2 | 备搜索引擎 | **DeepSeek 官方 Search API**（中文回退） |
| Q-7 / Q-22 | 是否引入多 agent | **P8+ 采用混合多子代理**；P4/P5 首版仍是单 agent + 工具 |
| Q-17 | robots、站点条款与存档边界 | robots 在 `ctx.crawl` 执行；不绕过访问控制；原始 HTML 默认不保留 |
| Q-23 | 官方 API / RSS / sitemap / 网页抓取优先级 | 官方 API、RSS、sitemap 优先；网页抓取作为补充 |

### 15.2 需要你选择的问题

| 编号 | 问题 | 建议默认 | 影响 |
| --- | --- | --- | --- |
| ~~Q-W1~~ | ~~主搜索引擎选哪个？~~ | **已定：Exa** | 已实现 `search-exa` |
| ~~Q-W2~~ | ~~备搜索引擎选哪个？~~ | **已定：DeepSeek 官方 API** | 已实现 primary/fallback 路由 |
| Q-W3 | 正文抽取用哪个？ | 本地 Readability；Jina/Firecrawl 按需 | P4b 依赖与成本 |
| Q-W4 | 是否允许第三方 SERP（Serper/SerpAPI）？ | 不允许（ToS/稳定性风险） | Google 结果覆盖 |
| Q-W5 | 是否中文优先？ | 是 | 路由语言策略、Bocha/智谱 |
| Q-W6 | 视频做到什么程度？ | 先元数据 + 已有字幕 | P12 范围与成本 |
| Q-W7 | frontier 状态存储？ | SQLite | 续跑、部署依赖 |
| Q-W8 | 多子代理规模？ | 6 个子代理、深度 2 | 成本、并发、延迟 |
| Q-W9 | 是否保留原始 HTML？ | 默认不保留 | 版权、存储、复核 |
| Q-W10 | 是否启用 JS 渲染？ | 默认关闭 | 覆盖率、资源、成本 |
| Q-W11 | 是否允许外部抽取服务接触页面？ | 仅公网 + allowlist | 隐私、合规 |

### 15.3 决策表（可直接回复）

```text
请选择（可以只写字母/编号）：

1. 主搜索：✅ 已定 **Exa**（实现见 `packages/web/src/search-exa.ts`）
   （其他候选保留在此，供未来调整：DeepSeek / 博查 Bocha / 智谱 / Brave / Tavily / SearXNG）

2. 备搜索：✅ 已定 **DeepSeek 官方 Search API**（实现见 `packages/web/src/search-deepseek.ts`）
   （其他候选：Brave / 博查 Bocha / 智谱 / Tavily / 暂不需要）

3. 正文抽取：
   A. 本地 Readability（推荐，免费/可离线）
   B. Jina Reader（PDF/JS 回退）
   C. Firecrawl（JS 重站点）
   D. Tavily Extract / Exa Contents
   E. 本地 + 外部回退（推荐组合）

4. 是否允许第三方 SERP（Serper/SerpAPI）：允许 / 不允许

5. 是否中文优先：是 / 否

6. 视频范围：
   A. 暂不做
   B. 仅元数据
   C. 元数据 + 已有字幕（推荐先做）
   D. 加 ASR 转写
   E. 再加关键帧/OCR

7. frontier 存储：SQLite（推荐） / JSONL

8. 多子代理规模：轻量（3–4） / 标准（6，推荐） / 激进（10+）

9. 是否保留原始 HTML：否（推荐） / 是，保留 ___ 天

10. 是否启用 JS 渲染：否（推荐） / 是，用 ______
```

## 16. 参考资料

以下为 2026-11 核对时使用的主要公开资料；价格与额度以官网为准：

- DeepSeek Search API：<https://api-docs.deepseek.com/>
- Brave Search API：<https://api.search.brave.com/app/documentation/>
- Tavily 定价：<https://docs.tavily.com/documentation/api-credits>
- Exa 定价：<https://exa.ai/docs/reference/pricing>
- Serper：<https://serper.dev/>
- SerpAPI：<https://serpapi.com/>
- Google Custom Search JSON API：<https://developers.google.com/custom-search/v1/overview>
- Microsoft Bing Search API 退役公告：<https://learn.microsoft.com/lifecycle/announcements/bing-search-api-retirement>
- 博查 API 定价：<https://bocha-ai.feishu.cn/wiki/JYSbwzdPIiFnz4kDYPXcHSDrnZb>
- 智谱定价：<https://docs.bigmodel.cn/cn/guide/start/pricing>
- Jina AI 定价：<https://jina.ai/api-dashboard/pricing/>
- Firecrawl 计费：<https://docs.firecrawl.dev/billing>
- YouTube Data API 配额：<https://developers.google.com/youtube/v3/determine_quota_cost>
- Bilibili API 社区文档：<https://github.com/SocialSisterYi/bilibili-API-collect>
- SearXNG：<https://docs.searxng.org/>
- Mozilla Readability：<https://github.com/mozilla/readability>
