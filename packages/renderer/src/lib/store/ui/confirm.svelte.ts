
/* ═══════════════════════════════════════════════════════════
   ConfirmState — 命令式 Promise 驱动的确认对话框状态
   ═══════════════════════════════════════════════════════════ */

import type { DialogSize } from "./dialog.svelte";

type VariantType = "question" | 'success' | 'info' | 'error' | 'warning';
// 定义 size 的类型枚举

class ConfirmStore {
  open = $state(false);
  title = $state("");
  message = $state("");
  icon = $state("");
  markdown = $state(false);
  size = $state<DialogSize>('md');
  variant = $state<VariantType>("question")
  hideCancel = $state(false);
  confirmLabel = $state("确认");
  cancelLabel = $state("取消");
  destructive = $state(false);
  private _resolve: ((confirmed: boolean) => void) | null = null;

  /**
   * 发起一次确认请求，返回 Promise<boolean>。
   * 调用方 await 即可拿到结果，确认 = true，取消/关闭 = false。
   */
  request(opts: {
    title: string;
    message: string;
    icon?: string;
    markdown?: boolean;
    size?: DialogSize;
    hideCancel?: boolean;
    variant?: VariantType,
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean> {
    // 如果上一次请求尚未被用户处理，隐式取消它
    if (this._resolve) {
      this._resolve(false);
      this._resolve = null;
    }

    this.title = opts.title;
    this.message = opts.message;
    this.hideCancel = opts.hideCancel ?? false;
    this.markdown = opts.markdown ?? false;
    this.size = opts.size ?? "md";
    this.icon = opts.icon ?? "";
    this.variant = opts.variant ?? "question";
    this.confirmLabel = opts.confirmLabel ?? "确认";
    this.cancelLabel = opts.cancelLabel ?? "取消";
    this.destructive = opts.destructive ?? false;
    this.open = true;

    return new Promise<boolean>((resolve) => {
      this._resolve = resolve;
    });
  }

  /** 用户点击确认按钮 */
  confirm() {
    this._resolve?.(true);
    this._resolve = null;
    this.open = false;
  }

  /** 用户点击取消按钮 */
  cancel() {
    this._resolve?.(false);
    this._resolve = null;
    this.open = false;
  }

  /**
   * AlertDialog.Root 的 onOpenChange 回调。
   * 处理用户通过 Esc / 点击遮罩关闭对话框的场景：
   * 若此时 _resolve 仍存在，说明既没有点确认也没有点取消，视为取消。
   */
  handleOpenChange(value: boolean) {
    if (!value && this._resolve) {
      this._resolve(false);
      this._resolve = null;
    }
    this.open = value;
  }
}

const KEY = Symbol.for('unigen.renderer.confirmStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const confirmStore: ConfirmStore = ((globalThis as any)[KEY] ??= new ConfirmStore());