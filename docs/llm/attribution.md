# attribution.ts

> 对应源码：`src/core/llm/attribution.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

统一生成 provider 请求的 `User-Agent` 归因头，避免每个适配器各写一份产品标识。

## 最小示例

```ts
import { attributionHeaders, userAgent } from '@deepseek-ai/dsh-llm'

const headers = attributionHeaders({
  product: 'my-agent',
  version: '1.0.0',
  url: 'https://example.com',
})

console.log(headers['user-agent'])
// my-agent/1.0.0 (+https://example.com)

console.log(userAgent()) // 使用默认的 deepseek-harness 标识
```

## 要点

- 省略 `identity` 时使用 `APP_IDENTITY`，归因不能被完全关闭。
- 每个 provider HTTP 请求都应合并 `attributionHeaders()` 的返回值。
- 默认版本号从包自身的 `package.json` 读取；本仓库的复制目录没有 `package.json`，直接运行该模块需要补上包清单或打包产物。
