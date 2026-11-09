# error.ts

> 对应源码：`src/core/llm/error.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

定义 harness 的统一错误基类 `HarnessError`，以及一组稳定的 provider-neutral 错误码和诊断辅助函数。上层应依据 `code` 路由，而不是解析 `message`。

## 最小示例

```ts
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  HarnessError,
  errorChain,
  isHarnessError,
} from '@deepseek-ai/dsh-llm'

try {
  throw new HarnessError(
    'context window exceeded',
    CONTEXT_WINDOW_EXCEEDED_CODE,
    { cause: new Error('400 Bad Request') },
  )
} catch (error) {
  if (isHarnessError(error)) {
    console.log(error.code) // CONTEXT_WINDOW_EXCEEDED
    console.log(errorChain(error)) // context window exceeded: 400 Bad Request
  }
}
```

## 要点

- `HarnessError.code` 是稳定的机器可路由值；`message` 只用于展示。
- `errorChain()` 会展开 `cause` 链和 `AggregateError`，适合日志与 UI 通知，不适合程序判断。
- `isContextWindowExceededError()`、`isQuotaExceededError()` 用于把 provider 文案归类成统一错误码。
- `LlmError` 继承自 `HarnessError`，并附带可序列化的 `failure` 快照。
