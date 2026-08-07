<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { configStore } from "$lib/store/config.svelte";
  import { windowStore } from "$lib/store/window.svelte";
  import {
    IconDeviceDesktop,
    IconHome2,
    IconMoon,
    IconSun,
  } from "@tabler/icons-svelte";
  import { push, router } from "svelte-spa-router";
  import Brand from "./header/brand.svelte";
  import CommandPaletteBar from "./header/CommandPaletteBar.svelte";
  import LayoutGroup from "./header/layout.svelte";
  import AppMenu from "./header/menu/app-menu.svelte";
  import Winctrl from "./header/winctrl.svelte";

  // ── 主题三态轮换：light → dark → system → light ──
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

  const currentLocation = $derived(router.location);
  const isNotHome = $derived(currentLocation !== "/");
</script>

<header
  class="bg-sidebar text-sidebar-foreground relative z-50 flex h-9 shrink-0 select-none items-center border-b text-xs"
  role="toolbar"
  aria-label="窗口标题栏"
  tabindex="-1"
>
  <!-- 应用图标 -->
  <Brand></Brand>

  <!--╭─────────────────────────────────────────────────────────╮ -->
  <!-- │ 应用主菜单（项目 / 运行 / 帮助）                         │ -->
  <!-- ╰─────────────────────────────────────────────────────────╯ -->
  <AppMenu></AppMenu>

  {#if isNotHome}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            onclick={() => push("/")}
            aria-label="回到控制台"
            class="group mx-6 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-all duration-200 hover:scale-210 hover:bg-primary/20 active:scale-95"
          >
            <IconHome2
              size={18}
              stroke={1.8}
              class="transition-transform group-hover:scale-110"
            />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content class="z-200">回到控制台</Tooltip.Content>
    </Tooltip.Root>
  {/if}

  <!-- ╭─────────────────────────────────────────────────────────╮ -->
  <!-- │ [可抽取子组件 → WindowTitle.svelte]                      │ -->
  <!-- │ 职责：中部标题文字显示 + 唯一的窗口拖拽区域               │ -->
  <!-- ╰─────────────────────────────────────────────────────────╯ -->
  <div
    class="flex flex-1 items-center justify-center px-2"
    style="-webkit-app-region: drag;"
    role="button"
    tabindex="0"
    ondblclick={() => windowStore.maximize()}
  >
    <CommandPaletteBar></CommandPaletteBar>
  </div>
  <!-- ╭─── / WindowTitle ───╮ -->

  <!-- ╭─────────────────────────────────────────────────────────╮ -->
  <!-- │ [可抽取子组件 → ThemeCycler.svelte]                      │ -->
  <!-- │ 职责：主题三态轮换 light → dark → system → light         │ -->
  <!-- ╰─────────────────────────────────────────────────────────╯ -->
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
  <!-- ╭─── / ThemeCycler ───╮ -->

  <!-- 分隔竖线 -->
  <Separator orientation="vertical" class="mx-1 h-5" />

  <LayoutGroup></LayoutGroup>
  <!--
      窗口控制：最小化 / 最大化-还原 / 关闭
      z-60 保证永远可点、永不被遮挡。
    -->
  <Winctrl></Winctrl>
</header>
