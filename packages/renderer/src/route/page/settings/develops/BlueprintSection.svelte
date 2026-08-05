<script lang="ts">
  import * as NumberField from "$lib/components/ui/number-field";
  import { Switch } from "$lib/components/ui/switch";
  import { configStore } from "$lib/store/config.svelte";
  import { IconTable } from "@tabler/icons-svelte";
  import { debounce } from "radashi";
  import SettingRow from "./SettingRow.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  // ── 每页条目数 ──
  let itemsPerPageLocal = $state(configStore.itemsPerPage);
  let pendingItemsPerPage = configStore.itemsPerPage;

  const commitItemsPerPage = debounce({ delay: 500 }, (v: number) => {
    configStore.setConfig("itemsPerPage", v);
  });

  function onItemsPerPageChange(v: number) {
    itemsPerPageLocal = v;
    pendingItemsPerPage = v;
    commitItemsPerPage(v);
  }

  // ── 并行度 ──
  let concurrencyLocal = $state(configStore.concurrency ?? 10); // 默认 10
  let pendingConcurrency = configStore.concurrency ?? 10;

  const commitConcurrency = debounce({ delay: 500 }, (v: number) => {
    configStore.setConfig("concurrency", v);
  });

  function onConcurrencyChange(v: number) {
    concurrencyLocal = v;
    pendingConcurrency = v;
    commitConcurrency(v);
  }

  // ── 卸载前冲刷所有挂起值 ──
  $effect(() => {
    return () => {
      if (commitItemsPerPage.isPending()) {
        commitItemsPerPage.flush(pendingItemsPerPage);
      }
      if (commitConcurrency.isPending()) {
        commitConcurrency.flush(pendingConcurrency);
      }
    };
  });
</script>

<SettingsSection icon={IconTable} title="蓝图" description="表格分页与展示行为">
  <!-- 每页条目数 -->
  <SettingRow title="每页显示条目数" description="单页渲染的记录数量（6 - 20）">
    {#snippet control()}
      <div class="w-48">
        <NumberField.Root
          bind:value={() => itemsPerPageLocal, (v) => onItemsPerPageChange(v)}
          min={6}
          max={28}
        >
          <NumberField.Group>
            <NumberField.Decrement />
            <NumberField.Input />
            <NumberField.Increment />
          </NumberField.Group>
        </NumberField.Root>
      </div>
    {/snippet}
  </SettingRow>

  <!-- 并行度（新增） -->
  <SettingRow
    title="并行度"
    description="控制并行访问 LLM 池的最大数量（1 – 3000）"
  >
    {#snippet control()}
      <div class="w-48">
        <NumberField.Root
          bind:value={() => concurrencyLocal, (v) => onConcurrencyChange(v)}
          min={1}
          max={3000}
        >
          <NumberField.Group>
            <NumberField.Decrement />
            <NumberField.Input />
            <NumberField.Increment />
          </NumberField.Group>
        </NumberField.Root>
      </div>
    {/snippet}
  </SettingRow>

  <!-- 可删除 -->
  <SettingRow
    title="可删除蓝图元素"
    description="允许删除术语表、元术语表以及能力表中成员"
  >
    {#snippet control()}
      <Switch
        bind:checked={
          () => configStore.rmblueprint,
          (v) => configStore.setConfig("rmblueprint", v)
        }
      />
    {/snippet}
  </SettingRow>

  <!-- 变动确认 -->
  <SettingRow
    title="变动确认"
    description="在工作流变动(编辑、反思)之前，提醒用户可能的风险。"
  >
    {#snippet control()}
      <Switch
        bind:checked={
          () => !configStore.silentSave,
          (v) => configStore.setConfig("silentSave", !v)
        }
      />
    {/snippet}
  </SettingRow>

  <!-- 并行执行 -->
  <SettingRow
    title="并行执行"
    description="在助手调整工作流时，是否允许工作流执行。"
  >
    {#snippet control()}
      <Switch
        bind:checked={
          () => configStore.parallelRun,
          (v) => configStore.setConfig("parallelRun", v)
        }
      />
    {/snippet}
  </SettingRow>
</SettingsSection>
