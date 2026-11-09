# types.ts

> 对应源码：`src/core/llm/types.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

定义 provider-neutral 的消息、内容块、流式 chunk、finish reason、token usage、模型元数据和 `GenerateOptions`。适配器只负责把这些结构翻译成 provider 的 wire 格式。

## 最小示例

```ts
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'

const block: ContentBlock = { type: 'text', text: 'hello' }
const chunk: StreamChunk = { type: 'block-end', index: 0, block }
const finish: FinishReason = { kind: 'stop' }

const request: GenerateOptions = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: [block] }],
}

console.log(chunk, finish, request)
```

## 要点

- `ContentBlockMap`、`FinishReasonMap`、`MessageRoleMap` 等都是声明合并可扩展的映射；新增类型时同时补齐适配器和展示逻辑。
- `RequestMessage` 可以是持久化的 `Message`，也可以是只用于一次请求的 `RequestUserInput`。
- `StreamChunk` 的顺序是：可选的 `block-start`、delta、`block-end`、可选的 `usage`，最后是 `finish`。
- `GenerateOptions.messages` 是 provider 最终看到的消息；loop 组装的请求与手动一次性请求都使用这个类型。
