# src/core

从 [deepseek-harness/packages/core](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core) 与 [packages/llm/llm](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm) 复制的最小核心源码集。

## 来源

- 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 提交：`ce7073d51254c26cd63b22a60835b8f948deb447`（`master`）
- 范围：`packages/core` 的 `agent`、`agent-loop`、`session`、`scope`、`system-prompt`、`tools` 六个模块，以及 `packages/llm/llm` 的 `src/*.ts`
- 方式：逐字节复制，未改动任何 import、导出、注释或实现

## 布局

上游每个模块的 `src/` 本身是扁平结构；这里去掉 `src/` 这一层，直接放到 `src/core/<module>/`，不再嵌套多级。

| 模块 | 上游路径 | 本地路径 | 文件数 | 行数 |
| --- | --- | --- | ---: | ---: |
| agent | `packages/core/agent/src` | `src/core/agent` | 8 | 1824 |
| agent-loop | `packages/core/agent-loop/src` | `src/core/agent-loop` | 6 | 2130 |
| session | `packages/core/session/src` | `src/core/session` | 10 | 3353 |
| scope | `packages/core/scope/src` | `src/core/scope` | 2 | 471 |
| system-prompt | `packages/core/system-prompt/src` | `src/core/system-prompt` | 1 | 699 |
| tools | `packages/core/tools/src` | `src/core/tools` | 9 | 3710 |
| llm | `packages/llm/llm/src` | `src/core/llm` | 13 | 4145 |

`llm` 不在 `packages/core`，单独从 `packages/llm/llm` 复制，本地目录同样去掉 `src/` 层。合计 7 个模块、49 个文件、16332 行。

每个 `llm` 源文件的最小使用示例见 [docs/llm](../../docs/llm/)；文件名与源码文件一一对应。

未复制：各模块的 `tests/`、`locale/`、`README*`、`package.json`、`tsconfig.json`、`tsdown.config.ts`。

## 当前状态

- 这些文件仍是上游原文，只作为接口与 Cordis 调用方式的参照。
- 外部依赖保留上游包名（`@deepseek-ai/dsh-*`、`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`、`zod` 等）。除 `@deepseek-ai/cordis` 外，本工作区尚未提供这些包，因此这批源码当前不可直接编译。
- 根目录 `tsconfig.json` 的 `include` 也尚未包含 `src/`，不影响现有 `packages/*` 的 typecheck。

## 内部依赖

依赖图覆盖全部 7 个模块、49 个文件。先给出模块总览，再给出一张包含全部文件的全局依赖图，最后按模块展开；三个视图合起来覆盖全部模块和文件。

图中约定：

- 箭头 `A → B` 表示 A 直接依赖 B。
- 实线表示运行时 import 或再导出，虚线表示仅类型引用。
- 模块内部图只画 `./` 文件引用；跨模块引用见“模块总览”。

### 模块总览

```mermaid
flowchart LR
  llm["llm<br/>LLM 服务 / 消息与流"]
  scope["scope<br/>scoped 注册原语"]
  session["session<br/>事件日志 / 消息历史"]
  prompt["system-prompt<br/>提示词组装"]
  agent["agent<br/>AgentRegistry / 事件契约"]
  tools["tools<br/>工具注册 / 执行流水线"]
  loop["agent-loop<br/>默认驱动与工厂"]

  session --> llm
  session --> scope
  prompt --> llm
  prompt --> scope
  agent --> llm
  agent --> session
  agent --> scope
  agent --> prompt
  tools --> llm
  tools --> agent
  tools --> session
  tools --> scope
  tools --> prompt
  loop --> llm
  loop --> agent
  loop --> session
  loop --> scope
  loop --> prompt
  loop --> tools

  classDef base fill:#eef7ee,stroke:#2f7d32;
  classDef top fill:#e8f0fe,stroke:#3b5bdb;
  class llm,scope,session,prompt base;
  class loop top;
```

跨模块依赖按层排列：`llm`、`scope` 是底座；`session`、`system-prompt` 依赖二者；`agent` 依赖前四者；`tools` 依赖 `agent` 及其下层；`agent-loop` 位于最上层，直接依赖其余六个模块。

### 全局文件依赖图

一张图包含全部 49 个文件。子图按模块分组，跨子图的边就是跨模块依赖；实线表示运行时引用或再导出，虚线表示仅类型引用。

```mermaid
flowchart LR
  subgraph LLM["llm（packages/llm/llm）"]
    direction TB
    ll_index["index.ts<br/>LlmService / 公共出口"]
    ll_types["types.ts<br/>消息 / 调用 / 流类型"]
    ll_brand["brand.ts<br/>brand 类型"]
    ll_message["message.ts<br/>消息构造"]
    ll_content["content.ts<br/>内容块归一化"]
    ll_assembler["assembler.ts<br/>流式块组装"]
    ll_assistant_stream["assistant-stream.ts<br/>流累加器"]
    ll_call_config["call-config.ts<br/>调用配置合并"]
    ll_adapter_failure["adapter-failure.ts<br/>适配器失败"]
    ll_retry_policy["retry-policy.ts<br/>重试策略"]
    ll_api_key["api-key.ts<br/>API key 解析"]
    ll_attribution["attribution.ts<br/>归因"]
    ll_error["error.ts<br/>LlmError"]
  end

  subgraph SCOPE["scope"]
    direction TB
    sc_index["index.ts<br/>Scope / scopeTarget"]
    sc_store["store.ts<br/>scoped 存储"]
  end

  subgraph SESSION["session"]
    direction TB
    s_index["index.ts<br/>Session / SessionStore"]
    s_types["types.ts<br/>事件与类型词汇"]
    s_surface["surface.ts<br/>消息 surface fold"]
    s_header["request-header.ts<br/>请求头 fold"]
    s_toolhistory["tool-history.ts<br/>工具历史投影"]
    s_fork["fork.ts<br/>fork 种子"]
    s_preparation["preparation.ts<br/>未发布会话"]
    s_repair["repair.ts<br/>日志修复"]
    s_known["known-event-types.ts<br/>已知事件类型"]
    s_seq["seq-ranges.ts<br/>seq 区间"]
  end

  subgraph PROMPT["system-prompt"]
    direction TB
    p_index["index.ts<br/>SystemPrompt 服务"]
  end

  subgraph AGENT["agent"]
    direction TB
    a_index["index.ts<br/>AgentRegistry"]
    a_dispatch["dispatch.ts<br/>事件派发"]
    a_archive["archive-admission.ts<br/>归档准入"]
    a_model["model-selection.ts<br/>模型选择"]
    a_projection["projection.ts<br/>turnBoundary 投影"]
    a_consumed["consumed-work.ts<br/>已消费工作"]
    a_runtime["runtime-types.ts<br/>运行时类型 / Events"]
    a_types["types.ts<br/>基础契约"]
  end

  subgraph TOOLS["tools"]
    direction TB
    t_index["index.ts<br/>ToolsService"]
    t_contracts["contracts.ts<br/>工具契约"]
    t_executor["executor.ts<br/>执行器"]
    t_pipeline["pipeline.ts<br/>执行流水线"]
    t_batch["batch.ts<br/>批量调度"]
    t_schema["schema.ts<br/>schema 构建"]
    t_json["json-schema.ts<br/>JSON Schema"]
    t_presentation["presentation.ts<br/>展示视图"]
    t_events["events.ts<br/>工具事件"]
  end

  subgraph LOOP["agent-loop"]
    direction TB
    l_index["index.ts<br/>AgentLoop / 工厂"]
    l_agent["agent.ts<br/>ReactLoopAgent"]
    l_inbox["inbox.ts<br/>Inbox"]
    l_runtime["runtime-context.ts<br/>运行时投影"]
    l_stream["assistant-stream.ts<br/>流式发布"]
    l_constants["constants.ts<br/>默认配置"]
  end

  %% llm 内部
  ll_index --> ll_adapter_failure
  ll_index --> ll_api_key
  ll_index --> ll_assembler
  ll_index --> ll_assistant_stream
  ll_index --> ll_attribution
  ll_index --> ll_brand
  ll_index --> ll_call_config
  ll_index --> ll_content
  ll_index --> ll_error
  ll_index --> ll_message
  ll_index --> ll_retry_policy
  ll_index -.-> ll_types
  ll_adapter_failure --> ll_error
  ll_adapter_failure -.-> ll_types
  ll_assembler --> ll_message
  ll_assembler -.-> ll_brand
  ll_assembler -.-> ll_types
  ll_assistant_stream --> ll_assembler
  ll_assistant_stream -.-> ll_brand
  ll_assistant_stream -.-> ll_types
  ll_call_config -.-> ll_brand
  ll_call_config -.-> ll_types
  ll_content -.-> ll_brand
  ll_content -.-> ll_message
  ll_content -.-> ll_types
  ll_message -.-> ll_brand
  ll_message -.-> ll_types
  ll_retry_policy --> ll_error
  ll_types -.-> ll_brand
  ll_types -.-> ll_message

  %% scope 内部
  sc_index --> sc_store
  sc_store --> sc_index

  %% session 内部
  s_index --> s_types
  s_index --> s_surface
  s_index --> s_header
  s_index --> s_toolhistory
  s_index --> s_fork
  s_index --> s_preparation
  s_index --> s_repair
  s_index --> s_known
  s_index --> s_seq
  s_preparation -.-> s_index
  s_fork --> s_repair
  s_fork --> s_types
  s_repair --> s_types
  s_header -.-> s_types
  s_seq --> s_types
  s_surface --> s_types
  s_surface --> s_known
  s_toolhistory -.-> s_types

  %% agent 内部
  a_index --> a_archive
  a_index --> a_projection
  a_index --> a_model
  a_index --> a_dispatch
  a_index --> a_consumed
  a_index -.-> a_runtime
  a_index -.-> a_types
  a_model -.-> a_runtime
  a_model -.-> a_types
  a_projection -.-> a_types
  a_dispatch -.-> a_types
  a_archive -.-> a_types
  a_runtime -.-> a_types

  %% tools 内部
  t_index --> t_contracts
  t_index --> t_executor
  t_index --> t_schema
  t_index --> t_json
  t_index --> t_presentation
  t_batch --> t_executor
  t_batch --> t_contracts
  t_batch -.-> t_pipeline
  t_contracts -.-> t_json
  t_contracts -.-> t_presentation
  t_events -.-> t_contracts
  t_events -.-> t_index
  t_executor -.-> t_contracts
  t_pipeline --> t_contracts
  t_pipeline --> t_json
  t_pipeline --> t_batch
  t_pipeline -.-> t_index
  t_schema -.-> t_contracts
  t_schema --> t_json
  t_schema -.-> t_presentation

  %% agent-loop 内部
  l_index --> l_agent
  l_index --> l_inbox
  l_index --> l_constants
  l_index -.-> l_runtime
  l_agent --> l_inbox
  l_agent --> l_runtime
  l_agent --> l_stream

  %% agent → session / scope / system-prompt
  a_archive -.-> s_index
  a_consumed -.-> s_index
  a_dispatch --> sc_index
  a_dispatch -.-> p_index
  a_index --> sc_index
  a_index -.-> s_index
  a_model -.-> s_index
  a_projection -.-> s_types
  a_runtime -.-> sc_index
  a_runtime -.-> s_index
  a_runtime -.-> p_index
  a_types -.-> s_types

  %% session / system-prompt → scope
  s_index --> sc_index
  p_index --> sc_index

  %% agent-loop → agent / session / scope / system-prompt / tools
  l_agent --> a_index
  l_agent --> sc_index
  l_agent --> s_index
  l_agent --> p_index
  l_agent --> t_index
  l_stream -.-> a_index
  l_stream -.-> s_index
  l_inbox -.-> a_index
  l_inbox -.-> s_index
  l_index --> a_index
  l_index --> s_index
  l_index -.-> p_index
  l_index -.-> t_index
  l_runtime --> s_index

  %% tools → agent / session / scope / system-prompt
  t_batch -.-> s_index
  t_contracts -.-> a_index
  t_contracts -.-> sc_index
  t_contracts -.-> s_index
  t_events -.-> sc_index
  t_executor -.-> a_index
  t_executor -.-> s_index
  t_executor -.-> p_index
  t_index --> sc_index
  t_pipeline --> sc_index
  t_pipeline -.-> s_index

  %% * → llm
  a_model_selection --> ll_brand
  a_model_selection --> ll_index
  a_runtime_types -.-> ll_index
  a_types -.-> ll_brand
  a_types -.-> ll_types
  l_agent --> ll_index
  l_assistant_stream --> ll_index
  l_inbox -.-> ll_index
  l_index --> ll_index
  l_runtime_context --> ll_index
  p_index -.-> ll_index
  s_index -.-> ll_index
  s_repair -.-> ll_index
  s_request_header --> ll_index
  s_surface -.-> ll_index
  s_tool_history -.-> ll_index
  s_types -.-> ll_index
  t_batch --> ll_index
  t_contracts --> ll_index
  t_executor --> ll_index
  t_index -.-> ll_index
  t_json_schema --> ll_index
  t_pipeline --> ll_index
  t_presentation -.-> ll_index
  t_schema --> ll_index

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  classDef leaf fill:#eef7ee,stroke:#2f7d32;
  class ll_index,sc_index,s_index,p_index,a_index,t_index,l_index barrel;
  class a_consumed,a_types,s_types,s_known,t_json,t_presentation,l_constants,ll_api_key,ll_attribution,ll_brand,ll_error leaf;
```

### 文件依赖

#### agent

```mermaid
flowchart TD
  index["index.ts<br/>AgentRegistry / ctx.agents"]
  dispatch["dispatch.ts<br/>agentEvents / assembleContextFor"]
  archive["archive-admission.ts<br/>turn 归档准入"]
  model["model-selection.ts<br/>AgentModel / 选择投影"]
  projection["projection.ts<br/>turnBoundary 投影"]
  consumed["consumed-work.ts<br/>已消费工作折叠"]
  runtime["runtime-types.ts<br/>Agent 运行时类型 / Events"]
  types["types.ts<br/>Agent 基础契约 / Session 事件"]

  index -->|运行时| archive
  index -->|运行时| projection
  index -->|再导出| model
  index -->|再导出| dispatch
  index -->|再导出| consumed
  index -.->|仅类型| runtime
  index -.->|仅类型| types

  model -.->|仅类型| runtime
  model -.->|仅类型| types
  projection -.->|仅类型| types
  dispatch -.->|仅类型| types
  archive -.->|仅类型| types
  runtime -.->|仅类型| types

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  classDef leaf fill:#eef7ee,stroke:#2f7d32;
  class index barrel;
  class types leaf;
```

- `index.ts` 是唯一聚合入口，其余 7 个模块不反向依赖它，依赖图无环。
- `types.ts` 是叶子契约，被 6 个模块依赖（`consumed-work.ts` 除外）。
- `consumed-work.ts` 只依赖 Session 事件类型，内部无依赖，由 `index.ts` 再导出。
- `runtime-types.ts` 以声明合并扩充 `./types.ts` 的 `Agent`，因此两者还有一层隐式类型耦合。

#### agent-loop

```mermaid
flowchart TD
  index["index.ts<br/>AgentLoop / 工厂"]
  agent["agent.ts<br/>ReactLoopAgent"]
  inbox["inbox.ts<br/>Inbox 投影与命令"]
  runtime["runtime-context.ts<br/>运行时上下文投影"]
  stream["assistant-stream.ts<br/>流式发布"]
  constants["constants.ts<br/>默认配置"]

  index --> agent
  index --> inbox
  index --> constants
  index -.-> runtime
  agent --> inbox
  agent --> runtime
  agent --> stream

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  class index barrel;
```

- `index.ts` 负责创建与发布 agent；`agent.ts` 是真正的 turn/step 驱动。
- `agent.ts` 同时引用 `runtime-context.ts` 的 `RuntimeContextProjection` 与 `SystemPromptProjection`。
- `assistant-stream.ts`、`inbox.ts`、`runtime-context.ts`、`constants.ts` 之间没有直接的本地文件依赖。

#### session

```mermaid
flowchart TD
  index["index.ts<br/>Session / SessionStore"]
  types["types.ts<br/>事件与类型词汇"]
  surface["surface.ts<br/>消息 surface fold"]
  header["request-header.ts<br/>请求头 fold"]
  toolHistory["tool-history.ts<br/>工具历史投影"]
  fork["fork.ts<br/>fork 种子"]
  preparation["preparation.ts<br/>未发布会话"]
  repair["repair.ts<br/>日志修复"]
  known["known-event-types.ts<br/>已知事件类型"]
  seq["seq-ranges.ts<br/>seq 区间"]

  index --> types
  index --> surface
  index --> header
  index --> toolHistory
  index --> fork
  index --> preparation
  index --> repair
  index --> known
  index --> seq

  preparation -.-> index
  fork --> repair
  fork --> types
  repair --> types
  header -.-> types
  seq --> types
  surface --> types
  surface --> known
  toolHistory -.-> types

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  classDef leaf fill:#eef7ee,stroke:#2f7d32;
  class index barrel;
  class types leaf;
```

- `index.ts` 同时是服务实现和 barrel：导入或再导出其余 9 个文件。
- `preparation.ts` 以 `import type { Session }` 回指 `index.ts`，形成仅类型的环；不影响运行时。
- `types.ts` 是最底层的事件与类型词汇，被 6 个文件引用。

#### scope

```mermaid
flowchart LR
  index["index.ts<br/>Scope / scopeTarget"]
  store["store.ts<br/>scoped 存储"]

  index -->|再导出| store
  store -->|引用| index
```

- 两个文件互相引用：`store.ts` 使用 `index.ts` 的 `scopeChainOf`/`scopeOf`，`index.ts` 再导出 `store.ts`。
- 这是运行时循环引用，依赖 ESM 的 live binding；模块很小，保留这种组织是为了把 scoped 原语集中在一处。

#### llm

```mermaid
flowchart TD
  index["index.ts<br/>LlmService / 公共出口"]
  types["types.ts<br/>消息 / 调用 / 流类型"]
  brand["brand.ts<br/>brand 类型"]
  message["message.ts<br/>消息构造"]
  content["content.ts<br/>内容块归一化"]
  assembler["assembler.ts<br/>流式块组装"]
  stream["assistant-stream.ts<br/>流累加器"]
  callConfig["call-config.ts<br/>调用配置合并"]
  adapter["adapter-failure.ts<br/>适配器失败"]
  retry["retry-policy.ts<br/>重试策略"]
  apiKey["api-key.ts<br/>API key 解析"]
  attribution["attribution.ts<br/>归因"]
  error["error.ts<br/>LlmError"]

  index -->|运行时| adapter
  index -->|运行时| apiKey
  index -->|运行时| assembler
  index -->|运行时| stream
  index -->|运行时| attribution
  index -->|运行时| brand
  index -->|运行时| callConfig
  index -->|运行时| content
  index -->|运行时| error
  index -->|运行时| message
  index -->|运行时| retry
  index -.->|仅类型| types

  adapter -->|运行时| error
  adapter -.->|仅类型| types

  assembler -->|运行时| message
  assembler -.->|仅类型| brand
  assembler -.->|仅类型| types

  stream -->|运行时| assembler
  stream -.->|仅类型| brand
  stream -.->|仅类型| types

  callConfig -.->|仅类型| brand
  callConfig -.->|仅类型| types

  content -.->|仅类型| brand
  content -.->|仅类型| message
  content -.->|仅类型| types

  message -.->|仅类型| brand
  message -.->|仅类型| types

  retry -->|运行时| error

  types -.->|仅类型| brand
  types -.->|仅类型| message

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  classDef leaf fill:#eef7ee,stroke:#2f7d32;
  class index barrel;
  class apiKey,attribution,brand,error leaf;
```

- `index.ts` 是唯一聚合入口，导入或再导出其余 12 个文件。
- `types.ts` 与 `message.ts` 构成仅类型的环：`types.ts` 引用消息类型，`message.ts` 反向引用 `types.ts`；运行时不受影响。
- `brand.ts`、`error.ts`、`api-key.ts`、`attribution.ts` 没有本地文件依赖。
- `adapter-failure.ts` 依赖 `error.ts`；`retry-policy.ts` 也复用 `error.ts` 的错误基类。

#### system-prompt

```mermaid
flowchart TD
  index["index.ts<br/>SystemPrompt 服务"]
```

- 只有一个文件，内部没有文件级依赖；依赖来自 `cordis`、`schemastery`，以及本地的 `dsh-scope`、`dsh-llm`。

#### tools

```mermaid
flowchart TD
  index["index.ts<br/>ToolsService"]
  contracts["contracts.ts<br/>工具契约"]
  executor["executor.ts<br/>执行器"]
  pipeline["pipeline.ts<br/>执行流水线"]
  batch["batch.ts<br/>批量调度"]
  schema["schema.ts<br/>工具 schema 构建"]
  json["json-schema.ts<br/>JSON Schema 校验"]
  presentation["presentation.ts<br/>展示视图"]
  events["events.ts<br/>工具事件"]

  index --> contracts
  index --> executor
  index --> schema
  index --> json
  index --> presentation

  batch --> executor
  batch --> contracts
  batch -.-> pipeline

  contracts -.-> json
  contracts -.-> presentation

  events -.-> contracts
  events -.-> index

  executor -.-> contracts

  pipeline --> contracts
  pipeline --> json
  pipeline --> batch
  pipeline -.-> index

  schema -.-> contracts
  schema --> json
  schema -.-> presentation

  classDef barrel fill:#e8f0fe,stroke:#3b5bdb;
  class index barrel;
```

- `index.ts` 是 `ToolsService` 与公共 barrel，导入或再导出 `contracts`、`executor`、`schema`、`json-schema`、`presentation`。
- `pipeline.ts` 与 `batch.ts` 构成类型/再导出方向的环：`batch` 以类型引用 `pipeline`，`pipeline` 再导出 `batch`。
- `events.ts` 以类型方式回指 `index.ts` 的 `ToolsService`，用于声明工具事件。
- `json-schema.ts` 与 `presentation.ts` 是叶子文件，没有本地依赖。

### agent 对外依赖

以下针对 `agent/`；`llm/` 的对外依赖见下一节，其余模块不在本次展开。

#### 已复制的本地模块

| 上游包 | 本地对应 | 导入符号 | 方式 | 引用文件 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-session`（含 `/types`） | `src/core/session` | `Session`、`SessionEvent`、`SessionId`、`SessionLogOffset`、`EpochHeader`、`AgentCancelCause`、`SessionSeq`、`OptionalSessionSeq`、`UserMessage`、`TurnEndReason` | 仅类型 | `archive-admission.ts`、`consumed-work.ts`、`index.ts`、`model-selection.ts`、`projection.ts`、`runtime-types.ts`、`types.ts` | 会话日志、turn/step 事件、请求头、消息 |
| `@deepseek-ai/dsh-scope` | `src/core/scope` | `scopeTarget`、`Scoped` | 运行时 + 类型 | `dispatch.ts`、`index.ts`、`runtime-types.ts` | Agent 作用域载体与事件过滤 |
| `@deepseek-ai/dsh-system-prompt` | `src/core/system-prompt` | `AssembleContext`；增强 `AssembleContext.agent`、`modelSelection` | 仅类型 | `dispatch.ts`、`runtime-types.ts` | 提示词组装上下文 |
| `@deepseek-ai/dsh-llm`（含 `/brand`、`/types`） | `src/core/llm` | `boundContextSummary`、`createUserMessage`、`ReasoningEffortId`（值）；`ContextFormed`、`LlmAttemptId`、`LlmCallConfig`、`LlmFailure`、`MessageId`、`ResolvedRetryPolicy`、`StreamChunk`、`UserMessage`；增强 `MessageSourceMap` | 运行时 + 类型 | `model-selection.ts`、`runtime-types.ts`、`types.ts` | 用户消息构造、上下文摘要、LLM 流与失败类型 |

#### 其它上游包（本仓库未复制）

| 上游包 | 导入符号 | 方式 | 引用文件 | 用途 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-session-projection` | `ProjectionHandle`、`ProjectionDefinition` | 仅类型 | `index.ts`、`model-selection.ts`、`projection.ts` | 投影注册与纯 fold 定义 |
| `@deepseek-ai/dsh-workspace`（含 `/types`） | `SessionActivity`；增强 `SessionActivityKindMap.turn` | 仅类型 | `archive-admission.ts`、`types.ts` | 归档准入回答 |
| `@deepseek-ai/dsh-brand` | `brandNumber` | 运行时 | `projection.ts` | 生成 `SessionSeq` brand |
| `@deepseek-ai/dsh-typert-protocol` | `TypertContext`、`TypertLookup`；增强 `TypertLookupMap.agent`、`TypertContextMap.agent` | 仅类型 | `types.ts` | Agent 的 typert 查询与上下文映射 |
| `@deepseek-ai/dsh-util-values` | `JsonValue` | 仅类型 | `types.ts` | Inbox wire JSON 类型 |

#### 平台与第三方

| 上游包 | 导入符号 | 方式 | 引用文件 | 用途 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 运行时：`Context`、`Service`、`FiberState`、`getTraceable`、`symbols`；类型：`Fiber`、`Events`；增强 `Context.agents`、`Events`（`agent/*`） | 运行时 + 类型 | `index.ts`、`archive-admission.ts`、`dispatch.ts`、`model-selection.ts`、`runtime-types.ts` | 服务注册、事件派发、effect 生命周期、fiber 状态、可追踪服务 |
| `zod` | `z` | 运行时 | `model-selection.ts`、`projection.ts` | 投影状态 schema |
| `node:async_hooks` | `AsyncLocalStorage` | 运行时 | `index.ts` | initiator 作用域 |
| `node:util/types` | `isPromise` | 运行时 | `index.ts` | 判断 initiator 边界返回值 |

Cordis 的实际调用面集中在 `index.ts`：`Service` 子类与 `super(ctx, 'agents')`、`static inject`、`[Service.init]` 生命周期；`ctx.inject()`、`ctx.on()`、`ctx.effect()`、`ctx.events.dispatch()`、`ctx.serial()`、`ctx.waterfall()`、`ctx.logger`、`ctx.fiber`；`FiberState.UNLOADING`、`getTraceable`、`symbols.original`。此外通过注入的 `ctx.sessionProjections.register()` 使用外部投影服务。

#### 模块增强（声明合并）

这些依赖不出现在 import 符号里，但同样改变外部类型：

| 增强目标 | 增强内容 | 位置 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | `Context.agents`；`Events` 增加 `agent/created`、`agent/disposed`、`agent/status`、`agent/inbox/*`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/assistant-stream`、`agent/turn-stopping`、`agent/error` | `index.ts`、`runtime-types.ts` |
| `@deepseek-ai/dsh-session/types` | `SessionEventMap` 增加 `agent/inbox/spliced`、`model/selection` | `types.ts` |
| `@deepseek-ai/dsh-session-projection/types` | `SessionProjectionMap` 增加 `inbox`、`modelSelection` | `types.ts` |
| `@deepseek-ai/dsh-workspace/types` | `SessionActivityKindMap` 增加 `turn` | `types.ts` |
| `@deepseek-ai/dsh-typert-protocol` | `TypertLookupMap.agent`、`TypertContextMap.agent` | `types.ts` |
| `@deepseek-ai/dsh-system-prompt` | `AssembleContext` 增加 `agent`、`modelSelection` | `runtime-types.ts` |
| `@deepseek-ai/dsh-llm` | `MessageSourceMap` 增加 `model-selection` | `model-selection.ts` |

### llm 对外依赖

`llm/` 不依赖其它本地 core 模块，只依赖上游发布包：

| 上游包 | 导入符号 | 方式 | 引用文件 | 用途 |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/cordis` | `Context` | 运行时 | `index.ts` | `LlmService` 的 Cordis 基类 |
| `@deepseek-ai/dsh-attachment` | `AttachmentStore`、`FileAttachmentRef`、`ImageAttachmentRef`、`ImageMediaType`、`RequestImageAttachment`、`ImageRequestTarget` | 仅类型 | `content.ts`、`index.ts`、`types.ts` | 文件/图片附件 |
| `@deepseek-ai/dsh-brand` | `brandString`、`Branded` | 运行时 + 类型 | `assembler.ts`、`brand.ts`、`message.ts`、`types.ts` | branded id 与品牌字符串 |
| `@deepseek-ai/dsh-package-manifest` | `LocalizedText` | 仅类型 | `types.ts` | 本地化文本 |
| `@deepseek-ai/dsh-timeout` | `MAX_TIMER_DELAY_MS` | 运行时 | `retry-policy.ts` | 定时器上限 |
| `@deepseek-ai/dsh-typert-protocol` | `Remote`、`RemoteError`、`TypertRemoteService` | 运行时 | `index.ts` | typert remote 服务 |
| `@deepseek-ai/dsh-util-crypto` | `randomUUID` | 运行时 | `message.ts` | 消息 id 生成 |
| `@deepseek-ai/dsh-util-values` | `assertNever`、`deepFreeze`、`snapshotJsonValue` | 运行时 | `assembler.ts`、`assistant-stream.ts`、`content.ts`、`index.ts`、`message.ts` | 不可变值与穷尽检查 |
| `@deepseek-ai/schemastery` | `z` | 运行时 | `retry-policy.ts` | 重试策略 schema |
| `node:module` | `createRequire` | 运行时 | `attribution.ts` | 读取 package manifest |
