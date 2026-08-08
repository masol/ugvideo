<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import type { Step } from "$lib/components/ui/walkthrough/ctx";
  import { configStore } from "$lib/store/config.svelte";
  import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-svelte";

  import { layoutStore } from "$lib/store/ui/layout.svelte";
  import { tourStore } from "$lib/store/ui/tour.svelte";
  import { delay } from "$lib/utils/promise";
  import { push } from "svelte-spa-router";

  const SettingId = "settings";
  const steps: Step[] = [
    {
      target: "botactivity-settings",
      title: "点击设置",
      description: "打开设置侧边栏",
      position: "right",
    },
    {
      target: "settings-general-main",
      title: "点击通用",
      description: "打开通用设置界面",
      position: "bottom",
    },
    {
      target: "settings-check-embeding",
      title: "本地嵌入模型",
      description: "自动检测本机硬件，并推荐合适的模型。",
      position: "left",
    },
    {
      target: "home-control",
      title: "回到控制台",
      description: "任意时刻点击这里，可以回到控制台。",
      position: "right",
    },
  ];

  async function tour2Next(curId: number) {
    if (curId === 0) {
      // 打开设置。
      if (layoutStore.activeActivity !== SettingId || !layoutStore.isLeftOpen) {
        layoutStore.handleActivityClick(SettingId);
        await delay(100);
      }
    } else if (curId === 1) {
      push("/settings/general");
      await delay(100);
      const el = document.getElementById("settings-check-embeding");
      // const container = document.querySelector("[data-scroll-area-viewport]");

      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
        });
        await delay(100);
      }
    }
  }

  async function handleSetEmbedModel() {
    // TODO: 由你处理，例如打开设置面板的嵌入模型项
    // layoutStore.setActiveActivity("settings");
    tourStore.start(steps, tour2Next);
  }
</script>

{#if !configStore.embedModel}
  <div
    role="alert"
    class="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
  >
    <IconAlertTriangle
      class="size-5 shrink-0 text-amber-600 dark:text-amber-400"
    />
    <div class="flex-1 text-sm">
      <span class="font-medium text-amber-700 dark:text-amber-300">
        未设置本地嵌入模型
      </span>
      <span class="text-amber-700/80 dark:text-amber-300/80">
        ，这会导致部分功能无法使用
      </span>
    </div>
    <Button size="sm" variant="outline" onclick={handleSetEmbedModel}>
      立即设置
    </Button>
  </div>
{/if}

{#if !configStore.localModel}
  <div class="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/60">
    <IconInfoCircle class="size-3.5" />
    <span>未设置重排模型，这可能会降低任务正确度</span>
  </div>
{/if}
