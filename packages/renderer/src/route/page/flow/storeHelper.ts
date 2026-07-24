import TextInputDialog from "$lib/components/dyn/dialog/TextInputDialog.svelte";
import { dialogStore } from "$lib/store/ui/dialog.svelte";
import { safeApi } from "$lib/utils/api";
import type { PureInputArtifact } from "./store.svelte";

export async function pureInput(target: PureInputArtifact) {
    // target 携带：name / canonicalName / artifact / isArray / sizeEstimate / consumers
    const initialText = (await safeApi().project.getContent({ kind: "glossary", id: target.artifact?.name, content: true, noThrow: true })) ?? "";
    const content = await dialogStore.safeShow(
        TextInputDialog,
        {
            title: `编辑“${target.name}”`,
            description: target.artifact?.intent,
            placeholder: `期望${target.artifact?.isArray ? "数组" : "字符串"}。\n评估维度:${target.artifact?.qualityCriteria}`,
            initialText
        },
        { size: "xl" },
    );
    if (content === null) return;
    await safeApi().project.setContent({
        kind: "glossary",
        id: target.artifact?.name,
        content,
        code: true // 指示setContent当作res对待，不要再解码了。
    })
}