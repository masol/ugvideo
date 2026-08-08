import { bottomPanelStore } from "$lib/store/local/bottombar.store.svelte";
import { rightPanelStore } from "$lib/store/local/rightbar.store.svelte";
import { layoutStore } from "$lib/store/ui/layout.svelte";


export const AppearanceBuildin = [
    {
        id: 'appearance.togglerightbar',
        label: '切换右侧栏',
        category: 'Appearance',
        handler: () => {
            layoutStore.togglePanel("right")
        },
    },
    {
        id: 'appearance.togglebottom',
        label: '切换下侧栏',
        category: 'Appearance',
        handler: () => {
            layoutStore.togglePanel("bottom")
        },
    },
    {
        id: 'appearance.toggleleft',
        label: '切换左侧栏',
        category: 'Appearance',
        handler: () => {
            layoutStore.togglePanel("left")
        },
    },
    {
        id: 'appearance.showAssistance',
        label: '显示助手',
        category: 'Appearance',
        handler: () => {
            layoutStore.openPanel('right');
            rightPanelStore.activeTab = "assistant"
        },
    },
    {
        id: 'appearance.showBlueprint',
        label: '显示蓝图',
        category: 'Appearance',
        handler: () => {
            layoutStore.openPanel('right');
            rightPanelStore.activeTab = "blueprint"
        },
    },
    {
        id: 'appearance.showSystemLog',
        label: '显示日志',
        category: 'Appearance',
        handler: () => {
            layoutStore.openPanel('bottom');
            bottomPanelStore.activeTab = "logger"
        },
    },
    {
        id: 'appearance.showDAG',
        label: '显示DAG',
        category: 'Appearance',
        handler: () => {
            layoutStore.openPanel('bottom');
            bottomPanelStore.activeTab = "dag"
        },
    },
]