<!-- $lib/components/glossary/glossary-name-cell.svelte -->
<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<!--
  Cell 层只负责展示，不接排序交互。
  truncate + title 让超长 key 不会撑爆列宽，但仍可悬停查看全部。
-->
<span
  class="block min-w-0 flex-1 truncate text-sm font-medium text-foreground"
  title={name}
>
  {name}
</span>
