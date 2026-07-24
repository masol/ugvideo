<!-- src/App.svelte -->
<script lang="ts">
  import Confirm from "$lib/components/Confirm.svelte";
  import DialogHost from "$lib/components/dialog/DialogHost.svelte";
  import ErrorScreen from "$lib/components/error-screen.svelte";
  import LoadingScreen from "$lib/components/loading-screen.svelte";
  import Tour from "$lib/components/Tour.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { configStore } from "$lib/store/config.svelte";
  import { i18nStore } from "$lib/store/i18n.svelte";
  import { pluginStore } from "$lib/store/plugin.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import { recentProjectsStore } from "$lib/store/recent-projects.svelte";
  import { windowStore } from "$lib/store/window.svelte";
  import { ModeWatcher } from "mode-watcher";
  import pTimeout from "p-timeout";
  import { onDestroy, onMount } from "svelte";
  import { AnimatePresence, Motion } from "svelte-motion";
  import { api, safeApi, setupEvt } from "./lib/utils/api";
  import Layout from "./route/layout.svelte";

  // 初始化完成标记：未完成时显示加载页
  let ready = $state(false);
  // 初始化异常：非空时显示错误页
  let initError = $state<unknown>(null);

  // 定义键盘事件处理函数
  const handleKeydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const ctrlDown = event.ctrlKey || event.metaKey; // 兼容 macOS 的 Command 键

    // 1. 拦截 Ctrl + W (关闭标签/窗口)
    if (ctrlDown && key === "w") {
      event.preventDefault();
    }

    // 2. 拦截 Ctrl + R 或 F5 (刷新页面)
    if ((ctrlDown && key === "r") || key === "f5") {
      event.preventDefault();
    }

    // 3. 拦截 Ctrl + +/- 或 Ctrl + 0 (页面缩放)
    if (ctrlDown && ["+", "-", "=", "0"].includes(key)) {
      event.preventDefault();
    }

    // 4. 拦截开发者工具 (Ctrl+Shift+I / F12)
    if ((ctrlDown && event.shiftKey && key === "i") || key === "f12") {
      event.preventDefault();
    }
  };

  onMount(async () => {
    try {
      // 初始化api, api()可用。
      api();
      // 初始化事件机制，evtbus生效。唯一返回windowsId的机会。
      const wid = await setupEvt();
      windowStore.init(wid);
      await configStore.init(); // 先加载配置信息。

      //初始化pluginSystem.
      await Promise.all([
        pluginStore.init(),
        i18nStore.init(),
        recentProjectsStore.load(),
      ]);

      await projectStore.init();

      // 在捕获阶段（第三个参数传 true）监听，这比 hotkeys-js 的绑定更早执行
      window.addEventListener("keydown", handleKeydown, true);

      // 给加载动画一个最小展示时间，避免闪烁
      // await new Promise((r) => setTimeout(r, 600));

      // 等待系统自举完成。
      await pTimeout(safeApi().system.bootstrapped(), {
        milliseconds: 10000, // 10秒超时
        fallback: () => {
          // 超时后不抛异常，直接返回 void (undefined)
          return undefined as void;
        },
      });

      await windowStore.maximize();

      // 全部就绪，切换到正式界面
      ready = true;
    } catch (e) {
      // 拦截初始化过程中的任何异常，切换到错误页
      console.error("initialization failed", e);
      initError = e;
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown, true);
  });

  // 当前应该渲染的视图 key，用于 AnimatePresence 切换
  const view = $derived(initError ? "error" : ready ? "app" : "loading");
</script>

<Toaster position="bottom-right" richColors></Toaster>
<ModeWatcher />
<Tour></Tour>
<Confirm></Confirm>
<!-- 整窗：占满视口，外层不滚动 -->
<div class="app-shell">
  <AnimatePresence list={[{ key: view }]}>
    {#if initError}
      <Motion
        let:motion
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div use:motion class="app-fill">
          <ErrorScreen error={initError} />
        </div>
      </Motion>
    {:else if ready}
      <Motion
        let:motion
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div use:motion class="app-fill">
          <Layout />
        </div>
      </Motion>
    {:else}
      <Motion
        let:motion
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeIn" }}
      >
        <div use:motion class="app-fill">
          <LoadingScreen />
        </div>
      </Motion>
    {/if}
  </AnimatePresence>
</div>

<DialogHost />

<style>
  /* 整窗接管：占满视口，外层不滚动 */
  .app-shell {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }

  /* 填充整个 shell，供加载页/正式内容共用 */
  .app-fill {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
</style>
