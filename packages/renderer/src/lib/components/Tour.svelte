<script lang="ts">
  import { tourStore } from "$lib/store/ui/tour.svelte";
  import { Walkthrough } from "./ui/walkthrough";
</script>

<Walkthrough bind:open={tourStore.open} steps={tourStore.steps} padding={2}>
  {#snippet children(ctx)}
    <div class="bg-zinc-900 text-white p-6 rounded-xl border border-zinc-800">
      <h3 class="font-bold text-xl text-purple-400">
        {ctx.currentStep()?.title}
      </h3>
      <p class="text-gray-400 my-4">
        {ctx.currentStep()?.description}
      </p>
      <button
        onclick={async () => {
          await tourStore.onStep(ctx.currentStepIndex());
          ctx.next();
        }}
        class="bg-white text-black px-4 py-1 rounded"
      >
        {#if ctx.isLastStep()}
          我知道了
        {:else}
          下一步 ->
        {/if}
      </button>
    </div>
  {/snippet}
</Walkthrough>
