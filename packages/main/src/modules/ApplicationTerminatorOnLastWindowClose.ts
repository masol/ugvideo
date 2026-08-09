import { BrowserWindow } from 'electron';
import { AppModule } from '../AppModule.js';
import { ModuleContext } from '../types/ModuleContext.js';

class ApplicationTerminatorOnLastWindowClose implements AppModule {
  enable({ app }: ModuleContext): void {
    const userWindows = new Set<number>();

    const onWindowCreated = (win: BrowserWindow) => {
      // 判断是否为 agent 窗口：依据窗口的特定属性或全局标识
      // 这里假设 agent 窗口有一个 isAgent 属性
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((win as any).__isAgentWindow) return;
        console.log("add win")

      userWindows.add(win.id);
      win.once('closed', () => {
        userWindows.delete(win.id);
        if (userWindows.size === 0) {
          app.quit();
        }
      });
    };

    app.on('browser-window-created', (_, win) => onWindowCreated(win));

    // 注册已经存在的窗口（可能在此模块加载前就已创建）
    BrowserWindow.getAllWindows().forEach(onWindowCreated);
  }
}


export function terminateAppOnLastWindowClose(...args: ConstructorParameters<typeof ApplicationTerminatorOnLastWindowClose>) {
  return new ApplicationTerminatorOnLastWindowClose(...args);
}
