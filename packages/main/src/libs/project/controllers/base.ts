import { throwNotfound } from "$libs/utils/err.js";
import type { IProjectContext, IProjectController, ServiceToken } from "../type.js";


/**
 * 统一的项目控制器抽象基类
 */
export abstract class BaseProjectController implements IProjectController {
    constructor(protected readonly ctx: IProjectContext) { }
    init?(): void | Promise<void> { }
    dispose?(): void | Promise<void> { }
    protected static coreEnsure<T extends BaseProjectController>(
        ctor: ServiceToken<T>,
        ctx: IProjectContext
    ): T {
        const instance = ctx.getService(ctor);
        if (!instance) {
            //ctor.name 可能被 minify，用 serviceKey 的描述更可靠
            throwNotfound(`无法获取到 ${ctor.serviceKey.toString()} 对象。`);
        }
        return instance;
    }
}


