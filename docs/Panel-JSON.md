# 动态面板 JSON 编写指南

侧边栏面板由一棵 JSON 描述。你只写 JSON，不碰代码。每个节点用 `type` 决定长什么样，`children` 里放子节点。

## 通用约定

- 所有文字都写在 JSON 里（标题、提示、按钮文案……）。
- 没写的字段就不显示，别指望有默认业务值。
- 不要写 `id`，列表顺序自动处理。

## 数据绑定 binding

需要读写数据的节点，用 `binding` 指定存到哪个 key：

    "binding": { "key": "book_name" }

| 字段       | 必填 | 说明                                                                                                                               |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `key`      | 是   | 存/取用的键名                                                                                                                      |
| `readonly` | 否   | `true` 只读、禁止编辑（默认可编辑）                                                                                                |
| `track`    | 否   | 是否监听「外部对这个 key 的改动」。默认 `false`：只有本控件自己改它。若这个值可能被后台流程或别处同时改动、需要自动刷新，填 `true` |

首次打开时会自动读取最新值并显示加载态，你无需关心。

## 节点类型

### panel（根容器）

    { "type": "panel", "children": [ /* 子节点 */ ] }

### accordion-section（可折叠区块）

    {
      "type": "accordion-section",
      "title": "剧本集",
      "icon": "IconScript",
      "defaultOpen": true,
      "badge": "count",
      "children": []
    }

- `icon`：图标名。
- `badge`：填字符串直接当徽章显示；填 `"count"` 会显示区块内第一个列表的条目数（会随增删自动更新）。不填则无徽章。

### field（单字段）

    {
      "type": "field",
      "binding": { "key": "book_name" },
      "label": "项目名称",
      "editor": "inline",
      "placeholder": "输入项目名称",
      "emptyHint": "未命名项目"
    }

- `editor`：`"inline"` 就地单行；`"dialog"` 弹窗多行。
- dialog 模式可加 `dialogTitle`、`dialogDescription`、`alert`。

### select（下拉单选）

    {
      "type": "select",
      "binding": { "key": "resolution" },
      "label": "分辨率",
      "icon": "IconDeviceTv",
      "fallback": "480p",
      "options": [
        { "value": "480p", "label": "480p", "sub": "标清",
          "badge": { "text": "SD", "className": "bg-foreground/10 text-foreground" } }
      ]
    }

- `fallback`：没有有效值时的默认选项（必填）。
- `badge`：`text` + `className` 做视觉标签；只给 `className` 不给 `text` 即纯色块。

### button-group（按钮组单选）

    {
      "type": "button-group",
      "binding": { "key": "pace" },
      "label": "叙事节奏",
      "fallback": "normal",
      "columns": 3,
      "options": [
        { "value": "slow", "label": "慢节奏", "sub": "强调氛围", "dot": "bg-blue-500" }
      ]
    }

- `columns`：每行几个（默认 3）；`dot`：状态色点。

### text-list（文本条目增删改）

    {
      "type": "text-list",
      "binding": { "key": "scripts" },
      "addLabel": "添加剧本",
      "emptyTitle": "还没有剧本",
      "emptyIcon": "IconBook2",
      "addDialogTitle": "添加剧本",
      "editDialogTitle": "编辑剧本",
      "confirmTitle": "删除剧本",
      "confirmMessage": "确定要删除吗？"
    }

- 列表本身存在 `key`；每条正文另存在 `key_条目id`，自动维护。

### image-grid（图片增删）

    {
      "type": "image-grid",
      "dir": "visualref",
      "addLabel": "选择参考图",
      "emptyTitle": "还没有参考图",
      "confirmTitle": "确认删除",
      "confirmMessage": "确定删除这张图片吗？"
    }

- `dir`：图片存放目录（必填，走文件而非 key）。

### tree（多级分散 KV 树）

用来按「分散 KV + 模板拼 key」展示层级结构（比如生成进度、素材库）。**不写 `children`**，每层由 `levels` 数组定义；根节点从 `rootKey` 读取；容器节点的 baseKey 值就是其子节点数据。

    {
      "type": "tree",
      "rootKey": "episodes",
      "rootRegex": "^ep_(?<id>\\d+)_(?<label>.+)$",
      "track": true,
      "emptyTitle": "还没有生成内容",
      "emptyIcon": "IconListTree",
      "levels": [
        {
          "keyTemplate": "episode_{id}",
          "labelTemplate": "第 {n} 集 · {label}",
          "icon": "IconMovie",
          "openIcon": "IconFolderOpen"
        },
        {
          "keyTemplate": "{parent}_shot_{id}",
          "labelTemplate": "镜头 {n}",
          "icon": "IconCamera",
          "leaf": true,
          "childRegex": "shot_(?<id>\\d+)",
          "actions": [
            { "type": "logOpen", "keyTemplate": "{key}" }
          ]
        }
      ]
    }

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `rootKey` | 是 | 根 KV key。订阅该 key 后取其字符串值生成根节点。 |
| `rootRegex` | 否 | 根 KV 值 → 根节点的提取正则。命名捕获 `id/label/meta` 映射为对应字段；其它命名捕获进入全局 `root.<name>` 字段。未指定时整段作一个根节点（`id="root"`，`label=前60字`），并自动注入 `root.key=rootKey`。 |
| `track` | 否 | 是否监听 root/各层 baseKey 变化并实时刷新，默认 `true`。 |
| `emptyTitle` | 是 | 根为空时展示的标题。 |
| `emptyIcon` | 否 | 根为空时展示的图标名。 |
| `levels` | 是 | 各层定义，**数组下标 = 树深度（0 为根节点层）**。 |

每层 `levels[depth]` 字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `keyTemplate` | 否 | 由父节点推导本层节点 baseKey 的模板。占位符见下表。缺省 `"{parent}_{id}"`。 |
| `labelTemplate` | 否 | 节点标题模板，占位符同上。缺省用 `item.label`，否则「第 N 项」。 |
| `icon` | 否 | 节点图标名。 |
| `openIcon` | 否 | 容器展开态图标名。 |
| `leaf` | 否 | 本层是否叶子。缺省：最后一层自动视为叶子。 |
| `childRegex` | 否 | 当容器 baseKey 值是字符串（而非数组）时，用此 global 正则解析为子节点数组。命名捕获规则同 `rootRegex`。 |
| `actions` | 否 | 叶子点击后**按顺序执行**的动作链（见下）。 |

模板占位符（`keyTemplate` / `labelTemplate` / `action.keyTemplate` 都通用）：

| 占位符 | 含义 |
| --- | --- |
| `{id}` `{label}` `{meta}` | 当前节点字段 |
| `{value}` | 数组元素 `value` 字段（来自 `{key,value}` 简写或对象 `value`） |
| `{index}` `{n}` | 0 基 / 1 基下标 |
| `{parent}` | 父节点 baseKey |
| `{key}` | 等价于 `{parent}`（语义化别名） |
| `{root.<name>}` | 根层命名捕获；未指定 `rootRegex` 时 `{root.key}` 等于 `rootKey` 自身 |
| `{ancestor.<L>.<name>}` | 第 L 层祖先的某字段。`L=0` 是直接父，`L=1` 是祖父，依此类推 |

#### 数组 / 字符串数据格式

容器节点 baseKey 的值可以是以下几种之一：

- 字符串：`"id1\nid2\nid3"`，配合 `childRegex` 用 global 正则逐条提取。
- 字符串数组：`["id1","id2"]` → 直接当 id 数组。
- 简写对象数组：`[{key:"a", value:"1"}, ...]` → `id=key`，`value` 注入 `fields.value`（可用 `{value}` 引用）。
- 完整对象数组：`[{id:"a", label:"..."}, ...]` → 标准对象；除 `id/label/meta` 外的字段全部进 `fields`，可用 `{<字段名>}` 引用。

#### actions（动作链）

叶子节点点击后，**按顺序**触发 `actions` 数组里每个动作。每个动作形如：

    { "type": "logOpen", "keyTemplate": "{key}", "args": { "kind": "character" } }

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` 或 `name` | 是（任一） | 动作名，**业务方注册的函数名**（如 `logOpen`/`viewPlan`/`openEntity`）。`name` 优先，缺省 `type`，再缺省 `"view"`。 |
| `keyTemplate` | 否 | 要读取的 key 模板（占位符同上）；缺省用节点自身 baseKey。 |
| `args` | 否 | 任意 JSON，原样透传给动作函数。 |

动作不会弹窗——它仅是「**告诉业务方按这个 name 触发、按这个 key 读数据、带这些 args**」，具体怎么处理由业务代码决定。

## 完整示例

    {
      "type": "panel",
      "children": [
        {
          "type": "accordion-section",
          "title": "全局要求",
          "icon": "IconFileText",
          "defaultOpen": true,
          "children": [
            { "type": "field", "binding": { "key": "book_name" },
              "label": "项目名称", "editor": "inline", "emptyHint": "未命名项目" }
          ]
        },
        {
          "type": "accordion-section",
          "title": "分镜进度",
          "icon": "IconListTree",
          "defaultOpen": true,
          "children": [
            {
              "type": "tree",
              "rootKey": "episodes",
              "rootRegex": "^ep_(?<id>\\d+)_(?<label>.+)$",
              "emptyTitle": "还没有生成内容",
              "levels": [
                {
                  "keyTemplate": "episode_{id}",
                  "labelTemplate": "第 {n} 集 · {label}",
                  "icon": "IconMovie"
                },
                {
                  "keyTemplate": "{parent}_shot_{id}",
                  "labelTemplate": "镜头 {n} · {label}",
                  "icon": "IconCamera",
                  "leaf": true,
                  "childRegex": "shot_(?<id>\\d+)",
                  "actions": [
                    { "type": "logOpen", "keyTemplate": "{key}" },
                    { "type": "viewPlan", "keyTemplate": "{key}_plan" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
```