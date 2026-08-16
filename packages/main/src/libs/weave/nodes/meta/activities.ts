/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · meta · activities JSON 拼接（纯代码，无 LLM）
 */

import type { Copywriting } from "./copywriting.js";
import type { MainInputArtifact } from "./index.js";

export interface ConfigItem {
    originalKey: string;
    safeKey: string;
    label: string;
    defaultValue: string;
}

export function buildActivities(
    copy: Copywriting,
    icons: Record<string, string>,
    mainInput: MainInputArtifact,
    configItems: ConfigItem[],
): any[] {
    const activities: any[] = [];

    if (mainInput.exists) {
        activities.push({
            id: "input-manager",
            label: copy.inputSectionTitle || "输入管理",
            icon: icons.input_section || "IconBook2",
            panel: {
                type: "panel",
                children: [
                    {
                        type: "accordion-section",
                        title: copy.inputSectionTitle || "工作流描述",
                        icon: icons.script_list || "IconScript",
                        defaultOpen: true,
                        badge: "count",
                        children: [
                            {
                                type: "text-list",
                                binding: { key: "script" },
                                addLabel: copy.mainInputAddLabel || "添加",
                                emptyTitle: copy.mainInputEmptyTitle || "暂无内容",
                                emptyIcon: "IconFileText",
                                addDialogTitle: copy.mainInputAddDialogTitle || "添加",
                                editDialogTitle: copy.mainInputEditDialogTitle || "编辑",
                                editDialogDescription: copy.mainInputEditDialogDesc || "",
                                editAlert: true,
                                confirmTitle: copy.mainInputConfirmTitle || "确认删除",
                                confirmMessage: copy.mainInputConfirmMessage || "确定删除吗？",
                            },
                        ],
                    },
                ],
            },
        });
    }

    if (configItems.length > 0) {
        const configChildren: any[] = configItems.map((item) => ({
            type: "field",
            binding: { key: item.safeKey },
            label: item.label,
            editor: "dialog",
            dialogTitle: `编辑 ${item.label}`,
            dialogDescription: `为「${item.label}」维护默认内容。`,
            placeholder: item.defaultValue.length > 60
                ? item.defaultValue.slice(0, 60) + "…"
                : item.defaultValue,
            emptyHint: `点击编辑 ${item.label}`,
        }));

        activities.push({
            id: "spec-setting",
            label: copy.configSectionTitle || "配置",
            icon: icons.config_section || "IconSettings",
            panel: {
                type: "panel",
                children: [
                    {
                        type: "accordion-section",
                        title: "配置项",
                        icon: "IconSettings",
                        defaultOpen: true,
                        children: configChildren,
                    },
                ],
            },
        });
    }

    return activities;
}