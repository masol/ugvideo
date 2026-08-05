<!-- $lib/components/glossary/glossary-toolbar.svelte -->
<script lang="ts">
  import PromptDialog from "$lib/components/dialog/Prompt.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import { IconPlus, IconRefresh } from "@tabler/icons-svelte";
  import Logger from "electron-log/renderer";
  import { debounce, getErrorMessage } from "radashi";
  import { push } from "svelte-spa-router";
  import BlueprintSwitcher from "./blueprint-switcher.svelte";
  import NameFilterCombobox from "./name-filter-combobox.svelte";
  import { blueprintStore } from "./store.svelte.js";

  const DEBOUNCE_MS = 400;

  /** 需要 debounce 的提交（下拉关闭、blur 等） */
  const debouncedSet = debounce({ delay: DEBOUNCE_MS }, (value: string) => {
    blueprintStore.setName(value);
  });

  $effect(() => {
    return () => debouncedSet.cancel();
  });

  /** 立即提交（选中候选项、清空） */
  function handleComboCommit(text: string) {
    debouncedSet.cancel();
    blueprintStore.setName(text);
  }

  /** 延迟提交（下拉关闭） */
  function handleComboInput(text: string) {
    debouncedSet(text);
  }

  let isRefreshing = $state(false);

  async function handleRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      await blueprintStore.doLoad();
    } catch (err) {
      Logger.error("[glossary-toolbar] 刷新失败：", err);
      await dialogStore.safeShow(
        PromptDialog,
        {
          title: "刷新失败",
          label: "错误信息",
          placeholder: "",
          initialValue: err instanceof Error ? err.message : String(err),
          required: false,
        },
        { size: "sm" },
      );
    } finally {
      isRefreshing = false;
    }
  }

  /**
   * 新建流程：
   *   1. 弹窗收集新名称（trim 后非空）
   *   2. 先调用 blueprintStore.checkNameExists(name) 做唯一性预检
   *   3. 已存在 → 弹出错误提示，不跳转
   *   4. 不存在 → 跳转到编辑器（/new 路由）
   */
  async function handleCreate() {
    const name = await dialogStore.safeShow(
      PromptDialog,
      {
        title: `新建${blueprintStore.kindLabel}元素`,
        label: "新名称",
        placeholder: "请输入新的名称（不能与当前值冲突）",
        initialValue: "",
        required: true,
        validator: async (val: string) => {
          const trimmed = val.trim();
          if (!trimmed) return "名称不能为空";
          try {
            const exists = await blueprintStore.checkNameExists(trimmed);
            if (exists) {
              return `名称"${trimmed}"已存在，请使用其他名称`;
            }
            return "";
          } catch (err) {
            Logger.error("[glossary-toolbar] 预检失败：", err);
            return `无法校验名称唯一性：${getErrorMessage(err)}`;
          }
        },
      },
      { size: "sm" },
    );

    if (!name) return;

    push(`/editor/${blueprintStore.kind}/${encodeURIComponent(name)}/new`);
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between gap-3">
    <BlueprintSwitcher />
    <div class="flex items-center gap-2">
      <Button
        size="icon"
        variant="outline"
        aria-label="刷新列表"
        disabled={isRefreshing}
        class="rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
        onclick={handleRefresh}
      >
        <IconRefresh
          size={20}
          stroke={1.5}
          class={isRefreshing ? "animate-spin" : ""}
        />
      </Button>
      <Button
        size="sm"
        class="rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
        onclick={handleCreate}
      >
        <IconPlus size={20} stroke={1.5} />
        新建
      </Button>
    </div>
  </div>

  <!-- 统一使用 Combobox：有候选项时支持下拉选择，无候选项时作为纯输入框 -->
  <NameFilterCombobox
    value={blueprintStore.name}
    options={blueprintStore.kindFilterOptions}
    placeholder="搜索名称 / 拼音 / 描述…"
    onInput={handleComboInput}
    onCommit={handleComboCommit}
  />
</div>
