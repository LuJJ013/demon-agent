# assistant-stream.ts

> 对应源码：`src/core/llm/assistant-stream.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

把一次模型流式尝试压缩成可持久化的紧凑记录，并提供从记录中恢复文本、首 token 时间、可见内容等读取能力。

## 最小示例

```ts
import {
  AssistantStreamAccumulator,
  assembleAssistantStream,
  joinAssistantStreamText,
} from '@deepseek-ai/dsh-llm'

const accumulator = new AssistantStreamAccumulator()
accumulator.push({ time: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } })
accumulator.push({ time: 2, chunk: { type: 'text-delta', index: 0, text: 'lo' } })

const records = accumulator.snapshot()
console.log(joinAssistantStreamText(records)) // 'Hello'

const assembler = assembleAssistantStream(records)
console.log(assembler.blocks()) // [{ type: 'text', text: 'Hello' }]
```

## 要点

- `AssistantStreamAccumulator` 会把连续的 text/reasoning/tool-call delta 压成带时间差的 run；`block-start`、`block-end`、`usage`、`finish` 保留为原始 chunk 记录。
- `expandAssistantStream()` 是读取持久化记录的校验入口；`assembleAssistantStream()` 信任记录类型，不重复校验。
- `runFirstTokenTime()`、`assistantStreamFirstTokenTime()`、`assistantStreamHasVisibleText()` 等读取函数不需要展开全部 chunk。
- 记录中的时间必须是安全整数，chunk 必须能无损 JSON 序列化。
