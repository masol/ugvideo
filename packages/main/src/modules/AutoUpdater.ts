// import { getCountryCode } from '$libs/utils/sys/ip.js';
// import eLogger from 'electron-log/main';
import log from 'electron-log/main.js';
import electronUpdater, { type AppUpdater, type Logger } from 'electron-updater';
import { AppModule } from '../AppModule.js';

type DownloadNotification = Parameters<AppUpdater['checkForUpdatesAndNotify']>[0];

export class AutoUpdater implements AppModule {

  readonly #logger: Logger | null;
  readonly #notification: DownloadNotification;

  constructor(
    {
      logger = null,
      downloadNotification = undefined,
    }:
      {
        logger?: Logger | null | undefined,
        downloadNotification?: DownloadNotification
      } = {},
  ) {
    this.#logger = logger;
    this.#notification = downloadNotification;
  }

  enable(): void {
    // const code = await getCountryCode();
    this.runAutoUpdater();
  }

  getAutoUpdater(): AppUpdater {
    // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
    // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
    const { autoUpdater } = electronUpdater;
    return autoUpdater;
  }

  runAutoUpdater() {
    const updater = this.getAutoUpdater();
    updater.logger = this.#logger || null;
    updater.fullChangelog = true;

    if (import.meta.env.VITE_DISTRIBUTION_CHANNEL) {
      updater.channel = import.meta.env.VITE_DISTRIBUTION_CHANNEL;
    }

    updater.checkForUpdatesAndNotify(this.#notification).catch((error) => {
      if (error instanceof Error && error.message.includes('No published versions')) {
        return null;
      }
      // 后台任务失败只记日志，不要 throw（否则变成 unhandled rejection）
      log.error('[AutoUpdater] 后台更新检查失败:', error);
    });
  }
}


export function autoUpdater(...args: ConstructorParameters<typeof AutoUpdater>) {
  return new AutoUpdater(...args);
}
