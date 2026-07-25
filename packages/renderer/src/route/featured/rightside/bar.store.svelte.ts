/* eslint-disable @typescript-eslint/no-explicit-any */
// featured/rightside/store.svelte.ts
import {
    IconAiAgent,
    IconSketching
} from "@tabler/icons-svelte";
import type { Component } from "svelte";

export type PanelTab = {
    id: string;
    label: string;
    Icon: Component<any>;
};

function createRightPanelStore() {
    let activeTab = $state<string>("assistant");

    const tabs: PanelTab[] = [
        { id: "assistant", label: "助手", Icon: IconAiAgent as unknown as Component<any> },
        { id: "blueprint", label: "蓝图", Icon: IconSketching as unknown as Component<any> },
    ];

    return {
        get activeTab() {
            return activeTab;
        },
        set activeTab(value: string) {
            activeTab = value;
        },
        get tabs() {
            return tabs;
        },
    };
}

const KEY = Symbol.for('unigen.renderer.rightPanelStore');
export const rightPanelStore = ((globalThis as any)[KEY] ??= createRightPanelStore());