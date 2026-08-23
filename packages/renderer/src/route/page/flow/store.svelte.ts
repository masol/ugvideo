/* eslint-disable svelte/prefer-svelte-reactivity */

// src/lib/flow/store.svelte.ts

import { rightPanelStore } from '$lib/store/local/rightbar.store.svelte';
import { layoutStore } from '$lib/store/ui/layout.svelte';
import { safeApi } from '$lib/utils/api';
import { hooks } from '$lib/utils/hook';
import type {
    GDagJSON,
    GuardKind,
    NodeKindT,
    NodeStatus,
    PNode,
    RegArtifact,
    RiskLevel,
    SizeEstimateT
} from '@app/main/types';
import dagre from '@dagrejs/dagre';
import {
    IconAdjustmentsCog,
    IconArrowMerge,
    IconArrowsJoin2,
    IconBlockquote,
    IconCategory,
    IconCut,
    IconFileZip,
    IconFilter,
    IconGavel,
    IconMap2,
    IconRoute,
    IconSearch,
    IconShieldCheck,
    IconSparkles,
    IconStar,
    IconSum,
    IconTransform
} from '@tabler/icons-svelte';
import type { Edge as XYEdge, Node as XYNode } from '@xyflow/svelte';
import DirectedGraph from 'graphology';
import { toast } from 'svelte-sonner';
import { push } from "svelte-spa-router";
import { messageStore } from '../../../lib/store/local/msg.svelte';
import { pureInput } from './storeHelper';

export type { GDagJSON, NodeStatus, PNode, RegArtifact };

// ─────────────────────────────────────────────────────────────
//  运行模式：同一份 store，两种宿主（整页 / 底部面板）
// ─────────────────────────────────────────────────────────────

export type FlowMode = 'page' | 'panel';

// ─────────────────────────────────────────────────────────────
//  本地视图类型
// ─────────────────────────────────────────────────────────────

export interface Crumb {
    graphId: string;
    label: string;
    fromNodeId: string | null;
}

export interface XY {
    x: number;
    y: number;
}

export type MapMode = 'concurrent' | 'sequential' | null;

export interface FlowNodeData extends Record<string, unknown> {
    pnode: PNode;
    hasChildren: boolean;
    mapMode: MapMode;
    arrayIn: boolean;
    arrayOut: boolean;
}

export interface FlowEdgeData extends Record<string, unknown> {
    artifact: RegArtifact | null;
    rawName: string;
}

export type DagFlowNode = XYNode<FlowNodeData>;
export type DagFlowEdge = XYEdge<FlowEdgeData>;

export type ArtifactRole = 'input' | 'output';

export interface SelectedArtifact {
    name: string;
    role: ArtifactRole;
    artifact: RegArtifact | null;
    producers: { id: string; name: string }[];
    consumers: { id: string; name: string }[];
}

export interface ResolvedIo {
    name: string;
    artifact: RegArtifact | null;
}

/**
 * 纯输入交付物：全 DAG 树（含递归子图）范围内，
 * 「有节点消费、无任何节点生产」的产物。
 * 是整套流程真正需要外部录入数据的入口。
 */
export interface PureInputArtifact {
    /** 图内出现的原始名（可能是别名） */
    name: string;
    /** 归一后的规范名（若在注册表内） */
    canonicalName: string;
    /** 注册表中的完整产物定义，未登记则为 null */
    artifact: RegArtifact | null;
    /** 是否数组产物（需录入多条同构数据） */
    isArray: boolean;
    /** 尺寸估计（未登记则为 null） */
    sizeEstimate: SizeEstimateT | null;
    /** 消费此产物的节点（跨所有层级） */
    consumers: { graphId: string; nodeId: string; nodeName: string }[];
}

// ─────────────────────────────────────────────────────────────
//  语义标签与视觉映射
// ─────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<NodeStatus, string> = {
    pending: '待处理',
    expanding: '展开中',
    expanded: '已展开',
    awaiting_code: '待编码',
    done: '完成',
    conflict: '冲突'
};

export const STATUS_TONE: Record<
    NodeStatus,
    'primary' | 'muted' | 'destructive' | 'accent'
> = {
    pending: 'muted',
    expanding: 'accent',
    expanded: 'primary',
    awaiting_code: 'accent',
    done: 'primary',
    conflict: 'destructive'
};

export const TRISTATE_LABEL: Record<string, string> = {
    pending: '待定',
    yes: '是',
    no: '否'
};

export const KIND_LABEL: Record<NodeKindT, string> = {
    extract: '提取',
    classify: '分类',
    summarize: '摘要',
    transform: '转换',
    merge: '合并',
    score: '评分',
    generate: '生成',
    lookup: '查询',
    aggregate: '聚合',
    route: '路由',
    split: '拆分',
    map: '映射',
    reduce: '归约',
    validate: '校验',
    critique: '评审',
    compress: '压缩',
    plan: "规划"
};

export const KIND_ICON: Record<NodeKindT, typeof IconFilter> = {
    extract: IconFilter,
    classify: IconCategory,
    summarize: IconBlockquote,
    transform: IconTransform,
    merge: IconArrowsJoin2,
    score: IconStar,
    generate: IconSparkles,
    lookup: IconSearch,
    aggregate: IconSum,
    route: IconRoute,
    split: IconCut,
    map: IconMap2,
    reduce: IconArrowMerge,
    validate: IconShieldCheck,
    critique: IconGavel,
    compress: IconFileZip,
    plan: IconAdjustmentsCog
};

export const RISK_LABEL: Record<RiskLevel, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险'
};

export const GUARD_KIND_LABEL: Record<GuardKind, string> = {
    validate: '校验',
    critique: '评审'
};

export const SIZE_LABEL: Record<SizeEstimateT, string> = {
    small: '小型',
    medium: '中型',
    large: '大型',
    unbounded: '无界'
};

export const SIZE_DESC: Record<SizeEstimateT, string> = {
    small: '<1K',
    medium: '1K–10K',
    large: '10K–600K',
    unbounded: '>600K'
};

export const MAP_MODE_LABEL: Record<'concurrent' | 'sequential', string> = {
    concurrent: '并发映射',
    sequential: '顺序映射'
};

export const MAP_MODE_DESC: Record<'concurrent' | 'sequential', string> = {
    concurrent: '对数组产物逐条并发执行同一思维操作，条间互不依赖',
    sequential: '对数组产物逐条顺序执行，前条结果可影响后条'
};

// ─────────────────────────────────────────────────────────────
//  布局公共常量
// ─────────────────────────────────────────────────────────────

const NODE_W = 260;
const NODE_H = 156;

// ─────────────────────────────────────────────────────────────
//  唯一布局引擎：dagre
// ─────────────────────────────────────────────────────────────

function layoutDagre(graph: DirectedGraph): Map<string, XY> {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
        rankdir: 'LR',
        nodesep: 56,
        ranksep: 120,
        marginx: 24,
        marginy: 24
    });

    graph.forEachNode((n) => g.setNode(n, { width: NODE_W, height: NODE_H }));
    graph.forEachDirectedEdge((_e, _a, s, t) => g.setEdge(s, t));

    dagre.layout(g);

    const pos = new Map<string, XY>();
    graph.forEachNode((n) => {
        const { x, y } = g.node(n);
        pos.set(n, { x: x - NODE_W / 2, y: y - NODE_H / 2 });
    });
    return pos;
}

// ─────────────────────────────────────────────────────────────
//  Store 主体
// ─────────────────────────────────────────────────────────────

export class FlowStore {
    private raw = $state.raw<GDagJSON | null>(null);
    private graphs = new Map<string, DirectedGraph>();
    private artifactIndex = new Map<string, RegArtifact>();

    id = $state<string>('');

    /** 宿主运行模式：整页 or 底部面板。默认整页。 */
    mode = $state<FlowMode>('panel');

    /** 顶层 DAG 名称：面板模式无 status 可依赖，toolbar 左侧显示它。 */
    dagName = $state<string>('');

    loading = $state<boolean>(false);
    lastError = $state<string | null>(null);
    private loadedId: string | null = null;

    private positions = $state.raw<Map<string, XY>>(new Map());

    crumbs = $state<Crumb[]>([]);

    selectedNodeId = $state<string | null>(null);
    selectedArtifactName = $state<string | null>(null);
    selectedArtifactRole = $state<ArtifactRole>('output');

    fitTrigger = $state<number>(0);
    miniMap = $state<boolean>(true);

    constructor() {
        // 项目关闭：清空一切历史数据，恢复到全新状态，等价于从未加载过
        hooks.hook('project:closed', async () => {
            this.reset();
        });
    }

    /**
     * 彻底复位：清空图 / 产物 / 交互 / 面包屑 / 布局，id 归零。
     * 幂等，可安全重复调用。
     */
    reset() {
        this.graphs.clear();
        this.artifactIndex.clear();

        this.raw = null;
        this.positions = new Map();

        this.id = '';
        this.dagName = '';
        this.loadedId = null;

        this.loading = false;
        this.lastError = null;

        this.crumbs = [];
        this.selectedNodeId = null;
        this.selectedArtifactName = null;
        this.selectedArtifactRole = 'output';

        // 让订阅 fit 的控制器不残留上一项目的视图状态
        this.fitTrigger++;
    }

    currentGraphId = $derived(
        this.crumbs.length > 0 ? this.crumbs[this.crumbs.length - 1].graphId : null
    );

    /** toolbar 左侧标题：优先 dagName，兜底 .${id}_state。 */
    title = $derived(this.dagName || (this.id ? `.${this.id}_state` : '未命名流程图'));

    nodes = $derived.by<DagFlowNode[]>(() => {
        void this.raw;
        const gid = this.currentGraphId;
        if (!gid) return [];
        const g = this.graphs.get(gid);
        if (!g) return [];
        const positions = this.positions;
        const out: DagFlowNode[] = [];
        g.forEachNode((key, attr) => {
            const pnode = attr as unknown as PNode;
            const { mapMode, arrayIn, arrayOut } = analyzeMapping(pnode, this.artifactIndex);
            out.push({
                id: key,
                type: 'dagNode',
                position: positions.get(key) ?? { x: 0, y: 0 },
                data: {
                    pnode: { ...pnode, id: key },
                    hasChildren: !!pnode.dag && this.graphs.has(pnode.dag),
                    mapMode,
                    arrayIn,
                    arrayOut
                }
            });
        });
        return out;
    });

    edges = $derived.by<DagFlowEdge[]>(() => {
        void this.raw;
        const gid = this.currentGraphId;
        if (!gid) return [];
        const g = this.graphs.get(gid);
        if (!g) return [];
        const out: DagFlowEdge[] = [];
        g.forEachDirectedEdge((ekey, attr, source, target) => {
            const eid = ekey ?? `${source}->${target}`;
            const rawName =
                (attr?.name as string) ?? (attr?.artifact as string) ?? '';
            const artifact = rawName
                ? (this.artifactIndex.get(rawName) ?? null)
                : null;
            out.push({
                id: eid,
                source,
                target,
                type: 'artifact',
                data: { artifact, rawName }
            });
        });
        return out;
    });

    nodeCount = $derived(this.nodes.length);
    edgeCount = $derived(this.edges.length);
    conflictCount = $derived(
        this.nodes.filter((n) => n.data.pnode.status === 'conflict').length
    );
    mapNodeCount = $derived(
        this.nodes.filter((n) => n.data.mapMode !== null).length
    );
    highRiskCount = $derived(
        this.nodes.filter((n) => n.data.pnode.risk === 'high').length
    );
    guardCount = $derived(
        this.nodes.filter((n) => n.data.pnode.guard === true).length
    );
    drillableCount = $derived(
        this.nodes.filter((n) => n.data.hasChildren).length
    );
    depth = $derived(this.crumbs.length);

    // ─────────────────────────────────────────────────────────
    //  纯输入交付物：递归扫描全 DAG 树（含子图）后聚合
    //  判据：某规范产物「被任意节点消费」且「无任意节点生产」
    // ─────────────────────────────────────────────────────────
    pureInputArtifacts: PureInputArtifact[] = $derived.by<PureInputArtifact[]>(() => {
        void this.raw;
        if (this.graphs.size === 0) return [];

        // 以规范名为键做归一聚合
        const canonicalOf = (name: string): string =>
            this.artifactIndex.get(name)?.name ?? name;

        // 每个规范名：是否被生产 / 消费；消费者集合；出现过的原始名
        interface Acc {
            produced: boolean;
            consumed: boolean;
            consumers: { graphId: string; nodeId: string; nodeName: string }[];
            rawNames: Set<string>;
        }
        const acc = new Map<string, Acc>();

        const ensure = (canon: string): Acc => {
            let a = acc.get(canon);
            if (!a) {
                a = { produced: false, consumed: false, consumers: [], rawNames: new Set() };
                acc.set(canon, a);
            }
            return a;
        };

        // 递归遍历所有已导入的子图（graphs 已是全树的扁平集合）
        for (const [gid, g] of this.graphs.entries()) {
            g.forEachNode((nodeId, attr) => {
                const pn = attr as unknown as PNode;
                const nodeName = pn.name || nodeId;

                for (const outName of pn.outputs ?? []) {
                    const canon = canonicalOf(outName);
                    const a = ensure(canon);
                    a.produced = true;
                    a.rawNames.add(outName);
                }
                for (const inName of pn.inputs ?? []) {
                    const canon = canonicalOf(inName);
                    const a = ensure(canon);
                    a.consumed = true;
                    a.rawNames.add(inName);
                    a.consumers.push({ graphId: gid, nodeId, nodeName });
                }
            });
        }

        const out: PureInputArtifact[] = [];
        for (const [canon, a] of acc.entries()) {
            if (a.consumed && !a.produced) {
                const artifact = this.artifactIndex.get(canon) ?? null;
                // 优先展示注册规范名，兜底任一原始名
                const displayName = artifact?.name ?? [...a.rawNames][0] ?? canon;
                out.push({
                    name: displayName,
                    canonicalName: canon,
                    artifact,
                    isArray: artifact?.isArray ?? false,
                    sizeEstimate: artifact?.sizeEstimate ?? null,
                    consumers: a.consumers
                });
            }
        }

        // 稳定排序：数组产物优先，其次按名字
        out.sort((x, y) => {
            if (x.isArray !== y.isArray) return x.isArray ? -1 : 1;
            return x.name.localeCompare(y.name);
        });
        return out;
    });

    pureInputCount = $derived(this.pureInputArtifacts.length);

    selectedNode: PNode | null = $derived.by<PNode | null>(() => {
        void this.raw;
        const id = this.selectedNodeId;
        const gid = this.currentGraphId;
        if (!id || !gid) return null;
        const g = this.graphs.get(gid);
        if (!g || !g.hasNode(id)) return null;
        const pnode = g.getNodeAttributes(id) as unknown as PNode;
        return {
            ...pnode,
            id,
            inputs: pnode.inputs ?? [],
            outputs: pnode.outputs ?? [],
            facets: pnode.facets ?? {}
        };
    });

    selectedNodeResolved = $derived.by(() => {
        const n = this.selectedNode;
        if (!n) return { inputs: [] as ResolvedIo[], outputs: [] as ResolvedIo[] };
        return {
            inputs: this.resolveIOList(n.inputs),
            outputs: this.resolveIOList(n.outputs)
        };
    });

    selectedArtifact: SelectedArtifact | null = $derived.by<SelectedArtifact | null>(
        () => {
            void this.raw;
            const name = this.selectedArtifactName;
            const gid = this.currentGraphId;
            if (!name || !gid) return null;
            const g = this.graphs.get(gid);
            if (!g) return null;

            const artifact = this.artifactIndex.get(name) ?? null;
            const producers: { id: string; name: string }[] = [];
            const consumers: { id: string; name: string }[] = [];

            g.forEachNode((key, attr) => {
                const pn = attr as unknown as PNode;
                const outs = pn.outputs ?? [];
                const ins = pn.inputs ?? [];
                const matchName = (ioName: string) => {
                    if (ioName === name) return true;
                    const reg = this.artifactIndex.get(ioName);
                    return reg?.name === (artifact?.name ?? name);
                };
                if (outs.some(matchName))
                    producers.push({ id: key, name: pn.name || key });
                if (ins.some(matchName))
                    consumers.push({ id: key, name: pn.name || key });
            });

            return {
                name,
                role: this.selectedArtifactRole,
                artifact,
                producers,
                consumers
            };
        }
    );

    /**
     * 「真正显示中」的产物——直接暴露正在被面板渲染的原始选中名。
     * 只有当 selectedArtifact 非空（即面板确实显示）时才有值，
     * 否则为 null。高亮/toggle 全部以它为唯一真源，杜绝僵尸态。
     */
    activeArtifactName = $derived(
        this.selectedArtifact ? this.selectedArtifactName : null
    );

    /**
     * 判断某个 IO 名是否是「当前正在显示的产物」。
     * 通过规范名归一比较：同一 artifact 的别名/规范名都算命中。
     * 仅当面板真正显示（selectedArtifact 非空）时才可能返回 true。
     */
    isArtifactActive(ioName: string): boolean {
        if (!this.selectedArtifact) return false;
        const active = this.selectedArtifactName;
        if (!active) return false;
        if (active === ioName) return true;
        const canonOf = (n: string) => this.artifactIndex.get(n)?.name ?? n;
        return canonOf(active) === canonOf(ioName);
    }

    // ── 公开查询 ──

    resolveArtifact(name: string): RegArtifact | null {
        return this.artifactIndex.get(name) ?? null;
    }

    resolveIOList(names: readonly string[]): ResolvedIo[] {
        return names.map((n) => ({
            name: n,
            artifact: this.artifactIndex.get(n) ?? null
        }));
    }

    // ── 布局 ──

    private runLayout() {
        const gid = this.currentGraphId;
        if (!gid) return;
        const g = this.graphs.get(gid);
        if (!g) return;
        this.positions = layoutDagre(g);
        this.requestFit();
    }

    relayout() {
        this.runLayout();
    }

    // ── 初始化 / 加载 ──

    async init(id: string, mode: FlowMode = 'panel') {
        this.mode = mode;
        const trimmed = (id ?? '').trim();
        if (this.loadedId === trimmed && !this.loading && this.raw) {
            return;
        }
        this.id = trimmed;
        await this.load();
    }

    private async load() {
        this.loading = true;
        this.lastError = null;
        try {
            const origData = await safeApi().project.get(`.${this.id}_state`);
            const data = origData.gdag;

            this.graphs.clear();
            for (const { id, data: sg } of data.graphs) {
                const g = new DirectedGraph();
                g.import(sg);
                this.graphs.set(id, g);
            }

            this.artifactIndex.clear();
            for (const a of data.artifacts) {
                this.artifactIndex.set(a.name, a);
                for (const al of a.aliases) this.artifactIndex.set(al, a);
            }

            this.selectedNodeId = null;
            this.selectedArtifactName = null;

            // DAG 名称：优先后端字段，兜底文件名
            this.dagName =
                (data as unknown as { name?: string }).name?.trim() ||
                `.${this.id}_state`;

            const rootGid = this.resolveRootGraphId(data);
            this.crumbs = rootGid
                ? [{ graphId: rootGid, label: '根图', fromNodeId: null }]
                : [];

            this.raw = data;
            this.loadedId = this.id;
            this.runLayout();
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
        } finally {
            this.loading = false;
        }
    }

    private resolveRootGraphId(data: GDagJSON): string | null {
        if (data.graphs.length === 0) return null;
        if (data.rootId) {
            for (const [gid, g] of this.graphs.entries()) {
                if (g.hasNode(data.rootId)) return gid;
            }
        }
        return data.graphs[0].id;
    }

    // ── 导航（每次换层都彻底清理交互态，杜绝僵尸高亮）──

    private clearInteraction() {
        this.selectedNodeId = null;
        this.selectedArtifactName = null;
    }

    drillInto(nodeId: string) {
        const gid = this.currentGraphId;
        if (!gid) return;
        const g = this.graphs.get(gid);
        if (!g || !g.hasNode(nodeId)) return;
        const pnode = g.getNodeAttributes(nodeId) as unknown as PNode;
        if (!pnode.dag || !this.graphs.has(pnode.dag)) return;

        this.crumbs = [
            ...this.crumbs,
            { graphId: pnode.dag, label: pnode.name || nodeId, fromNodeId: nodeId }
        ];
        this.clearInteraction();
        this.runLayout();
    }

    goToCrumb(index: number) {
        if (index < 0 || index >= this.crumbs.length) return;
        if (index === this.crumbs.length - 1) return;
        this.crumbs = this.crumbs.slice(0, index + 1);
        this.clearInteraction();
        this.runLayout();
    }

    goUp() {
        if (this.crumbs.length <= 1) return;
        this.goToCrumb(this.crumbs.length - 2);
    }

    // ── 交互回写 ──

    selectNode(id: string | null) {
        this.selectedNodeId = id;
        this.selectedArtifactName = null;
    }

    /**
     * 点击 IO：打开/切换产物面板。
     * toggle 判据用 isArtifactActive（真正显示中的产物、按规范名归一），
     * 彻底避免「未显示却高亮、再点无法关闭」的僵尸态。
     */
    selectArtifact(name: string | null, role: ArtifactRole = 'output') {
        if (name === null) {
            this.selectedArtifactName = null;
            return;
        }
        // 再次点击当前正在显示的同一产物（含别名归一）→ 关闭
        if (this.isArtifactActive(name)) {
            this.selectedArtifactName = null;
            return;
        }
        this.selectedArtifactName = name;
        this.selectedArtifactRole = role;
    }

    clearArtifact() {
        this.selectedArtifactName = null;
    }

    focusNode(id: string) {
        const gid = this.currentGraphId;
        if (!gid) return;
        const g = this.graphs.get(gid);
        if (!g || !g.hasNode(id)) return;
        this.selectedNodeId = id;
        this.requestFit();
    }

    requestFit() {
        this.fitTrigger++;
    }

    toggleMiniMap() {
        this.miniMap = !this.miniMap;
    }


    isRunning = $derived(messageStore.isLoading)
    // ─────────────────────────────────────────────────────────
    //  以下动作：预留业务钩子，实现留空由使用方接管
    // ─────────────────────────────────────────────────────────

    /** 执行整个 DAG。 */
    async runDag() {
        if (this.isRunning) {
            toast.warning("有反思任务执行中")
            return;
        }
        layoutStore.openPanel("right");
        rightPanelStore.activeTab = "assistant";
        const content = `/run --plan=${this.id}`;
        messageStore.addMessage({ role: "user", content });
        await messageStore.AIResponse(content);
    }

    /**
     * 为某个「纯输入交付物」录入数据。
     * 传入完整的 PureInputArtifact 结构，调用方可据此清楚地知道
     * 正在为「哪个产物 / 单一还是数组 / 何种尺寸 / 被谁消费」录入。
    */
    async enterPureInput(_target: PureInputArtifact) {
        await pureInput(_target);
    }

    /** 编辑某节点（结构 / 属性）。 */
    editNode(nodeId: string) {
        push(`/editor/capa/${nodeId}/`);
    }

    /** 编辑某节点的内容（产出内容 / prompt 等）。 */
    editNodeContent(nodeId: string) {
        push(`/editor/capa/${nodeId}/js`);
    }

    /** 编辑某产物（IO）。 */
    editArtifact(_nodeId: string, artifactName: string, _role: ArtifactRole) {
        push(`/editor/metag/${artifactName}/`);
    }

    async refresh() {
        if (this.loading) return;
        const prevCrumbs = this.crumbs;
        this.loadedId = null;
        await this.load();
        const restored: Crumb[] = [];
        for (const c of prevCrumbs) {
            if (this.graphs.has(c.graphId)) restored.push(c);
            else break;
        }
        if (restored.length > 0) {
            this.crumbs = restored;
            this.runLayout();
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  局部纯函数
// ─────────────────────────────────────────────────────────────

export function analyzeMapping(
    pnode: PNode,
    artifactIndex: ReadonlyMap<string, RegArtifact>
): { mapMode: MapMode; arrayIn: boolean; arrayOut: boolean } {
    const isArr = (name: string) => artifactIndex.get(name)?.isArray === true;
    const arrayIn = pnode.inputs?.some(isArr) ?? false;
    const arrayOut = pnode.outputs?.some(isArr) ?? false;
    if (!arrayIn && !arrayOut) return { mapMode: null, arrayIn, arrayOut };
    return {
        mapMode: pnode.sequential ? 'sequential' : 'concurrent',
        arrayIn,
        arrayOut
    };
}

const KEY = Symbol.for('unigen.renderer.flowStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const flowStore: FlowStore = ((globalThis as any)[KEY] ??= new FlowStore());