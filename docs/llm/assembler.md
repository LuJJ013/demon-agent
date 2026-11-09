# assembler.ts

> 对应源码：`src/core/llm/assembler.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

把适配器吐出的原始 `StreamChunk` 增量组装成完整的 `ContentBlock` 和最终 assistant message。agent loop 用它一边接收流式输出，一边保留原始 chunk 用于回放。

## 最小示例

```ts
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

const assembler = new BlockAssembler()

assembler.push({ type: 'block-start', index: 0, blockType: 'text' })
assembler.push({ type: 'text-delta', index: 0, text: 'Hello' })
assembler.push({ type: 'text-delta', index: 0, text: ', world' })
assembler.push({
  type: 'block-end',
  index: 0,
  block: { type: 'text', text: 'Hello, world' },
})
assembler.push({ type: 'finish', reason: { kind: 'stop' } })

const message = assembler.message({ provider: 'deepseek', model: 'deepseek-chat' })
console.log(message.content) // [{ type: 'text', text: 'Hello, world' }]
```

## 要点

- 没有 `block-start` / `block-end` 的 delta-only 流也能组装；未闭合的文本块会用已累积的 delta 生成。
- `finish.kind === 'max-tokens'` 时，无法安全执行的 tool-call 块会被丢弃，避免截断参数进入工具执行。
- `usage`、`finish`、`replayState` 分别保留最后一次 `usage`、终止原因和回放元数据。
- 流被取消时用 `interruptedBlocks()` 只保留已闭合或非空的 text/reasoning 前缀。
