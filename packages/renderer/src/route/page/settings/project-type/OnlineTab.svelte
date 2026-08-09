<script lang="ts">
  import autoAnimate from "@formkit/auto-animate";
  import EmptyState from "./EmptyState.svelte";

  // 关键词已由父级透传;后续接入 searchRemoteProjectTypes(query) 即可。
  type Props = { query: string };
  let { query }: Props = $props();

  const trimmed = $derived(query.trim());
</script>

<div
  use:autoAnimate
  class="flex h-full min-h-0 items-center justify-center overflow-y-auto rounded-2xl
           border border-dashed border-border/60"
>
  <EmptyState
    title="在线项目类型即将上线"
    description={trimmed
      ? `暂时无法在线搜索「${trimmed}」,敬请期待。`
      : "届时可在此浏览并一键安装社区项目类型。"}
  />
</div>
