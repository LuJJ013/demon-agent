# adapter-failure.ts

> 对应源码：`src/core/llm/adapter-failure.ts`。该模块是内部工具，不从 `@deepseek-ai/dsh-llm` barrel 导出。

## 用途

把适配器边界抛出的任意值（`Error`、字符串、SDK 异常）归一化成可序列化的 `LlmFailure`。`LlmRuntime` 在流结束时用它生成终止 chunk，避免把不可序列化的异常直接交给上层。

## 最小示例

```ts
import { HarnessError } from './error.ts'
import { normalizeLlmFailure } from './adapter-failure.ts'

const failure = normalizeLlmFailure(
  new HarnessError('provider timed out', 'TIMEOUT', { cause: new Error('socket hang up') }),
)

console.log(failure)
// { message: 'provider timed out', code: 'TIMEOUT' }
```

## 要点

- 只有 `HarnessError`（以及携带合法 `failure` 快照的异常）会保留原始 `code`；普通异常统一归为 `UNKNOWN`。
- 返回对象是冻结的，可直接放进 `finish` chunk 或日志。
- `LlmRuntime` 的内部适配器边界用它把抛出值转成 `{ kind: 'error' | 'aborted', failure }`。
