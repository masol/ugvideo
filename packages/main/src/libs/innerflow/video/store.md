# KV-Store速查手册：剧本→视频工作流

---

## 快速定位通配符

```
#video:output:%    所有人类可读总览
#video:render:result_%             所有已渲染图片路径
#video:refimg:shot_%               所有视频镜头提示词
#video:refimg:entity_%             所有实体定妆照提示词
#video:refimg:env_%                所有场景环境图提示词
#video:refimg:uniform_%            所有制服三视图提示词
#video:shots:design_%              所有分镜序列设计
#video:shots:asset_%               所有实体素材扩写（base+delta+光影）
#video:char:identity_%             所有角色身份推断
#video:char:costume_%所有角色服装设计
#video:stage:registry:%            全局实体登记册
#video:output:aligned_text_%       名称对齐后的场景原文
#video:parse:scene:%               场景元数据（标题/行号/地点/人物）
```

---

## 第一层：最终交付物

| Key                                  | 含义                                     |
| ------------------------------------ | ---------------------------------------- |
| `#video:output:render_overview`      | 所有渲染任务状态总览（✓已完成 /✗未渲染） |
| `#video:output:refimg_overview`      | 所有参考图提示词 + 所有视频镜头提示词    |
| `#video:output:shots_overview`       | 分镜序列 + 光照方案 + 素材描述总览       |
| `#video:output:stage_overview`       | 实体登记册 + 每场环境/实体/站位总览      |
| `#video:output:char_design_overview` | 角色身份 + 服装设计总览                  |

---

## 第二层：渲染产物

| Key                             | 含义                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `#video:render:result_<taskId>` | 渲染结果：file_path（相对路径）、seed、rendered_at                        |
| `#video:render:idx:rendered`    | 已成功渲染的任务 id列表                                                   |
| `#video:render:params_<taskId>` | 该任务实际使用的 generateImage 参数（含组装后的完整 prompt + 参考图列表） |
| `#video:render:seed_<taskId>`   | 该任务固定 seed（删除后下次重新随机）                                     |

**taskId 规则：**

| 类型                  | taskId 格式               |
| --------------------- | ------------------------- |
| 实体定妆照 / 群体合照 | `<sceneId>__<entityName>` |
| 制服三视图            | `uniform:<uniformName>`   |
| 场景环境图            | `env:<sceneId>`           |

---

## 第三层：参考图与镜头提示词

| Key                                           | 含义                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `#video:refimg:shot_<sceneId>_<shotIndex>`    | 单镜视频导演指令：保留运动动词的 prompt + 引用的参考图清单 + 景别/运镜/时长 |
| `#video:refimg:idx:shots_<sceneId>`           | 本场景的镜头序号列表                                                        |
| `#video:refimg:entity_<sceneId>_<entityName>` | 实体定妆照提示词：layout（四列/三列/杂志网格/群体合照）+ 白背景 prompt      |
| `#video:refimg:env_<sceneId>`                 | 场景环境基底图提示词：三阶段设计（初稿/细化/评审）+ 最终 prompt             |
| `#video:refimg:uniform_<uniformName>`         | 制服三视图提示词                                                            |
| `#video:refimg:render_tasks`                  | 所有渲染任务的完整描述符列表（供 render-images 节点消费）                   |
| `#video:refimg:idx:entities`                  | 已生成定妆照的 `<sceneId>__<entityName>` 列表                               |
| `#video:refimg:idx:scenes`                    | 已生成环境图的场景列表                                                      |
| `#video:refimg:idx:uniforms`                  | 已生成制服三视图的制服列表                                                  |

---

## 第四层：分镜与素材设计

| Key                                         | 含义                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `#video:shots:design_<sceneId>`             | 分镜序列全文（景别/运镜/视觉焦点/色彩光影/转场/画面描述）                                      |
| `#video:shots:lighting_<sceneId>`           | 场景统一光照方案（主光方向/色温/补光/氛围/整体效果）                                           |
| `#video:shots:asset_<sceneId>_<entityName>` | 单实体在本场的视觉描述：base_description（跨场不变）+ scene_delta（本场变化）+ lighting_effect |
| `#video:shots:asset_constraints`            | 全局素材约束：每个实体首次出场时锁定的 base_description，后续场景不可硬冲突                    |
| `#video:shots:intent_<sceneId>`             | 场景意图：核心动作/情绪/参与人数/空间类型/节奏/AI 风险点                                       |
| `#video:shots:idx:scenes`                   | 已完成分镜设计的场景列表                                                                       |

---

## 第五层：角色与实体数据

| Key                                                  | 含义                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `#video:char:identity_<name>`                        | 角色身份：职业/族裔/年龄段/性别/体型/是否制服化群体/所属制服化群体                  |
| `#video:char:costume_<name>_<sceneId>`               | 该角色在本场的服装设计（整体描述/时代参照/构件清单）                                |
| `#video:char:uniform_<uniformName>`                  | 群体制服设计（含穿着者性别/体型/构件清单）                                          |
| `#video:char:idx:uniforms`                           | 已设计的制服名列表                                                                  |
| `#video:char:render_decision_<sceneId>_<entityName>` | 渲染策略：individual_refsheet / uniform_refsheet / group_photo / prompt_only / skip |
| `#video:char:idx:scene_decisions_<sceneId>`          | 本场已决策实体名列表                                                                |

---

## 第六层：实体身份对齐

| Key                                    | 含义                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `#video:stage:registry:idx`            | 全部已登记实体的规范名列表                               |
| `#video:stage:registry:<name>`         | 单实体登记：kind/appearance/scenes/humanoid/count/origin |
| `#video:output:aligned_text_<sceneId>` | 名称对齐后的场景原文（所有代词已替换为「规范名」）       |
| `#video:stage:align:<sceneId>`         | 局部名→ 全局规范名映射                                   |
| `#video:stage:time_skips:<name>`       | 该实体在哪些场景发生了时间跳跃                           |
| `#video:stage:snapshots:<name>`        | 该实体在各场景的 costume 引用快照                        |
| `#video:state:stage_<sceneId>`         | 结构化舞台：环境 + 实体清单 + 开场站位                   |
| `#video:state:beat_nl_<sceneId>`       | 节拍时间线（每拍的动作/台词/情绪/来源群体）              |
| `#video:state:worn_props_<sceneId>`    | 穿在角色身上的道具增量（按角色分组）                     |

---

## 第七层：场景解析（底层，极少直接接触）

| Key                                   | 含义                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `#video:parse:idx:scenes`             | 全部场景 id 列表（按行号升序）                                                                   |
| `#video:parse:scene:<sceneId>`        | 场景元数据：title/line_start/line_end/location/timeOfDay/charactersInvolved/transition_from_prev |
| `#video:parse:synopsis`               | 从剧本开头提取的故事梗概                                                                         |
| `#video:parse:format`                 | LLM 自动识别的剧本格式规律                                                                       |
| `#video:parse:global_items`           | 全局信息条目（梗概/人物表/序言等，含行号区间）                                                   |
| `#video:parse:chunk_result:<chunkId>` | 单chunk 的处理结果缓存                                                                           |
| `#video:stage:audit:state`            | 登记册反向审计状态                                                                               |
| `#video:state:stage_nl_<sceneId>`     | Pass A LLM 自然语言草稿（中间产物）                                                              |

---

## 常用操作速查

| 想做什么                  | 操作                                            |
| ------------------------- | ----------------------------------------------- |
| 看全部渲染图的完成情况    | 读`#video:output:render_overview`               |
| 找某场戏第3镜的视频提示词 | 读 `#video:refimg:shot_S001_3`                  |
| 找某角色的定妆照提示词    | 搜 `#video:refimg:entity_<sceneId>_<name>`      |
| 修改角色外观描述          | 改 `#video:stage:registry:<name>` 的 appearance |
| 修改角色本场服装          | 改 `#video:char:costume_<name>_<sceneId>`       |
| 强制重渲某张图（保seed）  | 删 `#video:render:result_<taskId>`              |
| 换随机结果重渲            | 删 `#video:render:seed_<taskId>` 再删 result    |
| 强制重算某场分镜          | 删 `#video:shots:design_<sceneId>`              |
| 强制重算某场环境图提示词  | 删 `#video:refimg:env_<sceneId>`                |
| 强制全节点重算（慎用）    | 按上表从第七层往上逐层删对应前缀的key           |
