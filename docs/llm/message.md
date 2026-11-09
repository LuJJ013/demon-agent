# message.ts

> 对应源码：`src/core/llm/message.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

定义 system / developer / user / assistant / tool 五种消息，以及带新鲜 id、深冻结的构造器。消息一旦发布就不可变。

## 最小示例

```ts
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'

const user = createUserMessage({
  content: [{ type: 'text', text: 'hello' }],
  source: { kind: 'user' },
})

const callId = ToolCallId('call-1')
const result = createToolResultMessage({
  callId,
  content: [{ type: 'text', text: 'file contents' }],
  isError: false,
})

const assistant = createAssistantMessage({
  content: [
    { type: 'text', text: 'done' },
    { type: 'tool-call', id: callId, name: 'read_file', arguments: '{}' },
  ],
  source: { provider: 'deepseek', model: 'deepseek-chat' },
})

console.log(user.id, result.toolCallId, assistant.role)
```

## 要点

- 每个构造器都会生成新的 `MessageId`，并对结果做 `structuredClone` + `deepFreeze`。
- `createAssistantMessage()` 会自动补上 `source.kind: 'model'`；`createToolResultMessage()` 会让 `source.callId` 与 `toolCallId` 保持一致。
- `createSystemMessage('')` 表示“没有 system prompt”，内容为空数组。
- 需要保留已有 id 时用 `freezeMessage()`，不要用构造器重新生成。
