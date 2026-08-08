约定：每个节点一个目录，`index.ts` 是节点入口，`prompts/` 放该节点的 prompt 常量。渲染节点额外拆 `renderer.ts`。所有 KV 存取收敛到根目录 `storage.ts`，节点侧不出现裸 key。

# prod2adimg —— 核心约定速查

> 下次实现任意节点时只需读本文件 + design.md，无需任何其它上下文。

## 0. 工作流身份

- 前缀：`#prod:`（所有非 config KV 自动带此前缀，封在 Storage 内）
- 入口 KV：`product`（string[]）、`productImages`（string[]，可选）
- 首节点：extractProductProfile

## 1. 技术栈

- LLM：Vercel AI SDK `generateText`；结构化提取用 `safefmt`（仅渲染任务列表才需要）
- 模型：`getSmartModel(undefined, ctx)`（默认）；ctx.signal 自动透传，不手动传 abortSignal
- 图像：`getSmartImage(undefined, ctx)` + `generateImage`
- 并发：`p-map`，并发数 `configService().get("concurrency")`
- 门控：`checkExpiry(ctx, { inputKeys, outputKeys })`
- 存取：一律走 `Storage` 语义方法，节点侧禁止裸 key（gate 入参除外）

## 2. 铁律

- 节点间默认传自然语言 markdown，禁止让 LLM 直出 JSON
- 结构化提取统一走 safefmt（本工作流仅"渲染任务列表/结果"需要）
- 所有可落盘且被下游消费的产出，节点入口必须 checkExpiry 门控
- Storage.write 幂等：内容深度相等则跳过、不刷时间戳（防止误使下游过期）
- 门控 key 除入口 "product" 字面量外，一律经 Storage 的 key 方法取得

## 3. KV 表（全部封在 Storage 内）

| 语义        | key                      | 形态         |
| ----------- | ------------------------ | ------------ |
| 产品事实    | state:product_profile    | string       |
| 人群场景    | state:audience_scenarios | string       |
| 文案        | output:copywriting       | string       |
| 场景设计    | state:scene*design*<idx> | string       |
| 场景索引    | idx:scenes               | number[]     |
| 布局        | state:layout\_<sizeKey>  | string       |
| 布局索引    | idx:layouts              | string[]     |
| 渲染 prompt | render:prompt\_<taskId>  | string       |
| 渲染 seed   | render:seed\_<taskId>    | number       |
| 渲染结果    | render:result\_<taskId>  | RenderResult |
| 渲染索引    | idx:rendered             | string[]     |
| 总览        | output:render_overview   | string       |

## 4. 配置项（config: 命名空间，不带 #prod: 前缀）

config:size_preset / config:custom_width / config:custom_height
config:ad_style / config:color_scheme / config:font_style
默认值由 ensureDefaultConfig 首次落盘。

## 5. 节点链

extractProductProfile → identifyAudienceAndScenarios → generateCopywriting
→ designSceneBackgrounds(×3并发) → designLayouts(×N并发)
→ renderAdImages(×N×M全并发) → buildOverview

## 6. sizeKey 规则

用尺寸预设值直接做 key（如 "1200x1200"）；custom 用 "custom\_<w>x<h>"。

## 7. taskId 规则

ad*<sizeKey>*<style>\_<copySetIdx>
