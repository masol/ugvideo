<!-- $lib/components/glossary/glossary-row-actions.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { configStore } from "$lib/store/config.svelte.js";
  import { confirmStore } from "$lib/store/ui/confirm.svelte.js";
  import { layoutStore } from "$lib/store/ui/layout.svelte.js";
  import {
    IconDotsVertical,
    IconEdit,
    IconFileText,
    IconSparkleHighlight,
    IconTrash,
  } from "@tabler/icons-svelte";
  import { push } from "svelte-spa-router";
  import { flowStore } from "../../../page/flow/store.svelte.js";
  import { bottomPanelStore } from "../../bottom/bar.store.svelte.js";
  import { blueprintStore, type BlueprintTerm } from "./store.svelte.js";

  let { term }: { term: BlueprintTerm } = $props();

  const editContentFmt = $derived(blueprintStore.canEditContent(term));
  const showDesignUUID = $derived(blueprintStore.canShowDesign(term));

  function handleEdit() {
    // 名称可能含 # / 空格等对 hash 路由敏感的字符，必须编码
    push(`/editor/${blueprintStore.kind}/${encodeURIComponent(term.name)}/`);
  }

  function handleEditContent() {
    push(
      `/editor/${blueprintStore.kind}/${encodeURIComponent(term.name)}/${editContentFmt}`,
    );
  }

  function handleShowDesign() {
    if (showDesignUUID) {
      flowStore.init(showDesignUUID, "panel");
      layoutStore.openPanel("bottom");
      bottomPanelStore.setActiveTab("dag");
    }
  }

  async function handleDelete() {
    const confirmed = await confirmStore.request({
      title: "删除条目？",
      message: `“${term.name}” 将被永久移除，并可能导致本项目无法执行。`,
      destructive: true,
      confirmLabel: "删除",
    });
    if (confirmed === null) return;
    if (confirmed) {
      await blueprintStore.removeTerm(term.name);
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon"
        class="size-8 rounded-lg text-muted-foreground transition-all duration-200"
      >
        <span class="sr-only">打开操作菜单</span>
        <IconDotsVertical size={20} stroke={1.5} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="rounded-xl">
    <DropdownMenu.Item class="rounded-lg" onclick={handleEdit}>
      <IconEdit size={20} stroke={1.5} />
      编辑
    </DropdownMenu.Item>
    {#if editContentFmt.trim().length > 0}
      <DropdownMenu.Item class="rounded-lg" onclick={handleEditContent}>
        <IconFileText size={20} stroke={1.5} />
        编辑内容
      </DropdownMenu.Item>
    {/if}
    {#if showDesignUUID.trim().length > 0}
      <DropdownMenu.Item class="rounded-lg" onclick={handleShowDesign}>
        <IconSparkleHighlight size={20} stroke={1.5} />
        面板显示
      </DropdownMenu.Item>
    {/if}
    {#if configStore.rmblueprint}
      <DropdownMenu.Separator />
      <DropdownMenu.Item
        class="rounded-lg text-destructive focus:text-destructive"
        onclick={handleDelete}
      >
        <IconTrash size={20} stroke={1.5} />
        删除
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
