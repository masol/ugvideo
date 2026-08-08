import { configStore } from "$lib/store/config.svelte";
import { dashboardStore } from "$lib/store/dashboard.svelte";
import { projectStore } from "$lib/store/project.svelte";
import { safeApi } from "../api";
import { AppearanceBuildin } from "./appearance";
import type { CommandDescriptor } from "./type";

import {
    push
} from "svelte-spa-router";

export const builtins: CommandDescriptor[] = [
    // ── 命令中心 ──
    // ── 导航 ──
    {
        id: 'navigation.home',
        label: '回到控制台',
        category: 'Navigation',
        handler: () => push("/"),
    },
    {
        id: 'navigation.back',
        label: '后退',
        category: 'Navigation',
        handler: () => history.back(),
    },
    {
        id: 'navigation.forward',
        label: '前进',
        category: 'Navigation',
        handler: () => history.forward(),
    },
    {
        id: 'navigation.reload',
        label: '刷新页面',
        category: 'Navigation',
        handler: () => location.reload(),
    },
    // ── 外观 ──
    {
        id: 'appearance.toggleDarkMode',
        label: '下一主题',
        category: 'Appearance',
        description: '循环设置主题',
        handler: () => {
            configStore.cycleTheme();
        },
    },
    ...AppearanceBuildin,
    {
        id: 'appearance.scrollToTop',
        label: '滚动到顶部',
        category: 'Appearance',
        handler: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    },
    {
        id: 'appearance.scrollToBottom',
        label: '滚动到底部',
        category: 'Appearance',
        handler: () =>
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
    },
    // ---任务执行---
    {
        id: 'project.open',
        label: '打开项目',
        category: 'Project',
        handler: () =>
            projectStore.open(),
    },
    {
        id: 'project.create',
        label: '新建项目',
        category: 'Project',
        handler: () =>
            projectStore.create(),
    },
    {
        id: 'project.close',
        label: '关闭项目',
        category: 'Project',
        handler: () =>
            projectStore.close(),
    },
    {
        id: 'project.start',
        label: '运行项目任务',
        category: 'Project',
        handler: () =>
            dashboardStore.start(),
    },
    {
        id: 'project.stop',
        label: '终止项目任务',
        category: 'Project',
        handler: () =>
            dashboardStore.stop(),
    },
    {
        id: 'project.forceStop',
        label: '强制杀死项目任务',
        category: 'Project',
        handler: () =>
            dashboardStore.stop(true),
    },

    // ── 开发者工具 ──
    {
        id: 'dev.icon-playground',
        label: '查看图标试验台',
        category: 'Developer',
        handler: () => push('/dev/icon-playground')
    },
    {
        id: 'dev.icons',
        label: '查看Tabler图标库',
        category: 'Developer',
        handler: () => push('/dev/icons')
    },
    {
        id: 'dev.emojis',
        label: '查看Emoji库',
        category: 'Developer',
        handler: () => push('/dev/emojis')
    },
    {
        id: 'dev.clearConsole',
        label: '清空控制台',
        category: 'Developer',
        handler: () => console.clear(),
    },
    {
        id: 'dev.logInfo',
        label: '打印页面信息',
        category: 'Developer',
        handler: () => {
            const info = {
                url: location.href,
                title: document.title,
                viewport: `${innerWidth}×${innerHeight}`,
                devicePixelRatio,
                language: navigator.language,
            };
            console.table(info);
            return info;
        },
    }, {
        id: 'dev.toogleDevTools',
        label: '切换开发者工具',
        category: 'Developer',
        handler: () => {
            return safeApi().window.toggleDevtools();
        },
    },

    // // ── 存储 ──
    // {
    //     id: 'storage.localClear',
    //     label: 'localStorage 清空',
    //     category: 'Storage',
    //     handler: () => {
    //         localStorage.clear();
    //         return true;
    //     },
    // },
];