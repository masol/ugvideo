import DynEntry from '$lib/components/dyn/Entry.svelte';
import type { Step } from '$lib/components/ui/walkthrough/ctx';
import type { BlueprintFilters, InfoCardView, ProjectActivityData, TargetOption } from '@app/main/types';
import { layoutStore } from '../layout.svelte';
import type { IValueService } from './type';
import { ValueService } from './value-service.svelte';


function mergeInfocards(data: ProjectActivityData): InfoCardView[] {
    return [
        {
            id: "input-manager",
            icon: "IconBook2",
            title: "输入",
            subtitle: "原始素材",
            summary: "管理原始输入，点击进入查看与编辑。",
            activity: "input-manager",
            hint: "点击指定输入",
            ...data.infocards?.['input-manager']
        },
        {
            id: "spec-setting",
            icon: "IconSparkles",
            title: "设置",
            subtitle: "任务配置",
            summary: "调整生成规格，点击进入详细设置。",
            activity: "spec-setting",
            hint: "点击进行配置",
            ...data.infocards?.['spec-setting']
        },
        {
            id: "output",
            icon: "IconFileTextFilled",
            title: "输出",
            subtitle: "查看结果",
            summary: "查看AI 处理结果，点击打开项目目录。",
            activity: "",
            hint: "点击查看结果",
            ...data.infocards?.output
        },
    ]
}

export class ProjectActivity {
    readonly icon: string;
    readonly statusText: string;
    readonly inputKey: string;
    readonly header: { title: string, detail: string }
    readonly infocards: InfoCardView[];
    readonly hints: {
        idle: string;
        running: string;
        term: string;
    }
    readonly intputSteps: Step[] | null;
    readonly targets: TargetOption[] = []
    readonly service: IValueService;

    /**
     * 蓝图（术语表/元术语表/能力表）名称候选。
     * 由 main 下发的项目级配置，UI 层通过 projectStore.activity?.blueprintFilters 读取。
     * undefined = 不提供候选（工具栏退回纯文本输入）。
     */
    readonly blueprintFilters: BlueprintFilters | undefined;

    /**
     * 媒体资源字段白名单（如 ["image_path","audio_path"]）。
     * 编辑器读取 JSON 后，按此白名单筛出"素材"下拉。
     * 空数组 = 不渲染素材下拉。UI 层通过 projectStore.activity?.mediaFields 读取。
     */
    readonly mediaFields: string[];

    constructor(data: ProjectActivityData) {
        this.clearTop();
        this.icon = data.icon
        this.statusText = data.statusText
        this.header = data.header
        this.infocards = mergeInfocards(data);
        this.targets = data.targets ?? [];

        const targetSize = this.targets.length;
        this.targets.forEach((t, idx) => {
            t.value = `${idx + 1}/${targetSize}`
            t.step = idx + 1
        })

        this.hints = {
            idle: data.hints?.idle ?? "点击下方按钮，让AI开始工作。",
            running: data.hints?.running ?? "每一步结果都会自动保存，再次运行不会重复计算。可随时点击「终止」，已完成的部分不会丢失。",
            term: data.hints?.term ?? "正在等待当前这一步完成后安全停止。若此刻强制关机，当前正在进行的这一步将作废，需要重新计算。",
        };

        if (!data.checkInput) {
            this.intputSteps = null;
        } else {
            this.intputSteps = [
                {
                    target: "ib-input-manager",
                    title: data.checkInput?.title ?? "缺少输入",
                    description: data.checkInput?.description ?? "点击这里打开输入管理，添加输入后，开始运行",
                    position: "top",
                },
            ];
        }
        this.inputKey = data.checkInput?.key || "script";

        // ── 项目级配置：只做持有，不反向调用任何 UI/route store ──
        this.blueprintFilters = data.blueprintFilters;
        this.mediaFields = data.mediaFields ?? [];

        this.service = new ValueService();

        data.activities.forEach(act => {
            layoutStore.addActivity({
                id: act.id,
                icon: act.icon,
                label: act.label,
                component: DynEntry,
                props: {
                    ast: act.panel,
                    service: this.service
                }
            })
        })
    }

    clearTop() {
        const ids = layoutStore.topActivities.map((item) => item.id);
        ids.forEach((id) => {
            layoutStore.removeActivity(id)
        })
    }

    close() {

    }
}