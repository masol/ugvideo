<script lang="ts">
	import { cn } from '$lib/utils/index';
	import type { TreeViewRootProps } from './types';

	let { children, class: className }: TreeViewRootProps = $props();
</script>

<div role="tree" class={cn('flex flex-col', className)}>
	{@render children?.()}
</div>
