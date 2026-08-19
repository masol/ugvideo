<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { configStore } from "$lib/store/config.svelte";
  import { windowStore } from "$lib/store/window.svelte";
  import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-svelte";
  import Brand from "./header/brand.svelte";
  import CommandPaletteBar from "./header/CommandPaletteBar.svelte";
  import LayoutGroup from "./header/layout.svelte";
  import AppMenu from "./header/menu/app-menu.svelte";
  import Winctrl from "./header/winctrl.svelte";

  const currentTheme = $derived(configStore.theme);
  const themeLabel = $derived(
    currentTheme === "light"
      ? "浅色主题"
      : currentTheme === "dark"
        ? "深色主题"
        : "跟随系统",
  );

  function cycleTheme() {
    configStore.cycleTheme();
  }
</script>

<header
  class="bg-sidebar text-sidebar-foreground relative z-50 flex h-9 shrink-0 select-none items-center border-b text-xs"
  role="toolbar"
  aria-label="窗口标题栏"
  tabindex="-1"
>
  <Brand />

  <AppMenu />

  <div
    class="flex flex-1 items-center justify-center px-2"
    style="-webkit-app-region: drag;"
    role="button"
    tabindex="0"
    ondblclick={() => windowStore.maximize()}
  >
    <CommandPaletteBar />
  </div>

  <div class="flex items-center">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            onclick={cycleTheme}
            variant="ghost"
            size="icon"
            class="size-9 rounded-none hover:bg-accent/80"
          >
            {#if currentTheme === "light"}
              <IconSun size={16} />
            {:else if currentTheme === "dark"}
              <IconMoon size={16} />
            {:else}
              <IconDeviceDesktop size={16} />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content class="z-200">{themeLabel}（点击切换）</Tooltip.Content>
    </Tooltip.Root>
  </div>

  <Separator orientation="vertical" class="mx-1 h-5" />

  <LayoutGroup />
  <Winctrl />
</header>
