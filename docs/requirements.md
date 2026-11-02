# micro-harness 项目需求

> **状态**：v0.1 初稿（2026-11-02）
> **范围**：把现有骨架实现为可运行的最小 agent harness。
> **维护方式**：先给出框架与已知需求，未决内容以 `Q-*` 编号记录，后续按讨论逐条补充。

## 1. 背景与定位

`micro-harness` 参考 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件架构，目标是用尽量少的代码搭出一个可运行、可组合、可替换的 agent harness。

当前仓库只有包边界、服务缝、插件入口和组合配置，LLM 调用、agent 循环、文件读取、网页搜索/抓取均未实现。本文件定义这些能力要实现到什么程度，以及如何验收。

## 2. 目标

| 编号 | 目标 |
| --- | --- |
| G-1 | **可运行**：`mh` 能接收一次任务，完成“LLM 调用 → 工具执行 → 最终回答”的完整链路。 |
| G-2 | **可组合**：每项能力通过 Cordis 插件与服务缝提供，修改 YAML 即可装配。 |
| G-3 | **可替换**：provider 与 consumer 分离，替换 LLM、搜索或抓取实现时不改调用方。 |
| G-4 | **可验证**：关键链路有离线测试；联网测试显式开启，默认不访问外网。 |
| G-5 | **最小**：不引入超出当前阶段需要的抽象、依赖和配置项。 |

## 3. 非目标

| 编号 | 非目标 | 说明 |
| --- | --- | --- |
| NG-1 | 多 agent 编排、团队协作 | 首版只支持单 agent 单任务 |
| NG-2 | 图形界面 | 只提供 CLI |
| NG-3 | 持久化会话存储 | 首版使用内存实现 |
| NG-4 | 权限系统与进程沙箱 | 首版只做必要的路径与协议限制 |
| NG-5 | 打包与发布 | 源码直连，打包留到路线图 P6 |
| NG-6 | 生产级爬虫能力 | 不做分布式抓取、持久化 frontier、robots.txt 策略 |

## 4. 用户与场景

| 编号 | 角色 | 场景 |
| --- | --- | --- |
| US-1 | 开发者 | 在本地运行 `mh`，让它读取文件或搜索网页后回答问题。 |
| US-2 | 集成方 | 通过 Cordis 组合替换 LLM 或搜索 provider，复用现有 agent loop。 |
| US-3 | 维护者 | 按里程碑逐阶段实现，新增能力不破坏已稳定的服务缝。 |

## 5. 功能需求

优先级：**P0** 首版必需，**P1** 首版后尽快，**P2** 可选。

### 5.1 LLM 与 agent 循环

| 编号 | 优先级 | 需求 | 验收要点 |
| --- | --- | --- | --- |
| FR-1 | P0 | `ctx.llm` 发送 OpenAI-compatible chat completion，支持 system/user/assistant/tool 消息与 tools schema，首版非流式。 | 用本地 stub 返回 tool call 与最终回答；请求体包含 messages 与 tools。 |
| FR-2 | P0 | `llm-deepseek` 从环境变量读取凭证，`baseURL`、`model` 可配置。 | 缺少 `DEEPSEEK_API_KEY` 时启动即报错；密钥不出现在日志中。 |
| FR-3 | P0 | `ctx.agentLoop` 循环调用模型、执行 tool calls、写回 tool result，直到无 tool call 或达到 `maxSteps`。 | 单轮与多轮 tool call 均能正确结束；超过 `maxSteps` 有明确错误。 |
| FR-4 | P0 | 工具执行失败或模型请求未知工具时，把错误写入 tool message 交回模型，不中断循环。 | 模型能收到结构化错误并给出后续回答。 |
| FR-5 | P1 | 支持流式输出与取消；收到 `SIGINT` 时中止在途请求并清理。 | 取消后进程可退出，无悬挂句柄。 |

### 5.2 会话、提示词与工具

| 编号 | 优先级 | 需求 | 验收要点 |
| --- | --- | --- | --- |
| FR-6 | P0 | `ctx.sessions` 提供内存会话，记录 user/assistant/tool 消息；模型上下文可从会话重建。 | 新增 tool result 后，下一次请求包含完整历史。 |
| FR-7 | P0 | `ctx.systemPrompt` 组装基础系统提示与已注册工具的使用说明。 | 未注册工具不出现在提示或 schema 中。 |
| FR-8 | P0 | `ctx.tools` 负责工具注册、列出与按名称执行；schema 与执行器解耦。 | 注册/卸载工具后，schema 与可执行集合同步变化。 |
| FR-9 | P0 | `ctx.agents` 提供 agent 实例工厂，`ctx.agentLoop` 与 CLI 通过它启动一次运行。 | 同一进程内可创建多个互不共享状态的 agent 实例。 |
| FR-10 | P1 | 工具调用参数校验失败时返回可读错误，不抛出未捕获异常。 | 非法 JSON 与缺参场景均有测试。 |

### 5.3 文件系统

| 编号 | 优先级 | 需求 | 验收要点 |
| --- | --- | --- | --- |
| FR-11 | P0 | `ctx.fs` 抽象缝 + `fs/local` provider；提供 `read_file` 工具读取 UTF-8 文本。 | 读取存在的文本文件返回内容；不存在的文件返回明确错误。 |
| FR-12 | P0 | `read_file` 默认限制在工作目录内，拒绝越界路径。 | `../` 与绝对路径越界均被拒绝，错误可被模型理解。 |
| FR-13 | P1 | 文件大小上限可配置，超限时截断并标记。 | 大文件不会无界进入上下文。 |

### 5.4 网页能力

| 编号 | 优先级 | 需求 | 验收要点 |
| --- | --- | --- | --- |
| FR-14 | P0 | `ctx.web` 抽象缝 + `web/fetch-http` provider，抓取 HTTP(S) 页面。 | 非 2xx、超时、非文本响应返回明确错误。 |
| FR-15 | P0 | `web_fetch` 工具把抓取结果交给模型；输出格式与大小上限可配置。 | 本地 stub 页面可被抓取并进入下一轮请求。 |
| FR-16 | P1 | `web/search-deepseek` provider + `web_search` 工具，返回 title/url/snippet。 | 搜索请求参数正确；结果可作为 tool message 写回。 |
| FR-17 | P1 | 抓取限制响应大小、content-type 与协议，只允许 HTTP(S)。 | 超出上限或非法协议被拒绝。 |

### 5.5 CLI 与组合

| 编号 | 优先级 | 需求 | 验收要点 |
| --- | --- | --- | --- |
| FR-18 | P0 | `mh` 解析任务输入，加载 `apps/cli/cordis.patch.yml`，运行一次 agent loop 并打印回答。 | 成功退出码 0；失败打印原因并返回非 0。 |
| FR-19 | P0 | 配置或环境缺失（YAML 错误、缺少 API key）时给出明确错误，不启动半棵树。 | 错误信息指出具体文件或变量。 |
| FR-20 | P0 | YAML 组合覆盖 core/tools、fs provider 与 read_file、web provider 与工具。 | 删除任一 provider 后，依赖它的 consumer 进入 `PENDING` 而不是崩溃。 |
| FR-21 | P1 | 支持 `--patch` 叠加配置与 profile 分层，按条目 `id` 替换。 | 后层配置整体替换同 `id` 条目的 config。 |
| FR-22 | P1 | 支持多轮交互式会话。 | 同一进程内连续提问保留会话历史。 |

## 6. 非功能需求

| 编号 | 需求 | 验收要点 |
| --- | --- | --- |
| NFR-1 | TypeScript strict、ESM、Node `>=24.9`、pnpm workspace。 | `pnpm typecheck` 与 `pnpm lint` 通过。 |
| NFR-2 | 注册动作可随插件卸载撤销；卸载后不留定时器、监听器或在途请求。 | 销毁插件后进程可自然退出。 |
| NFR-3 | 默认测试离线；联网测试由环境变量显式开启。 | `pnpm test` 不发出外部请求。 |
| NFR-4 | 关键阶段可观测：模型请求、工具调用、循环结束与错误。 | 配置 exporter 后能看到带上下文的日志。 |
| NFR-5 | 凭证只从环境读取，不写入仓库、日志或错误信息。 | 日志与异常中不含 API key。 |
| NFR-6 | 错误信息面向使用者，包含失败的操作与可定位的上下文。 | 不用裸 `Error` 覆盖原始原因。 |
| NFR-7 | 依赖安装在项目内，优先使用 `.local/` 工具链。 | 不依赖全局 Node 或 pnpm。 |

## 7. 架构约束

| 编号 | 约束 |
| --- | --- |
| C-1 | 保持 5 个包：`core`、`llm-deepseek`、`fs`、`web`、`cli`；scope 为 `@micro-harness/*`。 |
| C-2 | 服务类只注册 `ctx.<key>`，不实现具体后端；provider 与 tool 插件导出 `name`、`inject`、`apply`。 |
| C-3 | consumer 只依赖服务缝（`ctx.llm`、`ctx.fs`、`ctx.web` 等），不直接依赖 provider 实现。 |
| C-4 | Cordis 使用 registry 上的 `@deepseek-ai/*` scoped 包（`~4.0.5` 系列）。 |
| C-5 | 骨架阶段源码直连：package `exports` 指向 `src/*.ts`，不生成 `lib/`。 |
| C-6 | 代码改动同步更新 README、YAML 与相关文档。 |
| C-7 | 遵循上游代码与注释风格；不为低概率风险写过度防御代码。 |

## 8. 里程碑

| 阶段 | 交付物 | 完成标准 | 状态 |
| --- | --- | --- | --- |
| P1 | `ctx.llm` + DeepSeek 非流式调用 | CLI 能打印一次模型回复 | 计划 |
| P2 | 内存 session、工具注册/执行、单 turn agent loop | 本地 stub 下完成一次 tool call 往返 | 计划 |
| P3 | `ctx.fs` + `fs/local` + `read_file` | 模型可读取工作目录内文件 | 计划 |
| P4 | `ctx.web` + `web/fetch-http` + `web_fetch` | 模型可抓取并引用网页内容 | 计划 |
| P5 | `web/search-deepseek` + `web_search` | 模型可搜索并把结果写回会话 | 计划 |
| P6 | 流式、取消、测试快照、profile 分层、打包 | 上述能力有回归测试与发布产物 | 计划 |

每个阶段只新增 provider 或 consumer，不修改已稳定缝的调用方。

## 9. 验收标准

| 编号 | 标准 |
| --- | --- |
| AC-1 | 配置 `DEEPSEEK_API_KEY` 后，`pnpm mh "<任务>"` 完成一次带工具调用的回答并以 0 退出。 |
| AC-2 | 无网络环境下，agent loop、工具执行与配置加载的测试全部通过。 |
| AC-3 | `pnpm typecheck`、`pnpm lint` 通过。 |
| AC-4 | 卸载 provider 插件后，依赖它的 consumer 进入 `PENDING`；重新挂载后恢复。 |
| AC-5 | 插件卸载或收到退出信号后，进程能自然结束，无悬挂句柄。 |
| AC-6 | 日志与异常中不出现 API key 或完整请求头。 |

## 10. 待确认问题

| 编号 | 问题 | 现状 / 待定 | 影响 |
| --- | --- | --- | --- |
| Q-1 | CLI 输入形态：单次任务参数、stdin，还是交互式 REPL？ | 未定 | FR-18、FR-22 |
| Q-2 | 会话是否需要持久化？首版内存实现是否足够？ | 首版内存 | FR-6、NG-3 |
| Q-3 | `read_file` 的工作目录边界如何确定：启动目录、配置项还是 CLI 参数？ | 待定 | FR-12 |
| Q-4 | `web_fetch` 输出 HTML、纯文本还是 Markdown？是否做正文抽取？ | 待定 | FR-15 |
| Q-5 | `web_search` 使用哪个 provider？是否有官方 DeepSeek 搜索 API？ | 待定 | FR-16 |
| Q-6 | 流式与取消是否进入首版？ | 暂定 P1 | FR-5 |
| Q-7 | 是否需要多 agent 或子任务？ | 首版不做 | NG-1 |
| Q-8 | 模型与工具的错误重试策略、超时预算如何设定？ | 待定 | FR-4、NFR-6 |
| Q-9 | 可观测性目标：仅日志，还是需要指标或 trace？ | 仅日志 | NFR-4 |
| Q-10 | 是否需要发布到 npm，或只作为本地 CLI？ | 首版不发布 | NG-5 |

## 11. 需求维护规则

1. 新需求追加编号，不重排已有编号；删除的需求保留编号并标注“废弃”。
2. 未确认的内容写入 `Q-*`，确认后转为 `FR-*` 或 `NFR-*`。
3. 每个里程碑完成后更新第 8 节状态，并同步 README 路线图。
4. 需求变更若影响已稳定服务缝，需要同时更新 C-* 约束与相关文档。
