<!-- src/lib/editor/EditorPage.svelte -->
<script lang="ts">
  import EditorToolbar from "./EditorToolbar.svelte";
  import MonacoEditor from "./MonacoEditor.svelte";
  import {
    editorStore,
    type BlueprintKind,
    type CntParam,
  } from "./store.svelte";

  let {
    params = {},
  }: {
    params?: { kind?: string; id?: string; content?: CntParam };
    // onOpenMedia 回调已移除，素材操作仅通过 PathAssetMenu（MonacoEditor 内部）实现
  } = $props();

  const kind = $derived<BlueprintKind>(
    params.kind === "metag" || params.kind === "capa"
      ? (params.kind as BlueprintKind)
      : "glossary",
  );

  $effect(() => {
    editorStore.init({
      kind,
      id: (params.id ?? "").trim(),
      contentFmt: params.content ?? "",
    });
  });
</script>

<div
  class="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
>
  <EditorToolbar />

  <div class="relative min-h-0 flex-1">
    <MonacoEditor />
  </div>
</div>
