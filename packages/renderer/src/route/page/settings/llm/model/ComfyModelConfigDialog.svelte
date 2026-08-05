<!-- ComfyModelConfigDialog.svelte -->
<!--
  Comfy 协议的"虚拟模型"配置对话框（只读预览版）。

  核心差异（相对于通用 ModelConfigDialog）：
  1. 模型标识不再是字符串 ID，而是用户上传的 ComfyUI workflow JSON 文件
     （经 SDK Workflow 对象解析后生成"虚拟模型"概念）。
  2. 调用参数不再是上下文窗口/评分，而是 vercel ai sdk 等上层调用时
     涉及的语义参数（如尺寸、分辨率、时长等），其取值需由用户在右侧
     填入 workflow JSON 中的具体节点路径完成映射。
  3. 当前实现版本暂未落地持久化，仅以顶部红色横幅提示 + 禁用保存按钮
     的方式对外明示"尚未支持"，避免误以为已可用。

  与通用 ModelConfigDialog 共用：
  · AbilitySelector（功能/版本/能力 chip 选择）—— 受控组件协议无关。
  · 同样的 DialogHeader / DialogFooter 排版与圆角/间距令牌。
-->
<script lang="ts">
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import {
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Separator } from "$lib/components/ui/separator";
  import type { DialogComponentProps } from "$lib/types/dialog";
  import type { ModelAbility } from "$lib/utils/model/types";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconAlertTriangle,
    IconCircuitDiode,
    IconFileCode,
    IconFileUpload,
    IconPlus,
    IconTrash,
    IconX,
  } from "@tabler/icons-svelte";
  import AbilitySelector from "./AbilitySelector.svelte";

  /** Comfy 虚拟模型 = 一份 workflow JSON + 参数映射表 */
  interface ComfyVirtualModel {
    /** 必填：用户上传的工作流 JSON 文件名（仅展示，不上传） */
    workflowName: string;
    /** 用户可配置的"语义参数" → workflow 节点路径的映射 */
    paramMappings: ParamMapping[];
  }

  interface ParamMapping {
    uid: string;
    /** 左侧：上层调用方关注的语义键（如 "size" / "resolution" / "duration"） */
    semanticKey: string;
    /** 右侧：workflow JSON 中点号分隔的路径（如 "39.inputs.width"） */
    workflowPath: string;
  }

  type Props = {
    model?: Partial<ComfyVirtualModel>;
    /** 受控 ability 列表（与 AbilitySelector 复用同一形状） */
    abilities?: ModelAbility[];
    existingModelIds?: string[];
    onSave?: (model: ComfyVirtualModel) => Promise<boolean>;
  } & DialogComponentProps<ComfyVirtualModel>;

  let {
    model,
    abilities = $bindable<ModelAbility[]>([]),
    existingModelIds = [],
    onSave,
    onClose,
    onCancel,
  }: Props = $props();

  const isEditMode = !!model?.workflowName;

  // ── 模拟：用户上传 workflow 文件（仅记录文件名，不真正解析） ──
  let workflowName = $state(model?.workflowName ?? "");
  /** 假定的"已选中 workflow 路径"，由未来真正的 SDK 集成填入；当前为占位 */
  let workflowDisplayPath = $state("");

  // ── 参数映射表 ──
  let mappingCounter = 0;
  function createMapping(semanticKey = "", workflowPath = ""): ParamMapping {
    return { uid: `m-${++mappingCounter}`, semanticKey, workflowPath };
  }

  let mappings = $state<ParamMapping[]>(
    model?.paramMappings ? [...model.paramMappings] : [],
  );

  function addMapping() {
    mappings = [...mappings, createMapping()];
  }

  function removeMapping(uid: string) {
    mappings = mappings.filter((m) => m.uid !== uid);
  }

  // ── Comfy 支持的能力白名单（其余类别在此协议下无意义） ──
  const COMFY_ALLOWED_FUNCTIONS = new Set<ModelAbility>([
    "image-generation",
    "video-generation",
    "audio-generation",
    "audio-understanding",
    "bgm",
  ] as ModelAbility[]);

  // 进入对话框时，若 abilities 不在白名单 → 强制重置为空数组
  $effect(() => {
    if (abilities.length === 0) return;
    const hasValid = abilities.some((a) => COMFY_ALLOWED_FUNCTIONS.has(a));
    if (!hasValid) abilities = [];
  });

  const currentFunction = $derived(
    abilities.find((a) => COMFY_ALLOWED_FUNCTIONS.has(a)),
  );

  const duplicateIdError = $derived.by(() => {
    const trimmed = workflowName.trim();
    if (!trimmed) return "";
    if (existingModelIds.includes(trimmed)) {
      return `已存在同名虚拟模型「${trimmed}」，请重命名或换一个 workflow。`;
    }
    return "";
  });

  // 当前实现版本：永远不通过校验 → 保存按钮永远禁用
  const isValid = $derived(
    workflowName.trim().length > 0 &&
      !!currentFunction &&
      duplicateIdError === "",
  );
  const saveDisabled = $state(true); // ← 关键：当前版本禁用保存

  async function handleSubmit() {
    // 防御：当前实现版本不允许进入此分支
    if (saveDisabled || !isValid) return;
    const result: ComfyVirtualModel = {
      workflowName: workflowName.trim(),
      paramMappings: mappings.filter(
        (m) => m.semanticKey.trim() || m.workflowPath.trim(),
      ),
    };
    try {
      if (onSave && (await onSave(result))) return;
      onClose(result);
    } catch {
      /* 不会发生：当前 saveDisabled=true */
    }
  }

  function handleCancel() {
    onCancel();
  }
</script>

<DialogHeader>
  <DialogTitle class="flex items-center gap-2">
    <IconCircuitDiode size={20} stroke={1.5} class="text-primary" />
    {isEditMode ? "编辑 Comfy 虚拟模型" : "新建 Comfy 虚拟模型"}
  </DialogTitle>
  <DialogDescription>
    基于 ComfyUI 工作流 JSON 定义可被上层调用方寻址的"虚拟模型"
  </DialogDescription>
</DialogHeader>

<div class="space-y-6 py-4" use:autoAnimate>
  <!-- ╭─────────────────────────────────────────────────────╮ -->
  <!-- │ 顶部"尚未支持"红色横幅 —— 永远存在                    │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <Alert.Root
    variant="destructive"
    class="animate-fade-in rounded-xl border-destructive/40"
  >
    <IconAlertTriangle class="size-4" stroke={1.5} />
    <Alert.Title>Comfy 协议尚未支持</Alert.Title>
    <Alert.Description>
      当前实现版本仅提供 Comfy
      虚拟模型的可视化配置预览。保存功能已被禁用，实际持久化将在 Comfy SDK
      集成完成后开放。
    </Alert.Description>
  </Alert.Root>

  <!-- ╭─────────────────────────────────────────────────────╮ -->
  <!-- │ 工作流上传区（占位）                                  │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <div class="space-y-3 rounded-2xl border border-border/50 p-6">
    <h3 class="flex items-center gap-2 text-base font-medium">
      <IconFileCode class="size-4 text-muted-foreground" />
      工作流定义
    </h3>
    <p class="text-xs text-muted-foreground">
      通过 <code class="rounded bg-muted px-1.5 py-0.5 font-mono"
        >@comfyorg/sdk</code
      >
      的
      <code class="rounded bg-muted px-1.5 py-0.5 font-mono"
        >client.workflows.fromFile()</code
      >
      加载 API 格式的 JSON。
    </p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
      <div class="space-y-2">
        <Label for="comfy-workflow-name">虚拟模型名称</Label>
        <Input
          id="comfy-workflow-name"
          bind:value={workflowName}
          placeholder="如 sd15-portrait-flux"
          class="rounded-xl font-mono"
          aria-invalid={duplicateIdError ? "true" : undefined}
        />
        {#if duplicateIdError}
          <p
            id="comfy-workflow-name-err"
            class="animate-fade-in text-xs text-destructive"
          >
            {duplicateIdError}
          </p>
        {/if}
      </div>

      <div class="flex items-end">
        <Button
          variant="outline"
          size="sm"
          class="w-full gap-2 rounded-xl sm:w-auto"
          disabled
          title="SDK 集成完成后启用"
        >
          <IconFileUpload class="size-4" stroke={1.5} />
          上传 workflow.json
        </Button>
      </div>
    </div>

    {#if workflowDisplayPath}
      <div
        class="flex items-center gap-2 rounded-xl border border-dashed border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      >
        <IconFileCode class="size-3.5" />
        <span class="truncate font-mono">{workflowDisplayPath}</span>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">
        加载后将展示工作流中可被寻址的节点 ID 列表，供下方参数映射使用。
      </p>
    {/if}
  </div>

  <!-- ╭─────────────────────────────────────────────────────� -->
  <!-- │ 复用 AbilitySelector（白名单已在子组件内通过 normalize │ -->
  <!-- │  与 currentAllowed 控制，这里仅做受控透传）           │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <div class="space-y-3 rounded-2xl border border-border/50 p-6">
    <h3 class="flex items-center gap-2 text-base font-medium">能力筛选</h3>
    <AbilitySelector bind:abilities />
    <p class="text-xs text-muted-foreground">
      Comfy 仅支持绘图 / 视频生成 / 语音合成 / 语音识别 /
      音乐音效，其他类别将被自动屏蔽。
    </p>
  </div>

  <!-- ╭─────────────────────────────────────────────────────╮ -->
  <!-- │ 参数映射表（仿 HeaderEntriesSection 的双列编辑）       │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <div class="space-y-3 rounded-2xl border border-border/50 p-6">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-base font-medium">参数映射</h3>
      <Button
        variant="outline"
        size="sm"
        class="rounded-xl"
        onclick={addMapping}
      >
        <IconPlus class="size-4" />
        添加映射
      </Button>
    </div>

    <div class="rounded-xl bg-muted/20 p-3 text-xs text-muted-foreground">
      <p>
        左侧为上层调用方（vercel ai sdk 等）期望的语义键；右侧为 workflow JSON
        中以点号分隔的节点输入路径（<code
          class="rounded bg-background px-1 font-mono"
          >如 <span class="text-foreground">"39.inputs.width"</span></code
        >）。
      </p>
    </div>

    <div
      class="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      <span>语义键</span>
      <IconX class="size-3 opacity-0" />
      <span>Workflow 路径</span>
      <!-- svelte-ignore element_invalid_self_closing_tag -->
      <span class="size-9" />
    </div>

    <Separator class="bg-border/50" />

    <div use:autoAnimate class="space-y-2">
      {#each mappings as mapping (mapping.uid)}
        <div class="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
          <Input
            bind:value={mapping.semanticKey}
            placeholder="size / resolution / duration …"
            class="min-w-0 rounded-xl font-mono"
          />
          <IconX
            class="size-3 shrink-0 text-muted-foreground/60"
            stroke={1.5}
          />
          <Input
            bind:value={mapping.workflowPath}
            placeholder="节点ID.inputs.参数名"
            class="min-w-0 rounded-xl font-mono"
          />
          <button
            type="button"
            aria-label="删除映射"
            class="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
            onclick={() => removeMapping(mapping.uid)}
          >
            <IconTrash class="size-4" />
          </button>
        </div>
      {/each}

      {#if mappings.length === 0}
        <p class="py-3 text-center text-xs text-muted-foreground">
          暂无参数映射
        </p>
      {/if}
    </div>
  </div>
</div>

<DialogFooter class="mt-4">
  <Button
    variant="outline"
    size="sm"
    class="rounded-lg"
    onclick={handleCancel}
    disabled={true}
  >
    取消
  </Button>
  <Button
    size="sm"
    class="rounded-lg"
    onclick={handleSubmit}
    disabled={!isValid || saveDisabled}
    title="Comfy 协议尚未支持 —— 保存暂不可用"
  >
    {isEditMode ? "保存更改" : "创建"}
  </Button>
</DialogFooter>
