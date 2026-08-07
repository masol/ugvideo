<!--╭─────────────────────────────────────────────────────────╮ -->
<!-- │ [子组件 → header/menu/navigation-menu.svelte]           │ -->
<!-- │ 职责：主控台 / 后退 / 前进 SPA 导航                       │ -->
<!-- ╰─────────────────────────────────────────────────────────╯ -->
<script lang="ts">
  import * as Menubar from "$lib/components/ui/menubar";
  import {
    IconArrowLeft,
    IconArrowRight,
    IconHome2,
  } from "@tabler/icons-svelte";
  import { push } from "svelte-spa-router";
  import MenuShortcut from "./menu-shortcut.svelte";
</script>

<Menubar.Menu>
  <Menubar.Trigger
    class="cursor-default select-none h-9 rounded-none px-2.5 text-xs font-normal data-[state=open]:bg-accent/80 hover:bg-accent/80"
  >
    导航
  </Menubar.Trigger>
  <Menubar.Content align="start" class="select-none z-200 min-w-48">
    <Menubar.Item onSelect={() => push("/")}>
      <IconHome2 size={20} stroke={1.5} class="mr-2 text-muted-foreground" />
      主控台
      <MenuShortcut command="navigation.home" />
    </Menubar.Item>

    <Menubar.Separator />

    <Menubar.Item onSelect={() => history.back()}>
      <IconArrowLeft
        size={20}
        stroke={1.5}
        class="mr-2 text-muted-foreground"
      />
      后退
      <MenuShortcut command="navigation.back" />
    </Menubar.Item>
    <Menubar.Item onSelect={() => history.forward()}>
      <IconArrowRight
        size={20}
        stroke={1.5}
        class="mr-2 text-muted-foreground"
      />
      前进
      <MenuShortcut command="navigation.forward" />
    </Menubar.Item>
  </Menubar.Content>
</Menubar.Menu>
