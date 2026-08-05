# KV-Store速查手册：剧本→视频工作流

---

## 快速定位通配符

```
#video:output:%        所有人类可读总览
#video:render:result_%     所有已渲染图片路径
#video:video:result_%      所有已渲染视频路径
#video:video:concat_plan   ffmpeg 拼接计划（含 episodes[]）
#video:refimg:shot_%       所有视频镜头提示词
#video:refimg:entity_%     所有实体定妆照提示词
#video:refimg:env_%        所有场景环境图提示词
#video:refimg:uniform_%    所有制服三视图提示词
#video:shots:design_%      所有分镜序列设计
#video:shots:asset_%       所有实体素材扩写（base+delta+光影）
#video:char:identity_%     所有角色身份推断
#video:char:costume_%      所有角色服装设计
#video:stage:registry:%    全局实体登记册
#video:output:aligned_text_%   名称对齐后的场景原文
#video:parse:scene:%       场景元数据（标题/行号/地点/人物）
```

---

## 零层：全局配置（用户可调）

| Key | 含义 | 取值 | 默认 | 读取方 |
| --- | --- | --- | --- | --- |
| `config:pace` | 节奏基调 | normal / slow / fast | normal | design-shots |
| `config:aspectRatio` | 显示画幅（视频宽高比） | 9:16 / 16:9 / 1:1 / 4:3 / 3:4 / 21:9 / 4:5 / 2:1 | 9:16 | design-shots / render-videos / concat-videos |
| **`config:resolution`** | **视频分辨率（语义标签，自动映射成像素规格）** | **480p / 720p / 1080p / 4k** | **480p** | **render-videos → AI SDK `resolution`** |
| **`config:frameRate`** | **视频帧率（fps）** | **整数（一般 24/30/60）** | **24** | **render-videos → AI SDK `fps`** |
| **`config:duration`** | **单集长度上限（控制剧集切分）** | **unlimited / 30s / 60s / 3min / 5min / 10min / 20min / 40min / 60min** | **3min** | **concat-videos → episodes[]** |
| `config:style` | 视觉风格 | cinematic / anime / cg / live / watercolor / comic / pixel / noir | cinematic | design-shots / refsheet |
| `config:audience` | 受众分级 | g / pg / pg13 / r / nc17 | pg | design-shots |
| `config:colorTone` | 色调倾向 | warm_vibrant / warm_muted / neutral / cool_crisp / cool_moody | neutral | design-shots / refsheet |
| `config:cameraMovement` | 运镜风格 | tripod / smooth / natural / handheld | smooth | design-shots |

**默认值来源**：`parse-script/index.ts` 的 `ensureDefaultConfig`（首次运行自动落盘）。
**如何改**：dashboard / 上层 UI 调 `prjdb.set(config:xxx, 新值)`，时间戳自动 bump，下游节点通过 gate 自动感知。

### 配置 → 像素规格映射表

| `config:resolution` | 映射到 AI SDK `resolution` |
| --- | --- |
| `480p` | `854x480` |
| `720p` | `1280x720` |
| `1080p` | `1920x1080` |
| `4k` | `3840x2160` |
| 其他值 | 不传（由模型自行决定） |

> ⚠️ 注：AI SDK 的 `aspectRatio` 与 `resolution` 是两个独立字段。模型收到 `aspectRatio: "9:16"` + `resolution: "854x480"` 时，按 provider 实现决定具体输出像素。如 provider 有特殊约定，告诉我可调整映射。

### 单集长度切分规则

| `config:duration` 取值 | 集数 | 说明 |
| --- | --- | --- |
| `unlimited` | 1 | 全部 segment 拼成单集 |
| `30s` / `60s` | 多集（按累计 segment 时长切分） | 累计时长超过上限即换集 |
| `3min` / `5min` / `10min` / `20min` | 同上（默认） | 同上 |
| `40min` / `60min` | 同上（适用于长剧） | 同上 |
| 解析失败的回退值 | 1 集 / `3min` 等价 | 见 `resolveEpisodeBudget` |

切分粒度：**按时长累计**（不是按 segment 数）。每集总时长 ≤ 上限（除最后一集可能不饱满）。

---

## 第一层：最终交付物

| Key | 含义 |
| --- | --- |
| `#video:output:render_overview` | 所有渲染任务状态总览（✓已完成 / ✗未渲染） |
| `#video:output:refimg_overview` | 所有参考图提示词 + 所有视频镜头提示词 |
| `#video:output:shots_overview` | 分镜序列 + 光照方案 + 素材描述总览 |
| `#video:output:stage_overview` | 实体登记册 + 每场环境/实体/站位总览 |
| `#video:output:char_design_overview` | 角色身份 + 服装设计总览 |
| **`#video:video:concat_plan`** | **ffmpeg 拼接计划（含按 config:duration 切分的 episodes[]）** |

---

## 第二层：渲染产物

### 2A：图片渲染

| Key | 含义 |
| --- | --- |
| `#video:render:result_<taskId>` | 渲染结果：file_path（相对路径）、seed、rendered_at |
| `#video:render:idx:rendered` | 已成功渲染的图片任务 id 列表 |
| `#video:render:params_<taskId>` | 该任务实际使用的 generateImage 参数（含组装后的完整 prompt + 参考图列表） |
| `#video:render:seed_<taskId>` | 该任务固定 seed（删除后下次重新随机） |

### 2B：视频渲染

| Key | 含义 |
| --- | --- |
| `#video:video:result_<segId>` | 视频渲染结果：file_path（`vids/<stem>.mp4`）、duration_seconds、rendered_at、seed |
| `#video:video:idx:rendered` | 已成功渲染的视频 segment 列表 |
| `#video:video:params_<segId>` | 该 segment 实际使用的 generateVideo 参数（prompt / inputReferences / duration_seconds / aspect_ratio / **resolution（来自 config:resolution）/ frame_rate（来自 config:frameRate）** / seed） |
| `#video:video:seed_<segId>` | 该 segment 固定 seed（删除后下次重新随机） |

**taskId / segmentId 规则：**

| 类型 | id 格式 |
| --- | --- |
| 实体定妆照 / 群体合照 | `<sceneId>__<entityName>` |
| 制服三视图 | `uniform:<uniformName>` |
| 场景环境图 | `env:<sceneId>` |
| 视频 segment | `<sceneId>_<segmentIdx>`（如 `S001_1`） |

---

## 第三层：参考图与镜头提示词

| Key | 含义 |
| --- | --- |
| `#video:refimg:shot_<sceneId>_<shotIndex>` | 单镜视频导演指令：保留运动动词的 prompt + 引用的参考图清单 + 景别/运镜/时长 |
| `#video:refimg:idx:shots_<sceneId>` | 本场景的镜头序号列表 |
| `#video:refimg:entity_<sceneId>_<entityName>` | 实体定妆照提示词：layout（四列/三列/杂志网格/群体合照）+ 白背景 prompt |
| `#video:refimg:env_<sceneId>` | 场景环境基底图提示词：三阶段设计（初稿/细化/评审）+ 最终 prompt |
| `#video:refimg:uniform_<uniformName>` | 制服三视图提示词 |
| `#video:refimg:render_tasks` | 所有渲染任务的完整描述符列表（供 render-images 节点消费） |
| `#video:refimg:idx:entities` | 已生成定妆照的 `<sceneId>__<entityName>` 列表 |
| `#video:refimg:idx:scenes` | 已生成环境图的场景列表 |
| `#video:refimg:idx:uniforms` | 已生成制服三视图的制服列表 |

---

## 第四层：分镜与素材设计

| Key | 含义 |
| --- | --- |
| `#video:shots:design_<sceneId>` | 分镜序列全文（景别/运镜/视觉焦点/色彩光影/转场/画面描述） |
| `#video:shots:lighting_<sceneId>` | 场景统一光照方案（主光方向/色温/补光/氛围/整体效果） |
| `#video:shots:asset_<sceneId>_<entityName>` | 单实体在本场的视觉描述：base_description（跨场不变）+ scene_delta（本场变化）+ lighting_effect |
| `#video:shots:asset_constraints` | 全局素材约束：每个实体首次出场时锁定的 base_description，后续场景不可硬冲突 |
| `#video:shots:intent_<sceneId>` | 场景意图：核心动作/情绪/参与人数/空间类型/节奏/AI 风险点 |
| `#video:shots:idx:scenes` | 已完成分镜设计的场景列表 |

---

## 第五层：角色与实体数据

| Key | 含义 |
| --- | --- |
| `#video:char:identity_<name>` | 角色身份：职业/族裔/年龄段/性别/体型/是否制服化群体/所属制服化群体 |
| `#video:char:costume_<name>_<sceneId>` | 该角色在本场的服装设计（整体描述/时代参照/构件清单） |
| `#video:char:uniform_<uniformName>` | 群体制服设计（含穿着者性别/体型/构件清单） |
| `#video:char:idx:uniforms` | 已设计的制服名列表 |
| `#video:char:render_decision_<sceneId>_<entityName>` | 渲染策略：individual_refsheet / uniform_refsheet / group_photo / prompt_only / skip |
| `#video:char:idx:scene_decisions_<sceneId>` | 本场已决策实体名列表 |

---

## 第六层：实体身份对齐

| Key | 含义 |
| --- | --- |
| `#video:stage:registry:idx` | 全部已登记实体的规范名列表 |
| `#video:stage:registry:<name>` | 单实体登记：kind/appearance/scenes/humanoid/count/origin |
| `#video:output:aligned_text_<sceneId>` | 名称对齐后的场景原文（所有代词已替换为「规范名」） |
| `#video:stage:align:<sceneId>` | 局部名→全局规范名映射 |
| `#video:stage:time_skips:<name>` | 该实体在哪些场景发生了时间跳跃 |
| `#video:stage:snapshots:<name>` | 该实体在各场景的 costume 引用快照 |
| `#video:state:stage_<sceneId>` | 结构化舞台：环境 + 实体清单 + 开场站位 |
| `#video:state:beat_nl_<sceneId>` | 节拍时间线（每拍的动作/台词/情绪/来源群体） |
| `#video:state:worn_props_<sceneId>` | 穿在角色身上的道具增量（按角色分组） |

---

## 第七层：场景解析（底层，极少直接接触）

| Key | 含义 |
| --- | --- |
| `#video:parse:idx:scenes` | 全部场景 id 列表（按行号升序） |
| `#video:parse:scene:<sceneId>` | 场景元数据：title/line_start/line_end/location/timeOfDay/charactersInvolved/transition_from_prev |
| `#video:parse:synopsis` | 从剧本开头提取的故事梗概 |
| `#video:parse:format` | LLM 自动识别的剧本格式规律 |
| `#video:parse:global_items` | 全局信息条目（梗概/人物表/序言等，含行号区间） |
| `#video:parse:chunk_result:<chunkId>` | 单 chunk 的处理结果缓存 |
| `#video:stage:audit:state` | 登记册反向审计状态 |
| `#video:state:stage_nl_<sceneId>` | Pass A LLM 自然语言草稿（中间产物） |

---

## 第八层：Plan & Concat（视频片段与拼片）

| Key | 含义 |
| --- | --- |
| **`#video:video:segment_<sceneId>_<segIdx>`** | **单 segment KV（≤15s 一镜到底的视频生成单元）** |
| **`#video:video:idx:segments_<sceneId>`** | **本场景已切分出的 segment idx 列表** |
| **`#video:video:concat_plan`** | **ffmpeg 拼接计划（含 episodes[]）** |

### segment 内容（每个 segment 一份）

```ts
interface VideoSegment {
    segment_id: string;                          // "S001_1"
    scene_id: string;                            // "S001"
    shot_indices: number[];                      // 被合并的镜头序号
    total_duration: string;                      // "约12秒" / "约15秒"
    start_timestamp: string;                     // "0秒"
    end_timestamp: string;                       // "12秒"
    is_continuous: boolean;                      // 强制 true（一镜到底）
    camera_motion_trajectory: string;            // 跨镜头连贯运镜描述
    shot_breakdown: SegmentShot[];               // 各镜头的时间戳/景别/运镜/对白
    reference_images: Array<{ ref_id: string; entity_name: string; role: string }>;
    prompt: string;                              // 含时间戳 + 对白 + 负面约束的最终 LLM 产出
    has_dialogue: boolean;
}
```

### concat_plan 内容（含 episodes[]）

```ts
interface ConcatPlan {
    final_command: string;                       // 整片一次性（兼容字段；与 episodes[0].command 等价 或 全部一并拼）
    per_scene_commands: Array<{ scene_id: string; command: string; input_count: number }>;
    input_files: Array<{ segment_id: string; file_path: string; duration_seconds: number }>;
    episodes: EpisodeConcat[];                   // ← 按 config:duration 切分后的集列表
    stats: {
        total_segments: number;
        total_duration_seconds: number;
        total_scenes: number;
        total_episodes: number;                  // 新增
    };
    generated_at: number;
}

interface EpisodeConcat {
    episode_index: number;                       // 1-based
    episode_id: string;                          // "episode_001" / "episode_002" / ...
    output_file: string;                         // "episode_001.mp4"
    command: string;                             // 该集对应的 ffmpeg 命令
    input_files: string[];                       // 该集包含的 segment 文件路径（相对路径）
    segment_ids: string[];                       // 该集包含的 segment ID
    duration_seconds: number;                    // 该集总时长
    input_count: number;                         // 该集包含的 segment 数
}
```

### `config:duration` 切分规则

- `unlimited` → 1 集（包含全部 segment，episodes.length === 1）
- 其他值 → 累计 segment 时长超过上限时换集；保证每集总时长 ≤ 上限（除最后一集可能不饱满）

`final_command` 兼容性说明：
- unlimited 时与 `episodes[0].command` 等价
- 多集时为全集一次性拼接（仅供回放校验 / 备份冗余；实际生产输出按 episodes[] 切分）

---

## 常用操作速查

| 想做什么 | 操作 |
| --- | --- |
| 看全部渲染图的完成情况 | 读 `#video:output:render_overview` |
| 看全部视频渲染的完成情况 | 读 `#video:video:idx:rendered` |
| 找某场戏第3镜的视频提示词 | 读 `#video:refimg:shot_S001_3` |
| 找某角色的定妆照提示词 | 搜 `#video:refimg:entity_<sceneId>_<name>` |
| 修改角色外观描述 | 改 `#video:stage:registry:<name>` 的 appearance |
| 修改角色本场服装 | 改 `#video:char:costume_<name>_<sceneId>` |
| 强制重渲某张图（保seed） | 删 `#video:render:result_<taskId>` |
| 换随机结果重渲 | 删 `#video:render:seed_<taskId>` 再删 result |
| 强制重渲某段视频（保seed） | 删 `#video:video:result_<segId>` |
| 强制重算某场分镜 | 删 `#video:shots:design_<sceneId>` |
| 强制重算某场环境图提示词 | 删 `#video:refimg:env_<sceneId>` |
| 强制重算某场 segment 切分 | 删 `#video:video:segment_<sceneId>_<segIdx>` + `<sceneId>_idx` |
| 强制重算拼接计划 | 删 `#video:video:concat_plan` |
| 切换视频分辨率 | 改 `config:resolution`，删 `#video:video:result_<segId>` + 全量重渲 |
| 切换视频帧率 | 改 `config:frameRate`，删 `#video:video:result_<segId>` + 全量重渲 |
| 切换单集长度 | 改 `config:duration`，删 `#video:video:concat_plan` |
| 强制全节点重算（慎用） | 按上表从第七层往上逐层删对应前缀的 key |