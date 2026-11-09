# retry-policy.ts

> 对应源码：`src/core/llm/retry-policy.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

定义 provider 自己的模型请求重试策略，并在注册适配器时把配置解析成不可变对象。`LlmRuntime` 会把解析结果和适配器注册绑定在一起。

## 最小示例

```ts
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'

const policy = resolveRetryPolicy(
  {
    mode: 'normal',
    maxRetries: 3,
    retryableCodes: ['RATE_LIMIT', 'TIMEOUT'],
  },
  'llm.providers.deepseek.retryPolicy',
)

if (policy.mode === 'normal') {
  console.log(policy.maxRetries) // 3
  console.log(policy.retryableCodes) // ['RATE_LIMIT', 'TIMEOUT']
}
```

## 要点

- `mode: 'normal'` 只重试 `retryableCodes` 中的错误，默认最多 5 次。
- `mode: 'always'` 会重试所有模型请求失败，直到成功、取消或释放。
- 省略配置时得到 normal 默认策略：`maxRetries: 5`、退避从 500ms 开始、最大 10s、10% 抖动。
- `RetryPolicySchema` 是 Cordis 配置层使用的 schemastery schema，不替代 `resolveRetryPolicy()` 的运行时校验。
