import { AppInitConfig } from "$types/AppInitConfig.js";
import { WindowEventPayload, WindowEventType } from "$types/shared/rpcevt.js";
import { BrowserWindow, Rectangle, screen } from "electron";
import { RpcContext } from "../../api/type.js";
import { notify } from "./rpcevt.js";

// ─── 工具函数 ───────────────────────────────────────────────────

function isVisibleOnAnyDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return !(
      bounds.x + bounds.width < area.x ||
      bounds.x > area.x + area.width ||
      bounds.y + bounds.height < area.y ||
      bounds.y > area.y + area.height
    );
  });
}

// ─── 窗口服务 ───────────────────────────────────────────────────

export class WindowService {
  readonly #preload: { path: string };
  readonly #renderer: { path: string } | URL;
  readonly #openDevTools: boolean;
  private readonly dialogOpenSet = new Set<number>()

  constructor({
    initConfig,
    openDevTools = false,
  }: {
    initConfig: AppInitConfig;
    openDevTools?: boolean;
  }) {
    this.#preload = initConfig.preload;
    this.#renderer = initConfig.renderer;
    this.#openDevTools = openDevTools;
  }

  // ── 单例 ────────────────────────────────────────────────────

  static #instance: WindowService | undefined;

  static get instance(): WindowService {
    if (!WindowService.#instance) {
      throw new Error("WindowService尚未初始化!");
    }
    return WindowService.#instance;
  }

  static init(opts: { initConfig: AppInitConfig; openDevTools?: boolean }) {
    if (!WindowService.#instance) {
      WindowService.#instance = new WindowService(opts);
    }
    return WindowService.#instance;
  }

  private stateNotify(type: WindowEventType, win: BrowserWindow) {
    const payload: WindowEventPayload = {
      type,
      windowId: win.id,
      timestamp: Date.now(),
    };
    notify(win, "winstate", payload);
  }

  // ── 窗口事件绑定 ─────────────────────────────────────────────
  /**
   * 将原生窗口事件映射到统一的 notify 派发
   */
  private attachWindowEvents(win: BrowserWindow): void {
    win.on("maximize", () => {
      this.stateNotify("maximized", win);
    });

    win.on("unmaximize", () => {
      this.stateNotify("normal", win);
    });

    win.on("minimize", () => {
      this.stateNotify("minimized", win);
    });

    win.on("restore", () => {
      // restore 可能从最小化或最大化恢复，统一为 normal
      this.stateNotify("normal", win);
    });

    win.on("focus", () => {
      this.stateNotify("focus", win);
    });

    win.on("blur", () => {
      this.stateNotify("blur", win);
    });
  }

  // ── 窗口创建 ─────────────────────────────────────────────────

  private createWindowInstance(): BrowserWindow {
    const win = new BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      titleBarStyle: "hidden",
      transparent: false,
      hasShadow: true,
      resizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        // 关键：关闭无障碍动画抑制
        // enableBlinkFeatures: 'CSSAnimations,CSSTransitions',
        disableBlinkFeatures: 'PrefersReducedMotion',
        preload: this.#preload.path,
      },
    });

    //绑定窗口事件 → notify
    this.attachWindowEvents(win);

    // 防止窗口恢复到不可见区域
    this.ensureWindowVisible(win);

    return win;
  }

  async createWindow(): Promise<BrowserWindow> {
    const browserWindow = this.createWindowInstance();

    if (this.#renderer instanceof URL) {
      await browserWindow.loadURL(this.#renderer.href);
    } else {
      await browserWindow.loadFile(this.#renderer.path);
    }

    browserWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase()

      const ctrlDown = input.control || input.meta;

      // 1. 拦截 Ctrl + W (关闭标签/窗口)
      if (ctrlDown && (key === 'w')) {
        event?.preventDefault()
        notify(browserWindow, "before-input-evt", {
          key,
          ctrlKey: input.control,
          metaKey: input.meta,
          shiftKey: input.shift,
          altKey: input.alt
        })
      }
    })

    return browserWindow;
  }


  // 确保弹出窗口在renderer下显示。只能被Rpc调用。
  async withModalWindow<T>(
    context: Record<string, unknown>,
    fn: (parent: BrowserWindow) => Promise<T>,
  ): Promise<T> {
    const ctx = context as RpcContext;
    const parent = BrowserWindow.fromId(ctx?.project?.wid)
    if (!parent) {
      throw new Error("无法定位当前窗口！")
    }

    if (this.dialogOpenSet.has(parent.id)) {
      throw new Error(`Window ${parent.id} already has a modal dialog open`)
    }
    this.dialogOpenSet.add(parent.id)
    parent.setEnabled(false)

    try {
      return await fn(parent)
    } finally {
      parent.setEnabled(true)
      parent.focus()
      this.dialogOpenSet.delete(parent.id)
    }
  }


  // ── 窗口操作 ─────────────────────────────────────────────────

  ensureWindowVisible(win: BrowserWindow): void {
    const bounds = win.getBounds();
    if (!isVisibleOnAnyDisplay(bounds)) {
      win.center();
    }
  }

  showWindow(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore();
    }

    window.show();

    if (this.#openDevTools) {
      window.webContents.openDevTools();
    }

    window.focus();
  }

  async restoreOrCreateWindow(show = false): Promise<BrowserWindow> {
    // 过滤掉 agent 窗口，只查找普通用户窗口
    let userWindow = BrowserWindow.getAllWindows().find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      w => !w.isDestroyed() && !(w as any).__isAgentWindow
    );

    if (userWindow === undefined) {
      userWindow = await this.createWindow();
    }

    if (show) {
      this.showWindow(userWindow);
    }

    return userWindow;
  }

  // ── 查询当前窗口状态 ─────────────────────────────────────────

  /**
   * 获取指定窗口的当前状态快照
   */
  getWindowState(win: BrowserWindow): WindowEventType {
    if (win.isMinimized()) return "minimized";
    if (win.isMaximized()) return "maximized";
    return "normal";
  }
}
