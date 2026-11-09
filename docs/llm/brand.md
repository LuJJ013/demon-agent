# brand.ts

> 对应源码：`src/core/llm/brand.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

为 LLM 层的各个 id 提供名义类型（nominal typing），防止 `MessageId`、`ToolCallId`、`ProviderRequestId` 等字符串在类型层面被混用。

## 最小示例

```ts
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'

const messageId = MessageId('msg-1')
const callId = ToolCallId('call-1')

// messageId 的类型是 MessageId，不能直接赋给 ToolCallId
console.log(messageId, callId)
```

## 要点

- 构造器只做 brand，不做格式校验；空字符串也会被接受。
- 运行时仍是普通字符串，成本为零。
- 其他包可以只依赖 `@deepseek-ai/dsh-llm/brand` 子路径，避免引入整个 LLM 服务。
