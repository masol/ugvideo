<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils/index";
  import { ChevronLeft, ChevronRight, X } from "@lucide/svelte";
  import { type Snippet } from "svelte";
  import { writable } from "svelte/store";
  import { fade } from "svelte/transition";
  import { setImageZoomContext, type ZoomImageData } from "./ctx";

  let {
    class: className,
    gallery = true, // 新增 prop，默认开启多图模式
    children,
  }: {
    class?: string;
    gallery?: boolean;
    children?: Snippet;
  } = $props();

  const registeredImagesStore = writable<ZoomImageData[]>([]);
  const currentImageIndexStore = writable<number | null>(null);
  const openStore = writable(false);

  let registeredImages = $state<ZoomImageData[]>([]);
  let currentImageIndex = $state<number | null>(null);
  let isOpen = $state(false);

  $effect(() => {
    registeredImages = $registeredImagesStore;
    currentImageIndex = $currentImageIndexStore;
    isOpen = $openStore;
  });

  const currentImageData = $derived(
    currentImageIndex !== null ? registeredImages[currentImageIndex] : null,
  );
  // 修改派生，当 gallery 为 false 时，始终认为没有多张图片
  const hasMultipleImages = $derived(gallery && registeredImages.length > 1);
  const hasPrevious = $derived(
    currentImageIndex !== null && currentImageIndex > 0,
  );
  const hasNext = $derived(
    currentImageIndex !== null &&
      currentImageIndex < registeredImages.length - 1,
  );

  function registerImage(imageData: Omit<ZoomImageData, "index">) {
    const index = $registeredImagesStore.length;
    $registeredImagesStore = [
      ...$registeredImagesStore,
      { ...imageData, index },
    ];
    return index;
  }

  function openImage(index: number) {
    $currentImageIndexStore = index;
    $openStore = true;
  }

  function nextImage() {
    if (currentImageIndex !== null && hasNext) {
      $currentImageIndexStore = currentImageIndex + 1;
    }
  }

  function prevImage() {
    if (currentImageIndex !== null && hasPrevious) {
      $currentImageIndexStore = currentImageIndex - 1;
    }
  }

  function closeZoom() {
    $openStore = false;
    $currentImageIndexStore = null;
  }

  setImageZoomContext({
    registeredImages: registeredImagesStore,
    currentImageIndex: currentImageIndexStore,
    open: openStore,
    registerImage,
    openImage,
    nextImage,
    prevImage,
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === "Escape") closeZoom();
    if (event.key === "ArrowLeft") prevImage();
    if (event.key === "ArrowRight") nextImage();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen && currentImageData}
  <div
    class={cn(
      "fixed inset-0 z-9999 flex items-center justify-center bg-black/90",
      className,
    )}
    transition:fade={{ duration: 150 }}
    aria-modal="true"
    role="dialog"
    tabindex="-1"
  >
    <div
      class="absolute inset-0"
      onclick={closeZoom}
      aria-label="Close"
      role="button"
    ></div>

    <div
      class="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center pointer-events-none"
    >
      <img
        src={currentImageData.src}
        alt={currentImageData.alt}
        class="block max-w-full max-h-full object-contain pointer-events-auto"
        transition:fade={{ duration: 300, delay: 50 }}
      />
    </div>

    {#if hasMultipleImages}
      <Button
        variant="ghost"
        size="icon"
        class="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 hover:bg-primary cursor-pointer pointer-events-auto disabled:opacity-30 disabled:pointer-events-none"
        onclick={prevImage}
        disabled={!hasPrevious}
        aria-label="Previous image"
      >
        <ChevronLeft class="h-8 w-8" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        class="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 hover:bg-primary cursor-pointer pointer-events-auto disabled:opacity-30 disabled:pointer-events-none"
        onclick={nextImage}
        disabled={!hasNext}
        aria-label="Next image"
      >
        <ChevronRight class="h-8 w-8" />
      </Button>
    {/if}

    <Button
      variant="ghost"
      size="icon"
      class="absolute top-4 right-4 pointer-events-auto text-white hover:text-gray-300 cursor-pointer hover:bg-primary"
      onclick={closeZoom}
      aria-label="Close zoomed image"
    >
      <X class="h-6 w-6" />
    </Button>
  </div>
{/if}

{@render children()}
