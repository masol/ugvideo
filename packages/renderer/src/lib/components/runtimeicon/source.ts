import type { IconifyJSON } from '@iconify/svelte';
import { addCollection } from '@iconify/svelte';
import * as TablerIcons from '@tabler/icons-svelte';
import Logger from 'electron-log/renderer.js';
import type { Component } from 'svelte';

export type IconKind = 'tabler' | 'iconify' | 'base64' | 'svg' | 'empty';

export interface ResolvedIcon {
    kind: IconKind;
    value: string | Component | null;
}

const FALLBACK_TABLER = 'IconQuestionMark';

let iconifyReady = false;
let registering: Promise<void> | null = null;

export function ensureIconifyCollections(): Promise<void> {
    if (iconifyReady) return Promise.resolve();
    if (registering) return registering;

    registering = (async () => {
        const mod = await import('@iconify-json/twemoji/icons.json');
        // icons.json 被 TS 推断为 {}，此处断言为 IconifyJSON
        addCollection((mod.default ?? mod) as unknown as IconifyJSON);
        iconifyReady = true;
        registering = null;
    })();

    return registering;
}

function toTablerName(raw: string): string {
    if (raw.startsWith('Icon')) return raw;
    return `Icon${raw.charAt(0).toUpperCase() + raw.slice(1)}`;
}

export function resolveIcon(name: string): ResolvedIcon {
    if (typeof name === 'function') {
        // 默认是一个Componet.将其视为tabler组件处理。
        return { kind: 'tabler', value: name as unknown as Component }
    }
    const raw = (name ?? '').trim();
    if (!raw) return { kind: 'empty', value: null };

    if (raw.startsWith('<svg')) return { kind: 'svg', value: raw };
    if (raw.startsWith('data:image') || raw.startsWith('base64,') || isLikelyBase64(raw)) {
        const uri = raw.startsWith('data:') ? raw : `data:image/png;base64,${stripBase64Prefix(raw)}`;
        return { kind: 'base64', value: uri };
    }
    if (raw.includes(':')) return { kind: 'iconify', value: raw };
    const dict = TablerIcons as unknown as Record<string, Component>;
    const comp = dict[toTablerName(raw)] ?? dict[FALLBACK_TABLER];
    if (!dict[toTablerName(raw)]) {
        Logger.debug(`[runtime icon]: invalid tabler iconname: ${toTablerName(raw)}`)
    }
    return { kind: 'tabler', value: comp };
}
function stripBase64Prefix(raw: string): string {
    return raw.startsWith('base64,') ? raw.slice('base64,'.length) : raw;
}
function isLikelyBase64(raw: string): boolean {
    return raw.startsWith('base64') || (raw.length > 64 && /^[A-Za-z0-9+/=\s]+$/.test(raw));
}