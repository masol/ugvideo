<!-- 职责：核心运行按钮 + 动态提示文案 + 运行终止点设置。点击调用 store 方法。 -->
<script lang="ts">
  import { RuntimeIcon } from "$lib/components/runtimeicon";
  import * as Select from "$lib/components/ui/select";
  import { dashboardStore } from "$lib/store/dashboard.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import { tourStore } from "$lib/store/ui/tour.svelte";
  import { safeApi } from "$lib/utils/api";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconAlertTriangle,
    IconChevronDown,
    IconClock,
    IconDatabase,
    IconFlag,
    IconInfoCircle,
    IconLoader2,
    IconPlayerPlayFilled,
    IconPlayerStopFilled,
  } from "@tabler/icons-svelte";

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  let isUpdatingTarget = $state(false);

  let currentTarget = $derived(
    projectStore.activity?.targets.find(
      (o) => o.value === dashboardStore.target,
    ) ??
      projectStore.activity?.targets[projectStore.activity?.targets.length - 1],
  );

  let isLocked = $derived(
    dashboardStore.runState !== "idle" || isUpdatingTarget,
  );

  async function handleTargetChange(value: string | undefined) {
    if (!value || value === dashboardStore.target) return;
    isUpdatingTarget = true;
    try {
      await dashboardStore.setTarget(value);
    } finally {
      isUpdatingTarget = false;
    }
  }

  async function handleMainbutton(): Promise<void> {
    if (dashboardStore.runState === "idle") {
      if (projectStore.activity?.intputSteps) {
        const inputKey = projectStore.activity.inputKey;
        console.log("inputKey=", inputKey);
        if (inputKey) {
          const inputValue = await safeApi().project.get(inputKey);
          let lackInput = true;
          if (Array.isArray(inputValue) && inputValue.length > 0) {
            lackInput = false;
          } else if (inputValue) {
            lackInput = false;
          }
          if (lackInput) {
            tourStore.start(projectStore.activity?.intputSteps);
            return;
          }
        }
      }
    }
    await dashboardStore.handleMainButton();
  }
</script>

<section
  class="relative overflow-hidden rounded-3xl border border-border/50 bg-card p-8 shadow-sm lg:p-12"
>
  <div
    class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--color-primary),transparent_60%)]/8"
  ></div>

  <div class="relative flex flex-col items-center gap-8">
    {#if currentTarget}
      {@const TARGET_OPTIONS = projectStore.activity?.targets ?? []}
      <div class="flex w-full max-w-md flex-col items-center gap-3">
        <div
          class="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          <IconFlag size={14} stroke={1.5} />
          <span>运行终止点</span>
        </div>

        <Select.Root
          type="single"
          value={dashboardStore.target}
          onValueChange={handleTargetChange}
          disabled={isLocked}
        >
          <Select.Trigger
            icon={false}
            class="group flex h-auto w-full items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-4 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
          >
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                {#if isUpdatingTarget}
                  <IconLoader2 size={18} stroke={1.5} class="animate-spin" />
                {:else}
                  <RuntimeIcon
                    name={currentTarget?.icon}
                    size={18}
                    stroke={1.5}
                  />
                {/if}
              </div>
              <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground">
                    {currentTarget.label}
                  </span>
                  <span
                    class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    STEP {currentTarget.step}/{projectStore.activity?.targets
                      .length ?? 8}
                  </span>
                </div>
                <span class="truncate text-xs text-muted-foreground">
                  {isUpdatingTarget ? "正在同步配置…" : currentTarget.desc}
                </span>
              </div>
            </div>
            <IconChevronDown
              size={18}
              stroke={1.5}
              class="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </Select.Trigger>

          <Select.Content
            class="rounded-xl border border-border/50 p-2 shadow-xl"
          >
            {#each TARGET_OPTIONS as opt (opt.value)}
              <Select.Item
                value={opt.value!}
                class="group/item flex cursor-pointer items-center gap-3 rounded-lg p-2.5 transition-all duration-200 data-highlighted:bg-muted"
              >
                {#snippet children({ selected })}
                  <div
                    class={[
                      "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover/item:bg-primary/10 group-hover/item:text-primary",
                    ]}
                  >
                    <RuntimeIcon name={opt.icon} size={16} stroke={1.5} />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-foreground">
                        {opt.label}
                      </span>
                      <span
                        class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {opt.step}/{TARGET_OPTIONS.length}
                      </span>
                    </div>
                    <span class="truncate text-xs text-muted-foreground">
                      {opt.desc}
                    </span>
                  </div>
                {/snippet}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        {#if dashboardStore.runState !== "idle"}
          <p
            class="flex items-center gap-1.5 text-[11px] text-muted-foreground animate-fade-in"
          >
            <IconInfoCircle size={12} stroke={1.5} />
            <span>运行期间不可修改终止点</span>
          </p>
        {/if}
      </div>
    {/if}

    <div class="h-px w-full max-w-md bg-border/50"></div>

    <div use:autoAnimate class="flex min-h-10 items-center justify-center">
      {#if dashboardStore.runState === "idle"}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <IconInfoCircle size={16} stroke={1.5} />
          <span>{dashboardStore.hintText}</span>
        </div>
      {:else if dashboardStore.runState === "running"}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <IconDatabase size={16} stroke={1.5} class="text-primary" />
          <span>{dashboardStore.hintText}</span>
        </div>
      {:else}
        <div
          class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500"
        >
          <IconAlertTriangle size={16} stroke={1.5} />
          <span>{dashboardStore.hintText}</span>
        </div>
      {/if}
    </div>

    <button
      type="button"
      onclick={handleMainbutton}
      class={[
        "group relative flex size-44 items-center justify-center rounded-full border border-border/50 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        dashboardStore.runState === "idle" &&
          "bg-primary text-primary-foreground",
        dashboardStore.runState === "running" && "bg-card text-foreground",
        dashboardStore.runState === "terminating" &&
          "bg-destructive text-destructive-foreground",
      ]}
      aria-label={dashboardStore.buttonLabel}
    >
      {#if dashboardStore.runState === "running"}
        <span
          class="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping"
        ></span>
        <span class="absolute inset-2 rounded-full border border-primary/60"
        ></span>
      {/if}

      <div class="relative flex flex-col items-center gap-2">
        {#if dashboardStore.runState === "idle"}
          <IconPlayerPlayFilled size={48} stroke={1.5} />
        {:else if dashboardStore.runState === "running"}
          <IconPlayerStopFilled
            size={44}
            stroke={1.5}
            class="text-foreground"
          />
        {:else}
          <IconLoader2 size={44} stroke={1.5} class="animate-spin" />
        {/if}
        <span class="text-sm font-medium tracking-wide">
          {dashboardStore.buttonLabel}
        </span>
      </div>
    </button>

    {#if dashboardStore.runState === "terminating"}
      <div
        class="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/50 px-4 py-2 text-xs text-muted-foreground animate-fade-in"
      >
        <IconClock size={14} stroke={1.5} />
        <span>
          已等待
          <span class="font-mono text-foreground">
            {fmtTime(dashboardStore.terminatingSeconds)}
          </span>
          · 通常需要 30 秒以内
        </span>
      </div>
    {/if}
  </div>
</section>
