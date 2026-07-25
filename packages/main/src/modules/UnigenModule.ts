import { intereg } from '$libs/blueprint/index.js';
import { configService } from '$libs/store/index.js';
import { initGlobalToolDB } from '$libs/tooldb/bootstrap.js';
import { broadcast } from '$libs/utils/rpcevt.js';
import { themeFile } from '$libs/utils/sys/dir.js';
import { telemetryService } from '$libs/utils/telemetry/telemetry.service.js';
import { nativeTheme } from 'electron';
import { ensureDir } from 'fs-extra';
import type { AppModule } from '../AppModule.js';
import { ModuleContext } from '../types/ModuleContext.js';

class UnigenModule implements AppModule {
    async enable({ app }: ModuleContext): Promise<void> {
        const tooldbPromise = initGlobalToolDB();
        await app.whenReady()
        intereg.init();
        nativeTheme.themeSource = 'system'

        nativeTheme.on('updated', () => {
            broadcast({
                name: "sys:usedark",
                srcId: -1,
                payload: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
            })
        })

        await Promise.all([
            ensureDir(themeFile()),
            telemetryService.initialize(configService().get("telemetry")),
            tooldbPromise
        ]);
        configService().oTel = telemetryService;
    }
}

export function unigenModule(...args: ConstructorParameters<typeof UnigenModule>) {
    return new UnigenModule(...args);
}