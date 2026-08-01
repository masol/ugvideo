<!-- AbilitySelector.svelte -->
<script lang="ts">
  import {
    CAPABILITY_TAGS,
    FUNCTION_CAPABILITIES,
    FUNCTION_DEFAULT_ABILITIES,
    FUNCTION_TAGS,
    IMAGE_FUNCTION_TAGS,
    tagIcons,
    tagLabels,
    VERSION_TAGS,
    VIDEO_FUNCTION_TAGS,
    type ModelAbility,
  } from "$lib/utils/model/types";
  import autoAnimate from "@formkit/auto-animate";

  let {
    abilities = $bindable<ModelAbility[]>([]),
  }: {
    abilities?: ModelAbility[];
  } = $props();

  const functionValues = Object.values(FUNCTION_TAGS) as ModelAbility[];
  const versionValues = Object.values(VERSION_TAGS) as ModelAbility[];

  const functionSet = new Set(functionValues);
  const versionSet = new Set(versionValues);

  /** 所有"能力类"标签（含文本 / 绘图 / 视频三类下的子能力） */
  const allCapSet = new Set<ModelAbility>([
    ...(Object.values(CAPABILITY_TAGS) as ModelAbility[]),
    ...(Object.values(IMAGE_FUNCTION_TAGS) as ModelAbility[]),
    ...(Object.values(VIDEO_FUNCTION_TAGS) as ModelAbility[]),
  ]);

  const functionItems = functionValues.map((v) => ({
    value: v,
    label: tagLabels[v],
    icon: tagIcons[v],
  }));
  const versionItems = versionValues.map((v) => ({
    value: v,
    label: tagLabels[v],
    icon: tagIcons[v],
  }));

  const currentFunction = $derived(abilities.find((a) => functionSet.has(a)));
  const currentVersion = $derived(abilities.find((a) => versionSet.has(a)));

  /** 当前函数下允许出现的能力标签集合（不依赖 reactive 闭包，避免读到旧值） */
  function getAllowedForFunction(
    fn: ModelAbility | undefined,
  ): Set<ModelAbility> {
    return new Set((fn && FUNCTION_CAPABILITIES[fn]) || []);
  }

  const currentAllowed = $derived(getAllowedForFunction(currentFunction));

  /** 当前函数下可被勾选的能力 chips（供 UI 渲染） */
  const currentCapabilityItems = $derived(
    ((currentFunction && FUNCTION_CAPABILITIES[currentFunction]) || []).map(
      (v) => ({
        value: v,
        label: tagLabels[v],
        icon: tagIcons[v],
      }),
    ),
  );

  const selectedCapabilities = $derived(
    new Set(abilities.filter((a) => allCapSet.has(a))),
  );

  function normalize(list: ModelAbility[]): ModelAbility[] {
    let activeFunc: ModelAbility | undefined;
    let activeVersion: ModelAbility | undefined;
    const caps: ModelAbility[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seenCap = new Set<ModelAbility>();
    for (const a of list) {
      if (functionSet.has(a)) activeFunc = a;
      else if (versionSet.has(a)) activeVersion = a;
      else if (allCapSet.has(a) && !seenCap.has(a)) {
        seenCap.add(a);
        caps.push(a);
      }
    }
    const result: ModelAbility[] = [];
    if (activeFunc) result.push(activeFunc);
    if (activeVersion) result.push(activeVersion);
    // 只保留属于 activeFunc 的 caps（用输入列表里解析出的 fn，不读 reactive）
    const allowed = getAllowedForFunction(activeFunc);
    result.push(...caps.filter((c) => allowed.has(c)));
    return result;
  }

  function selectFunction(v: ModelAbility) {
    if (currentFunction === v) return;
    // 剥离旧 function 与所有 caps，保留 version；再注入新 function + 默认 caps
    const rest = abilities.filter(
      (a) => !functionSet.has(a) && !allCapSet.has(a),
    );
    const defaults = FUNCTION_DEFAULT_ABILITIES[v] ?? [];
    abilities = normalize([v, ...rest, ...defaults]);
  }

  function selectVersion(v: ModelAbility) {
    const rest = abilities.filter((a) => !versionSet.has(a));
    abilities = normalize(currentVersion === v ? rest : [...rest, v]);
  }

  function toggleCapability(v: ModelAbility) {
    if (!currentAllowed.has(v)) return; // 防御：非当前 function 的 caps 禁止勾选
    const next = selectedCapabilities.has(v)
      ? abilities.filter((x) => x !== v)
      : [...abilities, v];
    abilities = normalize(next);
  }
</script>

<div class="space-y-4">
  <!-- 功能（互斥单选 · 至少一个） -->
  <div class="space-y-2">
    <div class="flex items-baseline justify-between">
      <span class="text-sm font-medium">功能</span>
      <span class="text-xs text-muted-foreground">单选 · 必选</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each functionItems as item (item.value)}
        {@const active = currentFunction === item.value}
        {@const Icon = item.icon}
        <button
          type="button"
          onclick={() => selectFunction(item.value)}
          class={[
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all duration-200",
            active
              ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
              : "border-border/50 bg-background text-foreground hover:border-border hover:bg-muted",
          ]}
        >
          <Icon class="size-3.5" stroke={1.5} />
          {item.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- 版本（互斥单选 · 可不选） -->
  <div class="space-y-2">
    <div class="flex items-baseline justify-between">
      <span class="text-sm font-medium">版本</span>
      <span class="text-xs text-muted-foreground">单选 · 可不选</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each versionItems as item (item.value)}
        {@const active = currentVersion === item.value}
        {@const Icon = item.icon}
        <button
          type="button"
          onclick={() => selectVersion(item.value)}
          class={[
            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all duration-200",
            active
              ? "border-sky-500/40 bg-sky-500/10 text-sky-600 shadow-sm dark:text-sky-400"
              : "border-border/50 bg-background text-foreground hover:border-border hover:bg-muted",
          ]}
        >
          <Icon class="size-3.5" stroke={1.5} />
          {item.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- 能力（按当前功能分组；切换功能时自动清空并填默认值） -->
  <div class="space-y-2" use:autoAnimate>
    {#if currentFunction && currentCapabilityItems.length > 0}
      <div class="flex items-baseline justify-between animate-fade-in">
        <span class="text-sm font-medium">能力</span>
        <span class="text-xs text-muted-foreground">可多选</span>
      </div>
      <div class="flex flex-wrap gap-1.5 animate-fade-in">
        {#each currentCapabilityItems as item (item.value)}
          {@const active = selectedCapabilities.has(item.value)}
          {@const Icon = item.icon}
          <button
            type="button"
            onclick={() => toggleCapability(item.value)}
            class={[
              "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all duration-200",
              active
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 shadow-sm dark:text-emerald-400"
                : "border-border/50 bg-background text-foreground hover:border-border hover:bg-muted",
            ]}
          >
            <Icon class="size-3.5" stroke={1.5} />
            {item.label}
          </button>
        {/each}
      </div>
    {:else if currentFunction}
      <p class="text-xs text-muted-foreground animate-fade-in">
        该功能暂无附加能力配置
      </p>
    {:else}
      <p class="text-xs text-muted-foreground animate-fade-in">
        选中「功能」后可进一步配置能力
      </p>
    {/if}
  </div>
</div>
