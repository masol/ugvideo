<!-- HeaderEntriesSection.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import autoAnimate from "@formkit/auto-animate";
  import { IconAdjustments, IconPlus, IconTrash } from "@tabler/icons-svelte";

  interface HeaderEntry {
    uid: string;
    key: string;
    value: string;
  }

  let { entries = $bindable<HeaderEntry[]>([]) }: { entries?: HeaderEntry[] } =
    $props();

  let counter = 0;
  function createHeaderEntry(key = "", value = ""): HeaderEntry {
    return { uid: `h-${++counter}`, key, value };
  }

  function add() {
    entries = [...entries, createHeaderEntry()];
  }

  function remove(uid: string) {
    entries = entries.filter((h) => h.uid !== uid);
  }
</script>

<div class="space-y-4 rounded-2xl border border-border/50 p-6">
  <div class="flex items-center justify-between">
    <h3 class="flex items-center gap-2 text-base font-medium">
      <IconAdjustments class="size-4 text-muted-foreground" />
      自定义请求头
    </h3>
    <Button variant="outline" size="sm" class="rounded-xl" onclick={add}>
      <IconPlus class="size-4" />
      添加
    </Button>
  </div>

  <div use:autoAnimate>
    {#each entries as entry (entry.uid)}
      <div class="flex items-center gap-2 pt-3 first:pt-0">
        <Input
          bind:value={entry.key}
          placeholder="Header 名称"
          class="min-w-0 flex-1 rounded-xl"
        />
        <Input
          bind:value={entry.value}
          placeholder="值"
          class="min-w-0 flex-1 rounded-xl"
        />
        <button
          type="button"
          aria-label="删除请求头"
          class="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
          onclick={() => remove(entry.uid)}
        >
          <IconTrash class="size-4" />
        </button>
      </div>
    {/each}

    {#if entries.length === 0}
      <p class="py-3 text-center text-xs text-muted-foreground">
        暂无自定义请求头
      </p>
    {/if}
  </div>
</div>
