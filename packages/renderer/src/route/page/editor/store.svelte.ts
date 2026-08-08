import { configStore } from '$lib/store/config.svelte';
import { bottomPanelStore } from '$lib/store/local/bottombar.store.svelte';
import { projectStore } from '$lib/store/project.svelte';
import { confirmStore } from '$lib/store/ui/confirm.svelte';
import { layoutStore } from '$lib/store/ui/layout.svelte';
import { safeApi } from '$lib/utils/api';
import Logger from 'electron-log/renderer';
import * as monaco from 'monaco-editor';
import type { BlueprintKind } from '../../featured/rightside/glossary/store.svelte';

export type { BlueprintKind };
export type EditorLang = 'markdown' | 'json' | 'js';
export type CntParam = EditorLang | 'new' | ''

export interface PathAsset {
    fullKey: string;
    relative: string;
}

interface LoadResult {
    content: string;
}

export interface RouteParams {
    kind: BlueprintKind;
    id: string;
    contentFmt: CntParam;
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

export class EditorStore {
    private bCreateNew = false;

    kind = $state<BlueprintKind>('glossary');
    id = $state<string>('');
    contentFmt = $state<CntParam>('');

    content = $state<string>('');
    loadedContent = $state<string>('');

    private loadedKey: string | null = null;

    loading = $state<boolean>(false);
    busy = $state<boolean>(false);
    busyAction = $state<'save' | 'reload' | null>(null);

    lastError = $state<string | null>(null);

    cursorLine = $state<number>(1);
    cursorColumn = $state<number>(1);
    selectionLength = $state<number>(0);
    wordWrap = $state<boolean>(true);
    minimap = $state<boolean>(true);

    private resolveLang(
        kind: BlueprintKind,
        id: string,
        content: CntParam,
        loadedContent: string
    ): EditorLang {
        if (kind === 'glossary') {
            if (content) return 'markdown';
            return sniffContentLang(loadedContent);
        }
        if (kind === 'capa') {
            if (content) return content as EditorLang;
        }
        return 'json';
    }

    editorLang = $derived(
        this.resolveLang(this.kind, this.id, this.contentFmt, this.loadedContent)
    );
    language = $derived(MONACO_LANG[this.editorLang]);
    kindLabel = $derived(KIND_LABEL[this.kind]);
    langLabel = $derived(LANG_LABEL[this.editorLang]);
    fileName = $derived(`${this.id || 'untitled'}.${this.extForLang(this.editorLang)}`);
    dirty = $derived(this.content !== this.loadedContent);
    readonly = $derived(this.busy || this.loading);
    charCount = $derived(this.content.length);
    lineCount = $derived(this.content.length === 0 ? 1 : this.content.split('\n').length);

    readonly pathAssets = $derived.by<PathAsset[]>(() => {
        if (this.editorLang !== 'json') return [];
        const text = this.content.trim();
        if (!text) return [];

        let obj: unknown;
        try {
            obj = JSON.parse(text);
        } catch {
            return [];
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];

        const out: PathAsset[] = [];
        for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
            if (!/_path$/i.test(key)) continue;
            if (typeof val !== 'string') continue;
            const relative = val.trim();
            if (!relative || !isRelativePath(relative)) continue;
            out.push({ fullKey: key, relative });
        }
        return out;
    });

    private extForLang(l: EditorLang): string {
        return l === 'markdown' ? 'md' : l === 'js' ? 'js' : 'json';
    }

    private fingerprint(p: RouteParams): string {
        return `${p.kind}::${p.id}::${p.contentFmt}`;
    }

    async init(params: RouteParams) {
        if (this.id === params.id && this.kind === params.kind) {
            if ((params.contentFmt === 'new') && this.bCreateNew) return;
            if (params.contentFmt === this.contentFmt) return;
        }
        if (params.contentFmt === 'new') {
            this.bCreateNew = true;
            this.contentFmt = "";
            this.loadedKey = null;
        } else {
            this.bCreateNew = false;
            this.contentFmt = params.contentFmt;
        }

        this.kind = params.kind;
        this.id = params.id;
        const key = this.fingerprint(params);

        if (this.loadedKey === key && !this.loading) return;
        await this.load(key);
    }

    async load(key?: string) {
        this.loading = true;
        this.lastError = null;
        try {
            const result = this.bCreateNew ? { content: "" } : (await this.loadFromSource());
            this.content = result.content;
            this.loadedContent = result.content;
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

    async save() {
        if (this.busy) return;
        if (!configStore.silentSave) {
            const confirm = confirmStore.request({
                title: "项目可能无法运行",
                message: `${this.kindLabel}条目“${this.id}”的变动，可能导致本项目无法执行，确定要继续保存吗？。`,
                confirmLabel: "保存",
                destructive: true
            })
            if (!confirm) return;
        }
        this.busy = true;
        this.busyAction = 'save';
        try {
            const code = this.contentFmt.length > 0;
            let payload = this.content;

            // 术语表在非 code 模式下，存储的必须是合法的 JSON 值。
            // 当编辑器语言不是 JSON（即用户编辑纯文本/markdown 等）时，需要将其包裹为 JSON 字符串。
            // 这样后端 JSON.parse 后才能得到正确的字符串原始值。
            if (this.kind === 'glossary' && !code && this.editorLang !== 'json') {
                payload = JSON.stringify(this.content);
            }

            await safeApi().project.setContent({
                id: this.id,
                kind: this.kind,
                content: payload,
                code
            });
            this.loadedContent = this.content;
        } finally {
            this.busy = false;
            this.busyAction = null;
        }
    }

    async reload() {
        if (this.busy) return;
        this.busy = true;
        this.busyAction = 'reload';
        try {
            const result = await this.loadFromSource();
            this.content = result.content;
            this.loadedContent = result.content;
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

    private _editor: monaco.editor.IStandaloneCodeEditor | null = null;
    attachEditor(ed: monaco.editor.IStandaloneCodeEditor) {
        this._editor = ed;
    }
    detachEditor(ed?: monaco.editor.IStandaloneCodeEditor) {
        if (!ed || this._editor === ed) this._editor = null;
    }
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
    undo() { this.runFocused((ed) => ed.trigger('toolbar', 'undo', null)); }
    redo() { this.runFocused((ed) => ed.trigger('toolbar', 'redo', null)); }
    format() { this.runFocused((ed) => ed.getAction('editor.action.formatDocument')?.run()); }
    find() { this.runFocused((ed) => ed.getAction('actions.find')?.run()); }
    commandPalette() { this.runFocused((ed) => ed.getAction('editor.action.quickCommand')?.run()); }
    toggleWordWrap() { this.wordWrap = !this.wordWrap; }
    toggleMinimap() { this.minimap = !this.minimap; }

    setCursor(line: number, column: number, selLen: number) {
        this.cursorLine = line;
        this.cursorColumn = column;
        this.selectionLength = selLen;
    }

    onContentChanged(_next: string): void {
        // no-op：pathAssets 自动跟随 content 派生。
    }

    async previewAsset(relative: string): Promise<string | null> {
        try {

            const url = await safeApi().project.getURL(relative);
            projectStore.mediaURL = url;
            // 开始确认打开下方面板打开。
            layoutStore.openPanel("bottom");
            bottomPanelStore.setActiveTab("media");
            return url;
        } catch (e) {
            Logger.error(`[EditorStore] previewAsset failed: ${relative}`, e);
            return null;
        }
    }

    async openAsset(relative: string): Promise<void> {
        try {
            await safeApi().system.openPath({ path: relative });
        } catch (e) {
            Logger.error(`[EditorStore] openAsset failed: ${relative}`, e);
        }
    }

    private async loadFromSource(): Promise<LoadResult> {
        if (!this.id) return { content: "" };

        const code = this.contentFmt.length > 0;
        const raw = await safeApi().project.getContent({
            kind: this.kind,
            id: this.id,
            content: code
        });

        if (!raw) return { content: "" };

        // 术语表非 code 模式下，存储的是 JSON 值，需要还原为编辑器显示文本。
        if (this.kind === 'glossary' && !code) {
            try {
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'string') {
                    // 纯文本内容（如 markdown 原文），直接作为编辑内容
                    return { content: parsed };
                } else {
                    // 对象/数组等，格式化为 JSON 字符串供编辑器展示
                    return { content: JSON.stringify(parsed, null, 2) };
                }
            } catch {
                // 兼容旧数据：未包装的纯文本（可能无引号），直接使用
                return { content: raw };
            }
        }

        // 其他情况（code 模式或非 glossary）直接使用原始内容
        return { content: raw };
    }
}

const KEY = Symbol.for('unigen.renderer.editorStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const editorStore: EditorStore = ((globalThis as any)[KEY] ??= new EditorStore());

function sniffContentLang(text: string): EditorLang {
    const t = text.trim();
    if (!t) return 'json';
    const head = t[0];
    if (head === '{' || head === '[') {
        try {
            const v = JSON.parse(t);
            if (v && typeof v === 'object') return 'json';
        } catch { /* fallthrough */ }
    }
    return 'markdown';
}

function isRelativePath(p: string): boolean {
    const v = p.trim();
    if (!v) return false;
    if (v.startsWith('/')) return false;
    if (v.startsWith('\\\\')) return false;
    if (/^[a-zA-Z]:[\\/]/.test(v)) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) return false;
    if (/^(data|blob):/i.test(v)) return false;
    return true;
}