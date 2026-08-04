<!-- $lib/components/glossary/glossary-time-cell.svelte -->
<script lang="ts">
  import { i18nStore } from "$lib/store/i18n.svelte";

  let { value }: { value: string } = $props();

  // fromNow 相对时间；完整 ISO 放在 title，悬停可看
  const relative = $derived(i18nStore.dayjs(value).fromNow());
</script>

<!--
  Cell 层只负责展示。tabular-nums 防数字位抖动。
  时间字段有长度上限，truncate 极少触发；title 仍兜底。
-->
<span
  class="block truncate whitespace-nowrap text-end text-xs text-muted-foreground tabular-nums"
  title={value}
>
  {relative}
</span>
