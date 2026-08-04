<!-- $lib/components/glossary/glossary-toolbar.svelte -->
<script lang="ts">
  import PromptDialog from "$lib/components/dialog/Prompt.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import { IconPlus, IconRefresh, IconSearch } from "@tabler/icons-svelte";
  import Logger from "electron-log/renderer";
  import { debounce, getErrorMessage } from "radashi";
  import { push } from "svelte-spa-router";
  import BlueprintSwitcher from "./blueprint-switcher.svelte";
  import NameFilterCombobox from "./name-filter-combobox.svelte";
  import { blueprintStore } from "./store.svelte.js";

  const DEBOUNCE_MS = 400;
  let localValue = $derived(blueprintStore.name);

  const debouncedSet = debounce({ delay: DEBOUNCE_MS }, (value: string) => {
    blueprintStore.setName(value);
  });

  $effect(() => {
    return () => debouncedSet.cancel();
  });

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

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    localValue = e.currentTarget.value;
    debouncedSet(localValue);
  }

  function commitNow() {
    debouncedSet.cancel();
    blueprintStore.setName(localValue);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitNow();
    }
  }

  function handleComboInput(text: string) {
    debouncedSet(text);
  }
  function handleComboCommit(text: string) {
    debouncedSet.cancel();
    blueprintStore.setName(text);
  }

  /**
   * 新建流程：
   *   1. 弹窗收集新名称（trim 后非空）
   *   2. 先调用 blueprintStore.checkNameExists(name) 做唯一性预检
   *   3. 已存在 → 弹出错误提示，不跳转
   *   4. 不存在 → 跳转到编辑器（/new 路由）
   *
   * 注意：预检和跳转之间存在一个理论竞态窗口（别的客户端可能并发创建同名条目）。
   * 这点我**不确认**是否要紧——单用户本地编辑器场景下，按用户交互节奏基本不会发生，
   * 所以不引入乐观锁 / 服务端二次校验。如果你在意，告诉我即可。
   */
  async function handleCreate() {
    const name = await dialogStore.safeShow(
      PromptDialog,
      {
        title: `新建${blueprintStore.kindLabel}元素`,
        label: "新名称",
        placeholder: "请输入新的名称（不能与当前值冲突）",
        initialValue: "",
        required: true, // 非空校验由 PromptDialog 处理
        validator: async (val: string) => {
          const trimmed = val.trim();
          // required 已经保证非空，但防御性处理
          if (!trimmed) return "名称不能为空";
          try {
            const exists = await blueprintStore.checkNameExists(trimmed);
            if (exists) {
              return `名称“${trimmed}”已存在，请使用其他名称`;
            }
            return ""; // 返回空字符串表示验证通过
          } catch (err) {
            Logger.error("[glossary-toolbar] 预检失败：", err);
            return `无法校验名称唯一性：${getErrorMessage(err)}`;
          }
        },
      },
      { size: "sm" },
    );

    // 用户取消或验证失败（对话框不会关闭）→ 返回 undefined/null
    if (!name) return;

    // 验证通过后跳转到编辑器
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

  {#if blueprintStore.hasFilterOptions}
    <NameFilterCombobox
      value={blueprintStore.name}
      options={blueprintStore.kindFilterOptions}
      placeholder="搜索名称 / 拼音 / 描述…"
      onInput={handleComboInput}
      onCommit={handleComboCommit}
    />
  {:else}
    <div class="relative">
      <span
        class="pointer-events-none absolute inset-y-0 inset-s-0 flex items-center ps-3 text-muted-foreground"
      >
        <IconSearch size={20} stroke={1.5} />
      </span>
      <Input
        placeholder="按名称过滤…"
        value={localValue}
        oninput={handleInput}
        onblur={commitNow}
        onkeydown={handleKeydown}
        class="w-full rounded-xl ps-10"
      />
    </div>
  {/if}
</div>
