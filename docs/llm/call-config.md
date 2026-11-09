# call-config.ts

> 对应源码：`src/core/llm/call-config.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

描述一次模型调用的 provider、model 和采样控制，并提供两个独立能力：

- `callConfigEquals()`：逐字段比较调用配置，决定是否需要记录新的请求头。
- `markAgentLoopRequest()` / `isAgentLoopRequest()`：标记由 agent loop 组装的请求对象。

## 最小示例

```ts
import {
  callConfigEquals,
  isAgentLoopRequest,
  markAgentLoopRequest,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

const request: GenerateOptions = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  messages: [],
}

markAgentLoopRequest(request)
console.log(isAgentLoopRequest(request)) // true

console.log(callConfigEquals(
  { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
)) // true
```

## 要点

- `callConfigEquals()` 会比较 `provider`、`model`、`reasoningEffort`、`temperature`、`maxTokens` 和 `stop` 数组。
- `markAgentLoopRequest()` 使用 `WeakSet` 记录对象身份，不修改请求内容，也不产生持久化状态。
- 该标记只对同一个进程、同一个对象有效；复制请求对象后需要重新判断。
