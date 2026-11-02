# micro-harness

参考 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件架构搭建的最小 agent harness 骨架。

> **当前状态：骨架。**
> 只有包边界、服务缝、插件入口和组合配置，**没有具体实现**：LLM 调用、agent 循环、文件读取、网页搜索/抓取都只有契约与 `TODO`。`pnpm mh` 会明确报错。

## 文档

- [Cordis 教程：构建持续并发的抓取 Agent](docs/cordis-tutorial.md)

## 目标链路

```
用户任务
  → agent-loop 组装 system prompt + 工具 schema
  → ctx.llm 调用 DeepSeek
  → 模型返回 tool call
  → ctx.tools 执行 read_file / web_search / web_fetch
  → 结果写回 session，进入下一 step
  → 直到模型给出最终回答
```

## 5 个包

deepseek-harness 通常“一个插件一个包”。这个骨架按**能力域**合并，包内仍然严格区分三类插件：

| 包 | 内容 |
| --- | --- |
| `@micro-harness/core` | 服务缝 + agent loop：`ctx.llm`、`ctx.sessions`、`ctx.systemPrompt`、`ctx.tools`、`ctx.agents`、`ctx.agentLoop`、native executor |
| `@micro-harness/llm-deepseek` | `ctx.llm` 的 DeepSeek provider |
| `@micro-harness/fs` | `ctx.fs` 缝 + 本地 provider + `read_file` 工具 |
| `@micro-harness/web` | `ctx.web` 缝 + HTTP 抓取 / DeepSeek 搜索 provider + `web_search` / `web_fetch` 工具 |
| `@micro-harness/cli` | `mh` 命令 + `cordis.patch.yml` 组合 |

合并只影响包的粒度，不影响架构：`fs` / `web` 包内部仍然是独立的 seam、provider、tool 插件，consumer 只依赖 `ctx.fs` / `ctx.web`。需要时把任一插件提成独立包即可，调用方不改。

## 目录

```
.
├── apps/cli/
│   ├── cordis.patch.yml       # 完整最小树（组合层）
│   └── src/
│       ├── bin.ts             # mh 入口
│       ├── args.ts            # 参数解析（占位）
│       ├── profile-boot.ts    # patch 分层 + Cordis 启动（占位）
│       └── index.ts
├── packages/
│   ├── core/src/
│   │   ├── llm.ts             # ctx.llm + Message/ContentBlock
│   │   ├── session.ts         # ctx.sessions
│   │   ├── system-prompt.ts   # ctx.systemPrompt
│   │   ├── tools.ts           # ctx.tools + ToolDefinition
│   │   ├── agent.ts           # ctx.agents
│   │   ├── agent-loop.ts      # ctx.agentLoop
│   │   ├── executor-native.ts # 工具执行器
│   │   └── index.ts           # 类型出口
│   ├── llm-deepseek/src/index.ts
│   ├── fs/src/
│   │   ├── index.ts           # ctx.fs 抽象缝
│   │   ├── local.ts           # 本地 provider
│   │   └── read-tool.ts       # read_file
│   └── web/src/
│       ├── index.ts           # ctx.web + provider 契约
│       ├── fetch-http.ts      # HTTP 抓取 provider
│       ├── search-deepseek.ts # DeepSeek 搜索 provider
│       └── tools.ts           # web_search / web_fetch
├── docs/
│   └── cordis-tutorial.md     # Cordis 教程（案例驱动）
├── tests/
│   ├── fetch-url.spec.ts      # 联网抓取：URL → HTML 文件路径
│   └── output/                # 抓取产物（gitignored）
├── .local/                    # 项目内 Node + pnpm + 两个缓存（gitignored）
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── tsconfig.json
```

## 本地安装

包管理器与上游一致是 pnpm 11.28.5。工具链和依赖都留在项目内，不依赖全局 Node，也不写用户级 store：

```bash
export PATH="$PWD/.local/node/bin:$PATH"   # 每个新 shell 执行一次
pnpm install                               # 装到 ./node_modules
```

| 路径 | 作用 |
| --- | --- |
| `.local/node` | Node 24.22.2 + npm 11.19.1 + pnpm 11.28.5，整个目录可随时删除重装 |
| `.local/npm-cache` | npm 缓存（目前只给 `pnpm dlx` / npm 兜底用） |
| `.local/pnpm-store` | pnpm content-addressable store，由 `pnpm-workspace.yaml` 的 `storeDir` 指定 |
| `node_modules/` | 项目根目录下的依赖；pnpm 的 virtual store 在 `node_modules/.pnpm` |

`.local/` 和 `node_modules/` 都在 `.gitignore` 里。工作区内部依赖用 `workspace:*`，vendor 的 Cordis 包用 `workspace:~` 的等价写法 `~4.0.5`（目前直接取 registry 上的 `@deepseek-ai/*`）。`pnpm-workspace.yaml` 里显式允许 `esbuild` 的安装脚本（vitest 需要它），并打开 `autoInstallPeers`，保证每个包解析到同一个 cordis 实例。

## 能力缝

| 服务键 | Definition | 实现 / 消费 |
| --- | --- | --- |
| `ctx.llm` | `core/llm.ts` | `llm-deepseek` |
| `ctx.tools` | `core/tools.ts` | `core/executor-native`、`fs/read-tool`、`web/tools` |
| `ctx.systemPrompt` | `core/system-prompt.ts` | `core/tools`、两个 tool 插件 |
| `ctx.sessions` | `core/session.ts` | `core/agent-loop` |
| `ctx.agents` | `core/agent.ts` | `core/agent-loop`（factory） |
| `ctx.agentLoop` | `core/agent-loop.ts` | CLI |
| `ctx.fs` | `fs/index.ts` | `fs/local`（provider）、`fs/read-tool`（consumer） |
| `ctx.web` | `web/index.ts` | `web/fetch-http`、`web/search-deepseek`（provider）、`web/tools`（consumer） |

规则：

- 服务类只注册 `ctx.<key>`，不实现具体后端。
- provider / tool 插件导出 `name`、`inject`、`apply(ctx, config)`。
- 注册动作必须可随插件卸载撤销；实现阶段用 `ctx.effect()`。
- 进入模型上下文的内容必须能从 session 事件重建。

## 组合

`apps/cli/cordis.patch.yml` 是完整的最小树，通过包的 subpath 选择具体插件：

```yaml
- id: tools
  name: '@micro-harness/core/tools'

- id: filesystem
  name: '@micro-harness/fs/local'

- id: tool-fs
  name: '@micro-harness/fs/read-tool'

- id: web
  name: '@micro-harness/web'

- id: tool-web
  name: '@micro-harness/web/tools'
```

行 id 与上游 `sdk-minimal` bundle 对齐（`filesystem`、`tool-fs`、`tool-executor-native`）。补丁按 `id` 定位，后层会整体替换该行的 `config`；`!!js` 只允许出现在插件 `config` 或条目的 `disabled` 下。

`fs` 抽象缝本身**不是一行**：`fs/local` 继承它并注册 `ctx.fs`，同时挂载会重复注册。后续可把 YAML 提成独立 bundle 包，让 profile / `--patch` 在它上面叠加。

## 约定

- scope：`@micro-harness/*`；CLI：`mh`
- pnpm workspaces；内部依赖 `workspace:*`，vendor 包 `~` 版本
- Cordis 使用上游发布到 registry 的 scoped 包：`@deepseek-ai/cordis`（`~4.0.5`）与 `@deepseek-ai/cordis-plugin-{loader,include,timer}`
- ESM、Node `>=24.9`、TypeScript strict、本地导入带 `.ts`
- `tsconfig.json` 的编译选项镜像上游 `tsconfig.base.json`：`target`/`module` 为 `es2024`/`esnext`、`moduleResolution: bundler`、`declaration`/`sourceMap`/`declarationMap`/`composite`/`incremental`、`verbatimModuleSyntax: false`、`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`、全部 strict 开关、`types: ["node"]`
- 与上游的差异只在编排：这里是单个 `noEmit` 程序，不拆 host/client solution，也不生成项目引用
- 骨架采用源码直连：package `exports` 指向 `src/*.ts`，`tsx` / `vitest` 直接运行；启动方式与上游一致为 `node --import tsx/esm`
- 打包（`lib/` + 类型产物）和 profile 解析留到后续阶段
- 测试统一用 `*.spec.ts` 命名；包内离线单测放 `packages/*/tests/`，跨包集成测试和联网/手动验证放根目录 `tests/`，靠命名和环境变量开关区分

## 命令

```bash
export PATH="$PWD/.local/node/bin:$PATH"

pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm mh --help   # 骨架阶段预期失败：argument parsing is not implemented yet
pnpm test:cordis # Cordis 最小集成测试：LLM 请求 + web_search，本地 HTTP stub
FETCH_URL=https://example.com pnpm test:fetch   # 抓取并打印生成的 HTML 路径
```

`cordis-llm-websearch.spec.ts` 用 node:test 和本地 HTTP stub 验证 Cordis 的 Service、inject、事件与生命周期；不联网、不需要 API key。它验证的是 Cordis 编排，不会访问真实 DeepSeek 或搜索 API。

`fetch-url.spec.ts` 从 `FETCH_URL` 读取输入，普通 `pnpm test` 在未设置时自动 skip，不会联网。HTML 写到 `tests/output/<host>-<path>.html`，路径会打印在测试输出里；非 2xx 或非 HTML 内容会让测试失败。也可以直接 `FETCH_URL=... pnpm vitest run tests/fetch-url.spec.ts` 只跑这一个文件。

## 路线图

1. **P1** `ctx.llm` + DeepSeek 非流式调用，CLI 能打印一次回复
2. **P2** `ctx.sessions` 内存实现、`ctx.tools` 注册/执行、`agent-loop` 单 turn
3. **P3** `ctx.fs` + `fs/local` + `read_file`
4. **P4** `ctx.web` + `web/fetch-http` + `web_fetch`
5. **P5** `web/search-deepseek` + `web_search`
6. **P6** 流式、取消、测试快照、profile 分层、打包

每个阶段只新增 provider 或 consumer，不改已稳定缝的调用方。
