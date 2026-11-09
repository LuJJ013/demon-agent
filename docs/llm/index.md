# index.ts

> 对应源码：`src/core/llm/index.ts`。示例按上游包名书写；本仓库的 `src/core/llm` 是源码副本。

## 用途

`LlmRuntime` 是 Cordis 的 `llm` 服务：它维护 provider → adapter 的路由表，暴露流式 `stream()`、一次性 `prepareCall()`、模型查询和可配置 provider 目录。`LlmAdapter` 是实现 provider wire 协议的唯一抽象。

## 最小示例

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class EchoAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hello' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const ctx = new Context()
const llm = new LlmRuntime(ctx)
llm.registerAdapter(['echo'], new EchoAdapter())

const request: GenerateOptions = {
  provider: 'echo',
  model: 'echo-1',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

for await (const chunk of llm.stream(request)) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
}
```

## 要点

- `LlmRuntime` 构造时以 `llm` 名称注册到传入的 Cordis context，之后可通过 `ctx.llm` 使用。
- `registerAdapter()` 至少注册一个 provider，且是 all-or-nothing；返回的 disposer 还带 `replace()`，可原子替换路由。
- `stream()` 会把适配器选择、迭代和 dispatch 失败归一化成终止 `finish` chunk；middleware 和消费者错误仍然抛出。
- `prepareCall()` 在 dispatch 前固定 route、模型元数据和默认值，并要求调用方用完全相同的 `LlmCallConfig` 发起一次流。
- `llm/stream` 是 waterfall 扩展点，重试、回放和路由可以在不修改调用方的情况下介入。
