# api-key.ts

> 对应源码：`src/core/llm/api-key.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

判断一个“已经提供”的 provider API key 是否可用。它不负责判断 key 是否存在，只负责去空白、拒绝空值和 HTTP header 无法承载的字符。

## 最小示例

```ts
import { normalizeApiKey } from '@deepseek-ai/dsh-llm'

const checked = normalizeApiKey('  sk-123  ')

if (checked.ok) {
  console.log(checked.value) // 'sk-123'
} else {
  console.log(checked.reason) // 'empty' | 'illegalCharacters'
}
```

## 要点

- 会先 `trim()`，所以首尾空白不会导致失败。
- 合法字符集是可打印 ASCII（空格除外）；超出该范围的值不会进入 HTTP header。
- 不处理“没有提供 key”的情况，调用方需要先判断配置是否存在。
- 需要在失败时直接抛错，可使用 `index.ts` 的 `assertUsableApiKey()`。
