# content.ts

> 对应源码：`src/core/llm/content.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

处理请求内容块在 provider 边界上的投影：文件、图片、tool 更新和附件路径。它把持久化内容转换成某条 route 真正能发送的形态，同时保留日志里的结构化引用。

## 最小示例

```ts
import { projectToolUpdates } from '@deepseek-ai/dsh-llm'

const { messages, tools } = projectToolUpdates(
  [],
  [{
    name: 'read_file',
    description: 'Read a file',
    parameters: {},
    deferLoading: true,
  }],
  undefined,
)

console.log(messages) // []
console.log(tools)
// [{ name: 'read_file', description: 'Read a file', parameters: {} }]
```

## 要点

- `toolUpdate` 为 `undefined` 时，route 不支持增量工具声明：developer 更新消息会被移除，`deferLoading` 会被去掉，工具立即完整可用。
- 文件块在所有 route 上都会投影成 `fileHandleText()`，provider 永远不会收到原生文件。
- 图片只在支持图片的 route 上保留；text-only route 用 `projectImagesForTextModel()` 替换成稳定占位文本。
- `requiredImageOffload()` 计算某条 route 还需要卸载多少张最旧的图片；`projectToolUpdates()` 的 `in-history` / `addition-only` 模式需要传入 `ToolHistory`。
