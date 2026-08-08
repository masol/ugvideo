约定：每个节点一个目录，`index.ts` 是节点入口，`prompts/` 放该节点的 prompt 常量。渲染节点额外拆 `renderer.ts`。所有 KV 存取收敛到根目录 `storage.ts`，节点侧不出现裸 key。

# prod2adimg —— 核心约定速查

> 下次实现任意节点时只需读本文件 + design.md，无需任何其它上下文。

## 0. 工作流身份

- 前缀：`#prod:`（所有非 config KV 自动带此前缀，封在 Storage 内）
- 入口 KV：`product`（string[]）、`productImages`（string[]，可选）
- 首节点：extractProductProfile

## 1. 技术栈

- LLM：Vercel AI SDK `generateText`；结构化提取用 `safefmt`
- 模型：`getSmartModel(undefined, ctx)`（默认）；ctx.signal 自动透传
- 图像：`getSmartImage(undefined, ctx)` + `generateImage`
- 并发：`p-map`，并发数 `configService().get("concurrency")`
- 门控：`checkExpiry(ctx, { inputKeys, outputKeys })`
- 存取：一律走 `Storage` 语义方法

## 2. 铁律

- 节点间默认传自然语言 markdown
- 结构化提取统一走 safefmt（本工作流仅"渲染结果/人群报告"需要）
- 所有可落盘且被下游消费的产出，节点入口必须 checkExpiry 门控
- Storage.write 幂等：内容深度相等则跳过、不刷时间戳
- 门控 key 除入口 "product" 字面量外，一律经 Storage 的 key 方法取得
- **identify-audience-scenarios 走 ReAct 自检循环**（最多 3 轮）：每轮生成→LLM 评审挑刺→结构化抽取→程序化校验，有问题则打回重生成
- **prompt 指令式优先**：所有设计类 prompt 强制要求"命令句法"，禁止"描述句法"
- **场景设计消费结构化 AudienceReport**（含人群五要素 + 场景正交三元组），不再从 NL 文本里 regex 切块

## 3. KV 表（全部封在 Storage 内）

| 语义              | key                         | 形态                  |
| ----------------- | --------------------------- | --------------------- |
| 产品事实          | state:product_profile       | string                |
| 人群场景 NL       | state:audience_scenarios    | string                |
| **结构化人群报告** | **state:audience_report**   | **AudienceReport**    |
| 文案              | output:copywriting          | string                |
| 场景设计          | state:scene_design_<idx>    | string                |
| 场景索引          | idx:scenes                  | number[]              |
| 布局              | state:layout_<sizeKey>      | string                |
| 布局索引          | idx:layouts                 | string[]              |
| 渲染 prompt       | render:prompt_<taskId>      | string                |
| 渲染 seed         | render:seed_<taskId>        | number                |
| 渲染结果          | render:result_<taskId>      | RenderResult          |
| 渲染索引          | idx:rendered                | string[]              |
| 总览              | output:render_overview      | string                |

## 4. 配置项（config: 命名空间，不带 #prod: 前缀）

config:size_preset / config:custom_width / config:custom_height
config:ad_style / config:color_scheme / config:font_style

## 5. 节点链

extractProductProfile → identifyAudienceAndScenarios（ReAct 自检 3 轮）
→ generateCopywriting → designSceneBackgrounds(×N 并发，消费结构化报告)
→ designLayouts(×N 并发，指令式 prompt)
→ renderAdImages(×N×M 全并发) → buildOverview

## 6. sizeKey 规则

用尺寸预设值直接做 key（如 "1200x1200"）；custom 用 "custom_<w>x<h>"。

## 7. taskId 规则

ad_<sizeKey>_<style>_<copySetIdx>