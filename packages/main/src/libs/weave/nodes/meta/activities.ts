/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · meta · activities JSON 拼接（纯代码，无 LLM）
 *
 * v3 变更：
 * - 完全去除硬编码的 `key: "script"` 项；只按 mainInputs 动态生成 N 项。
 * - binding key 统一 `#<originalKey>`，与 dump 阶段 getInput('#'+name) 同源。
 * - Config 完全交给 spec-setting 段，mainInputs 不混入。
 */

import type { Copywriting } from "./copywriting.js";
import type { ConfigItem, MainInputArtifact } from "./index.js";

export function buildActivities(
    copy: Copywriting,
    icons: Record<string, string>,
    mainInputs: MainInputArtifact[],
    configItems: ConfigItem[],
): any[] {
    const activities: any[] = [];

    if (mainInputs.length > 0) {
        const inputChildren: any[] = mainInputs.map((mi) => ({
            type: "text-list",
            binding: { key: `#${mi.name}` },
            addLabel: copy.mainInputAddLabel || `添加${mi.name}`,
            emptyTitle: copy.mainInputEmptyTitle || `暂无${mi.name}`,
            emptyIcon: "IconFileText",
            addDialogTitle: copy.mainInputAddDialogTitle || `添加${mi.name}`,
            editDialogTitle: copy.mainInputEditDialogTitle || `编辑${mi.name}`,
            editDialogDescription: copy.mainInputEditDialogDescription || mi.intent || "",
            editAlert: true,
            confirmTitle: copy.mainInputConfirmTitle || "确认删除",
            confirmMessage: copy.mainInputConfirmMessage || "确定删除吗？",
        }));

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
                        children: inputChildren,
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