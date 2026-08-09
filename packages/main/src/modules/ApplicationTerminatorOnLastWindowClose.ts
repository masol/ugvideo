import { isAgentWindow } from '$libs/utils/puppeteer/index.js';
import { BrowserWindow } from 'electron';
import { AppModule } from '../AppModule.js';
import { ModuleContext } from '../types/ModuleContext.js';

class ApplicationTerminatorOnLastWindowClose implements AppModule {
  enable({ app }: ModuleContext): void {
    // 唯一真相源就是 getAllWindows()。
    // 任一窗口关闭后，统计剩余的非 agent 窗口；归零则退出。
    const quitIfNoUserWindows = () => {
      const userWindowsRemaining = BrowserWindow.getAllWindows().filter(
        (w) => !w.isDestroyed() && !isAgentWindow(w)
      );
      if (userWindowsRemaining.length === 0) {
        app.quit();
      }
    };

    app.on('browser-window-created', (_, win) => {
      win.once('closed', quitIfNoUserWindows);
    });
  }
}

export function terminateAppOnLastWindowClose(...args: ConstructorParameters<typeof ApplicationTerminatorOnLastWindowClose>) {
  return new ApplicationTerminatorOnLastWindowClose(...args);
}