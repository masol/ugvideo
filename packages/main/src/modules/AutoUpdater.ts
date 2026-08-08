import { configService } from '$libs/store/index.js';
import log from 'electron-log/main.js';
import electronUpdater, { type AppUpdater, type Logger } from 'electron-updater';
import { AppModule } from '../AppModule.js';

type DownloadNotification = Parameters<AppUpdater['checkForUpdatesAndNotify']>[0];

export class AutoUpdater implements AppModule {
  readonly #logger: Logger | null;
  readonly #notification: DownloadNotification;

  constructor(
    {
      downloadNotification = undefined,
    }: {
      downloadNotification?: DownloadNotification;
    } = {},
  ) {
    this.#logger = log;
    this.#notification = downloadNotification;
  }

  enable(): void {
    if (configService().get("autoupdate")) {
      this.runAutoUpdater();
    }
  }

  getAutoUpdater(): AppUpdater {
    const { autoUpdater } = electronUpdater;
    return autoUpdater;
  }

  runAutoUpdater() {
    const updater = this.getAutoUpdater();

    // 硬编码 GitHub 仓库信息
    updater.setFeedURL({
      provider: 'github',
      owner: 'masol',
      repo: 'unigen',
      // token: process.env.GH_TOKEN,  // 可选
    });

    updater.logger = this.#logger || null;
    updater.fullChangelog = true;

    // 如果需要多通道，可以取消注释并硬编码或设默认值
    // updater.channel = 'latest';

    updater.checkForUpdatesAndNotify(this.#notification).catch((error) => {
      if (error instanceof Error && error.message.includes('No published versions')) {
        return null;
      }
      log.error('[AutoUpdater] 后台更新检查失败:', error);
    });
  }
}

export function autoUpdater(...args: ConstructorParameters<typeof AutoUpdater>) {
  return new AutoUpdater(...args);
}