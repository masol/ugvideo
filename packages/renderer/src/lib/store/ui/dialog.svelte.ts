import type { DialogComponentProps } from '$lib/types/dialog';
import type { Component } from 'svelte';

type BaseProps = Record<string, unknown>;

type DialogComponent<R = unknown, P extends BaseProps = BaseProps> = Component<
    DialogComponentProps<R> & P
>;

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'xl2' | 'xl6' | 'full';

export const DIALOG_SIZE_CLASSES: Record<DialogSize, string> = {
    sm: '!max-w-sm',
    md: '!max-w-md',
    lg: '!max-w-lg',
    xl2: '!max-w-2xl',
    xl: '!max-w-4xl',
    xl6: '!max-w-6xl',
    full: 'w-screen h-screen max-w-none',
};

interface DialogState {
    id: string;
    component: Component<DialogComponentProps<unknown> & BaseProps>;
    props: BaseProps;
    persistent: boolean;
    closeOnEscape: boolean;
    contentClass?: string;
    size: DialogSize;
    showCloseButton: boolean; // 新增
    _resolve: (value: unknown) => void;
    _reject: (reason?: unknown) => void;
}

interface ShowOptions {
    id?: string;
    persistent?: boolean;
    contentClass?: string;
    closeOnEscape?: boolean;
    size?: DialogSize;
    showCloseButton?: boolean; // 新增
}

export class DialogCancelledError extends Error {
    constructor(public readonly reason?: unknown) {
        super('Dialog cancelled');
        this.name = 'DialogCancelledError';
    }
}

class DialogStore {
    private stack = $state<DialogState[]>([]);
    private idCounter = 0;

    get dialogs(): readonly DialogState[] {
        return this.stack;
    }

    get current(): DialogState | null {
        return this.stack[this.stack.length - 1] || null;
    }

    get isOpen(): boolean {
        return this.stack.length > 0;
    }

    get count(): number {
        return this.stack.length;
    }

    async show<R = unknown, P extends BaseProps = BaseProps>(
        component: DialogComponent<R, P>,
        props?: P,
        options?: ShowOptions
    ): Promise<R> {
        return new Promise<R>((resolve, reject) => {
            const id = options?.id || `dialog-${++this.idCounter}`;
            this.stack.push({
                id,
                component: component as Component<DialogComponentProps<unknown> & BaseProps>,
                props: (props ?? {}) as BaseProps,
                persistent: options?.persistent ?? false,
                closeOnEscape: options?.closeOnEscape ?? true,
                contentClass: options?.contentClass,
                size: options?.size ?? 'md',
                showCloseButton: options?.showCloseButton ?? false, // 默认不显示，由组件自己控制
                _resolve: resolve as (value: unknown) => void,
                _reject: reject
            });
        });
    }

    /**
     * safeShow：取消/backdrop 时返回 null，不抛出异常
     * 返回 null 而非 undefined，语义明确表示"用户主动取消"
     */
    async safeShow<R = unknown, P extends BaseProps = BaseProps>(
        component: DialogComponent<R, P>,
        props?: P,
        options?: ShowOptions
    ): Promise<R | null> {
        try {
            return await this.show<R, P>(component, props, options);
        } catch (e) {
            if (e instanceof DialogCancelledError) {
                return null;
            }
            throw e; // 真正的异常继续上抛
        }
    }

    close<T = unknown>(id?: string, data?: T): void {
        if (!id) {
            const dialog = this.stack.pop();
            dialog?._resolve(data);
        } else {
            const index = this.stack.findIndex((d) => d.id === id);
            if (index !== -1) {
                const [dialog] = this.stack.splice(index, 1);
                dialog._resolve(data);
            }
        }
    }

    cancel(id?: string, reason?: unknown): void {
        const err = new DialogCancelledError(reason);
        if (!id) {
            const dialog = this.stack.pop();
            dialog?._reject(err);
        } else {
            const index = this.stack.findIndex((d) => d.id === id);
            if (index !== -1) {
                const [dialog] = this.stack.splice(index, 1);
                dialog._reject(err);
            }
        }
    }

    closeAll(): void {
        const err = new DialogCancelledError('closed_all');
        this.stack.forEach((dialog) => dialog._reject(err));
        this.stack = [];
    }

    isDialogOpen(id: string): boolean {
        return this.stack.some((d) => d.id === id);
    }
}

const KEY = Symbol.for('unigen.renderer.dialogStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dialogStore: DialogStore = ((globalThis as any)[KEY] ??= new DialogStore());

/**
const confirmed = await dialogStore.show(
        ConfirmDialog,
        {
          title: "是否终止任务?",
          message: `<p>test</p>`,
        },
        { size: "xl" },
      );
      if (confirmed) {
        // 用户点了确认
      }
    } catch (e) {
      if (e instanceof DialogCancelledError) {
        // 用户取消/点击backdrop，正常流程，无需处理
      } else {
        console.error(e);
        // 真正的异常才上报
        throw e;
      }
    }

// safeShow：无需 try/catch，取消返回 null
const confirmed = await dialogStore.safeShow(ConfirmDialog, {
    title: '是否终止任务?',
    message: msg
});
if (confirmed === null) return; // 用户取消
if (confirmed) {  }
 */