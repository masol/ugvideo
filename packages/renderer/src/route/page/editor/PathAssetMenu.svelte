<!-- src/lib/editor/PathAssetMenu.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import { safeApi } from "$lib/utils/api";
  import { IconExternalLink, IconEye, IconPhoto } from "@tabler/icons-svelte";
  import AssetPreviewDialog from "./AssetPreviewDialog.svelte";
  import { editorStore, type PathAsset } from "./store.svelte";

  let { assets }: { assets: PathAsset[] } = $props();

  let previewUrl = $state<string | null>(null);
  let previewName = $state<string>("");

  async function handlePreview(a: PathAsset) {
    previewName = a.fullKey;
    const url = await editorStore.previewAsset(a.relative);
    if (url) previewUrl = url;
  }

  async function handleOpen(a: PathAsset) {
    await editorStore.openAsset(a.relative);
  }

  async function handleView(a: PathAsset) {
    const url = await safeApi().project.getURL(a.relative);
    if (!url) return;
    await dialogStore.safeShow(
      AssetPreviewDialog,
      { src: url, name: a.fullKey, path: a.relative },
      { size: "xl6", showCloseButton: true },
    );
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        size="sm"
        class="h-8 gap-1.5 rounded-xl transition-all duration-200"
      >
        <IconPhoto size={20} stroke={1.5} />
        素材
        <span class="text-xs text-muted-foreground">({assets.length})</span>
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="min-w-64 rounded-xl">
    {#each assets as a (a.fullKey)}
      <DropdownMenu.Item class="rounded-lg" onSelect={() => handleView(a)}>
        <div class="flex w-full items-center justify-between gap-3">
          <div class="flex min-w-0 flex-col">
            <span class="truncate text-sm font-medium">{a.fullKey}</span>
            <span
              class="truncate text-xs text-muted-foreground"
              title={a.relative}
            >
              {a.relative}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Popover.Root>
              <Popover.Trigger>
                {#snippet child({ props: p })}
                  <Button
                    {...p}
                    variant="ghost"
                    size="icon"
                    aria-label="本地显示"
                    class="size-7 rounded-lg"
                    onclick={(e) => {
                      e.stopPropagation();
                      handlePreview(a);
                    }}
                  >
                    <IconEye size={20} stroke={1.5} />
                  </Button>
                {/snippet}
              </Popover.Trigger>
              <Popover.Content class="rounded-xl" align="end">
                <div class="space-y-2">
                  <p class="text-xs text-muted-foreground">{previewName}</p>
                  {#if previewUrl}
                    <img
                      src={previewUrl}
                      alt={previewName}
                      class="max-h-72 max-w-full rounded-lg border border-border/50"
                    />
                  {:else}
                    <p class="text-xs text-muted-foreground">
                      无图像数据或正在加载…
                    </p>
                  {/if}
                </div>
              </Popover.Content>
            </Popover.Root>

            <Button
              variant="ghost"
              size="icon"
              aria-label="打开文件"
              class="size-7 rounded-lg"
              onclick={(e) => {
                e.stopPropagation();
                handleOpen(a);
              }}
            >
              <IconExternalLink size={20} stroke={1.5} />
            </Button>
          </div>
        </div>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
