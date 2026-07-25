import { appLife } from '$libs/utils/tapable/applife.js';
import { createModuleRunner } from './ModuleRunner.js';
import { terminateAppOnLastWindowClose } from './modules/ApplicationTerminatorOnLastWindowClose.js';
import { autoUpdater } from './modules/AutoUpdater.js';
import { allowInternalOrigins } from './modules/BlockNotAllowdOrigins.js';
import { allowExternalUrls } from './modules/ExternalUrls.js';
import { hardwareAccelerationMode } from './modules/HardwareAccelerationModule.js';
import { loggerModule } from './modules/LoggerModule.js';
import { orpcModule } from './modules/OrpcModule.js';
import { protocalModule, registerSchemes } from './modules/ProtocalModule.js';
import { disallowMultipleAppInstance } from './modules/SingleInstanceApp.js';
import { unigenModule } from './modules/UnigenModule.js';
import { createWindowManagerModule } from './modules/WindowManager.js';
import type { AppInitConfig } from './types/AppInitConfig.js';

export async function initApp(initConfig: AppInitConfig) {
  try {
    registerSchemes();

    const moduleRunner = createModuleRunner()
      .init(disallowMultipleAppInstance())
      .init(loggerModule())
      .init(orpcModule())
      .init(protocalModule())
      .init(hardwareAccelerationMode())
      .init(createWindowManagerModule({ initConfig, openDevTools: import.meta.env.DEV }))
      .init(terminateAppOnLastWindowClose())
      .init(autoUpdater())
      // Install DevTools extension if needed
      // .init(chromeDevToolsExtension({extension: 'VUEJS3_DEVTOOLS'}))
      // Security
      .init(allowInternalOrigins(
        new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
      ))
      .init(allowExternalUrls(
        new Set(
          initConfig.renderer instanceof URL
            ? [
              'https://lizt.top',
              'https://unigen.cc',
              'https://www.lizt.top',
              'https://www.unigen.cc',
            ]
            : [],
        ))
      )
      .init(unigenModule());

    await moduleRunner;
  } finally {
    appLife.bootstrapped.resolve();
  }
}
