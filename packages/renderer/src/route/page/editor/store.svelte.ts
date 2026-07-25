import { configStore } from '$lib/store/config.svelte';
import { confirmStore } from '$lib/store/ui/confirm.svelte';
import { safeApi } from '$lib/utils/api';
import * as monaco from 'monaco-editor';
import type { BlueprintKind } from '../../featured/rightside/glossary/store.svelte';

export type { BlueprintKind };
/** Monaco 语言类型 —— 由 kind + id + content 派生得出 */
export type EditorLang = 'markdown' | 'json' | 'js';
export type CntParam = EditorLang | 'new' | ''

interface LoadResult {
    content: string;
}

export interface RouteParams {
    kind: BlueprintKind;
    id: string;
    contentFmt: CntParam; // 只有具有有效值(length>0)，说明编辑内容。
}

/** 校验结果条目 */
export interface ValidationIssue {
    severity: 'error' | 'warning';
    line: number;
    column: number;
    message: string;
}

const MONACO_LANG: Record<EditorLang, string> = {
    markdown: 'markdown',
    json: 'json',
    js: 'javascript'
};

const KIND_LABEL: Record<BlueprintKind, string> = {
    glossary: 'Glossary',
    metag: 'MetaG',
    capa: 'Capa'
};

const LANG_LABEL: Record<EditorLang, string> = {
    markdown: 'Markdown',
    json: 'JSON',
    js: 'JavaScript'
};

// 如果id的值为空，表示请求新建。

/**
 * 编辑器状态枢纽（全局单例）—— 子组件全部读写 editorStore，彼此不直接通信。
 * 组件可频繁销毁/重建；只要身份指纹（kind+id+content）不变，即复用内存内容不重载。
 *
 * ⚠️ kind 是业务类型（glossary/metag/capa），不是语言类型。
 *    语言由 resolveLang(kind,id,content) 派生。
 */
export class EditorStore {
    private bCreateNew = false; // 本次编辑请求，是否为新建请求。
    // ── 路由参数 ──
    kind = $state<BlueprintKind>('glossary');
    id = $state<string>('');
    /** 路由传入的 content 参数（是否随路由预置内容）-- 如果有值(length>0)，来指示编辑内容还是编辑Row. */
    contentFmt = $state<CntParam>('');

    // ── 内容与状态 ──
    content = $state<string>('');
    private loadedContent = $state<string>('');

    /** 当前已加载内容的身份指纹；为空表示尚未加载 */
    private loadedKey: string | null = null;

    loading = $state<boolean>(false);
    /** 任一异步动作（保存/重载/验证）进行中 —— 期间编辑区只读 */
    busy = $state<boolean>(false);
    busyAction = $state<'save' | 'reload' | 'validate' | null>(null);

    issues = $state<ValidationIssue[]>([]);
    lastError = $state<string | null>(null);

    // ── 编辑器元信息（由 MonacoEditor 组件回写，供状态栏读取）──
    cursorLine = $state<number>(1);
    cursorColumn = $state<number>(1);
    selectionLength = $state<number>(0);
    wordWrap = $state<boolean>(true);
    minimap = $state<boolean>(true);

    /**
     * ── 语言解析（纯函数规则）──
     * glossary + id 以 "_" 开头 → markdown（含 Frontmatter）
     * glossary + 其它          → json（可能是纯字符串，仍走 json）
     * capa + content=true      → js
     * 其它                     → json（兜底）
     */
    private resolveLang(
        kind: BlueprintKind,
        id: string,
        content: string
    ): EditorLang {
        if (kind === 'glossary') {
            return id.startsWith('_') ? 'markdown' : 'json';
        }
        if (kind === 'capa') {
            if (content) {
                return content as EditorLang;
            }
        }
        return 'json';
    }

    // ── 派生 ──
    /** 当前编辑语言（Monaco 语言 id 的语义值） */
    editorLang = $derived(
        this.resolveLang(this.kind, this.id, this.contentFmt)
    );
    language = $derived(MONACO_LANG[this.editorLang]);
    /** 业务类型标签（Glossary/MetaG/Capa） */
    kindLabel = $derived(KIND_LABEL[this.kind]);
    /** 语言标签（Markdown/JSON/JavaScript）—— 供状态栏/工具栏展示 */
    langLabel = $derived(LANG_LABEL[this.editorLang]);
    fileName = $derived(`${this.id || 'untitled'}.${this.extForLang(this.editorLang)}`);
    dirty = $derived(this.content !== this.loadedContent);
    readonly = $derived(this.busy || this.loading);
    charCount = $derived(this.content.length);
    lineCount = $derived(this.content.length === 0 ? 1 : this.content.split('\n').length);
    errorCount = $derived(this.issues.filter((i) => i.severity === 'error').length);
    warningCount = $derived(this.issues.filter((i) => i.severity === 'warning').length);

    private extForLang(l: EditorLang): string {
        return l === 'markdown' ? 'md' : l === 'js' ? 'js' : 'json';
    }

    private fingerprint(p: RouteParams): string {
        return `${p.kind}::${p.id}::${p.contentFmt}`;
    }

    /**
     * 由路由页面调用。身份指纹不变 → 直接复用当前 store，不重新加载。
     * 仅同步参数字段（保持派生正确），内容与 loadedContent 原样保留。
     */
    async init(params: RouteParams) {
        if (this.id === params.id && this.kind === params.kind) {
            if ((params.contentFmt === 'new') && this.bCreateNew) {
                return;
            }
            if (params.contentFmt === this.contentFmt) {
                return;
            }
        }
        if (params.contentFmt === 'new') {
            this.bCreateNew = true;
            this.contentFmt = "";
            this.loadedKey = null;
        } else {
            this.bCreateNew = false;
            // 参数字段始终对齐（即便复用也要保证 kind/language 等派生正确）
            this.contentFmt = params.contentFmt;
        }

        this.kind = params.kind;
        this.id = params.id;
        const key = this.fingerprint(params);

        if (this.loadedKey === key && !this.loading) {
            // 指纹一致：复用内存内容，跳过加载
            return;
        }
        await this.load(key);
    }

    /**
     * 异步加载内容 —— 留空业务实现。
     * ⚠️ 不再从数据源回写 kind；kind 恒由路由参数决定，语言由派生规则决定。
     */
    async load(key?: string) {
        this.loading = true;
        this.lastError = null;
        try {
            const result = this.bCreateNew ? { content: "" } : (await this.loadFromSource());
            this.content = result.content;
            this.loadedContent = result.content;
            this.issues = [];
            this.loadedKey = key ?? this.fingerprint({
                kind: this.kind,
                id: this.id,
                contentFmt: this.contentFmt
            });
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
        } finally {
            this.loading = false;
        }
    }

    // ────────────────────────────────────────────────────────────
    //  异步业务钩子 —— 留空，仅演示锁定/解锁语义
    // ────────────────────────────────────────────────────────────

    /** 保存（异步）—— 执行期间 readonly=true，内容区不可操作 */
    async save() {
        if (this.busy) return;
        if (!configStore.silentSave) {
            const confirm = confirmStore.request({
                title: "项目可能无法运行",
                message: `${this.kindLabel}条目“${this.id}”的变动，可能导致本项目无法执行，确定要继续保存吗？。`,
                confirmLabel: "保存",
                destructive: true
            })
            if (!confirm) {
                return;
            }
        }
        this.busy = true;
        this.busyAction = 'save';
        try {
            safeApi().project.setContent({
                id: this.id,
                kind: this.kind,
                content: this.content,
                code: this.contentFmt.length > 0
            })
            this.loadedContent = this.content; // 保存成功后基线对齐
        } finally {
            this.busy = false;
            this.busyAction = null;
        }
    }

    /** 重新加载（异步）—— 强制覆盖当前编辑内容（忽略指纹缓存） */
    async reload() {
        if (this.busy) return;
        this.busy = true;
        this.busyAction = 'reload';
        try {
            const result = await this.loadFromSource();
            this.content = result.content;
            this.loadedContent = result.content;
            this.issues = [];
            this.loadedKey = this.fingerprint({
                kind: this.kind,
                id: this.id,
                contentFmt: this.contentFmt
            });
        } finally {
            this.busy = false;
            this.busyAction = null;
        }
    }

    /** 校验（异步）—— 结果写入 issues */
    async validate() {
        if (this.busy) return;
        this.busy = true;
        this.busyAction = 'validate';
        try {
            safeApi().project.verifyContent({
                id: this.id,
                kind: this.kind,
                content: this.content,
                code: this.contentFmt.length > 0
            })
            this.issues = [];
        } finally {
            this.busy = false;
            this.busyAction = null;
        }
    }

    // ── 编辑区常用功能（由我实现，非留空）──

    private _editor: monaco.editor.IStandaloneCodeEditor | null = null;
    attachEditor(ed: monaco.editor.IStandaloneCodeEditor) {
        this._editor = ed;
    }
    detachEditor(ed?: monaco.editor.IStandaloneCodeEditor) {
        if (!ed || this._editor === ed) this._editor = null;
    }
    /** 聚焦后延一帧执行：确保焦点事件已派发到 Monaco 焦点跟踪器 */
    private runFocused(fn: (ed: monaco.editor.IStandaloneCodeEditor) => void) {
        const ed = this._editor;
        if (!ed) return;
        ed.focus();
        requestAnimationFrame(() => {
            const cur = this._editor;
            if (!cur || cur !== ed) return;
            fn(cur);
        });
    }
    undo() {
        this.runFocused((ed) => ed.trigger('toolbar', 'undo', null));
    }
    redo() {
        this.runFocused((ed) => ed.trigger('toolbar', 'redo', null));
    }
    format() {
        this.runFocused((ed) => ed.getAction('editor.action.formatDocument')?.run());
    }
    find() {
        this.runFocused((ed) => ed.getAction('actions.find')?.run());
    }
    commandPalette() {
        this.runFocused((ed) => ed.getAction('editor.action.quickCommand')?.run());
    }
    toggleWordWrap() {
        this.wordWrap = !this.wordWrap;
    }
    toggleMinimap() {
        this.minimap = !this.minimap;
    }

    setCursor(line: number, column: number, selLen: number) {
        this.cursorLine = line;
        this.cursorColumn = column;
        this.selectionLength = selLen;
    }

    /** mock 数据源 —— 按派生语言生成示例，脱离外部依赖也能完整渲染 */
    private async loadFromSource(): Promise<LoadResult> {
        if (!this.id) {
            // @TODO: 根据kind,创建模板。
            return {
                content: ""
            }
        }

        const content = await safeApi().project.getContent({
            kind: this.kind,
            id: this.id,
            content: this.contentFmt.length > 0
        });

        return {
            content
        }


        // await this.mockAsync(650);
        // const lang = this.resolveLang(this.kind, this.id, this.contentFmt);

        // if (lang === 'markdown') {
        //     return {
        //         content: `---\ntitle: ${this.id || 'Untitled'}\nkind: ${this.kind}\ntags: [glossary, markdown]\n---\n\n# ${this.id || 'Untitled'} 词条\n\n> 带 Frontmatter 的 Markdown 文档。\n\n## 说明\n\n- 以 \`_\` 开头的 glossary 词条走 Markdown 渲染。\n`
        //     };
        // }
        // if (lang === 'js') {
        //     return {
        //         content: `// ${this.id || 'capability'}.js — capa 能力脚本（纯 JS）\n// 输入 "app." 或 "db." 触发补全项\n\nconst result = app.\n\ndb.query("SELECT * FROM users");\n`
        //     };
        // }
        // // json（含 glossary 非下划线，可能是纯字符串场景）
        // return {
        //     content: JSON.stringify(
        //         {
        //             id: this.id || 'sample',
        //             kind: this.kind,
        //             payload: { autosave: true, wordWrap: 'on' },
        //             tags: ['electron', 'monaco', this.kind]
        //         },
        //         null,
        //         2
        //     )
        // };
    }
}

/** ── 全局唯一实例：所有子组件共用 ── */
const KEY = Symbol.for('unigen.renderer.editorStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const editorStore: EditorStore = ((globalThis as any)[KEY] ??= new EditorStore());