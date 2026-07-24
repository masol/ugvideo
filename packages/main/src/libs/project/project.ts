// 轻量DI容器，未使用轻量DI框架(如awilix)，因为其还是太重，本DI不涉及外部扩展代码的问题。

import { secondConfig } from "$libs/store/second.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import { notify } from "$libs/utils/rpcevt.js";
import type { ProjectActivityData } from "$types/index.js";
import { projectActivityDataSchema } from "$types/shared/template/project.js";
import { BrowserWindow } from "electron";
import Logger from "electron-log/main.js";
import fsExtra from 'fs-extra';
import { join } from "node:path";
import { z } from "zod";
import { closeProject, createProject, openProject } from "./helper/create.js";
import type { IProjectPlugin } from "./plugin.js";
import { registProjectBuildin } from "./register.js";
import { type IProjectContext, type IProjectController, metaDirName, ServiceToken } from "./type.js";

export class ProjectContainer implements IProjectContext {
    // 项目根目录。
    #path = "";
    #plugin: IProjectPlugin | null = null; // plugin type.
    #wid = -1;
    #prjId = -1; // used for ProjectMananger(not for controller).

    // 在构造容器时初始化全部IProjectController(某个具体的剖面)
    constructor(wid: number, prjId: number) {
        this.#wid = wid;
        this.#prjId = prjId;
        registProjectBuildin(this);
    }

    // async init(projectPath: string): Promise<void> {
    //     this.#path = projectPath;
    // }

    notify(evtName: string, payload: unknown, srcId = -1): boolean {
        const win: BrowserWindow | null = BrowserWindow.fromId(this.#wid);

        if (win && !win.isDestroyed()) {
            notify(win, evtName, payload, srcId);
            return true;
        }
        return false;
    }

    get prjId(): number {
        return this.#prjId;
    }
    get path() {
        return this.#path;
    }
    get wid() {
        return this.#wid;
    }

    // 1. 严格限制 Map 的键只能是符合约束的构造函数，值是对应的实例
    private registry = new Map<symbol, IProjectController>();

    /**
     * 注册控制器类
     */
    register<T extends IProjectController>(token: ServiceToken<T>): void {
        const instance = new token(this);
        this.registry.set(token.serviceKey, instance);
    }

    getService<T extends IProjectController>(token: ServiceToken<T>): T | null {
        const instance = this.registry.get(token.serviceKey);
        return instance ? (instance as T) : null;
    }

    getPath(partName: string | string[]): string {
        switch (partName) {
            case 'meta': // 项目
                return metaDirName;
            // case 'visualref': // 项目参考图。@todo: video专有，应该使用tapable(hookable)将其改为插件实现！
            //     return join(this.#path, metaDirName, 'visualref');
        }
        if (Array.isArray(partName)) {
            return join(this.#path, metaDirName, ...partName);
        }
        return join(this.#path, metaDirName, partName);
    }


    private validatePrjData(file: string, type: unknown): ProjectActivityData {
        const result = projectActivityDataSchema.safeParse(type);
        if (result.success) {
            return type as ProjectActivityData;
        }
        const formattedErrors = z.prettifyError(result.error);
        const msg = `项目UI文件${file}加载失败，详情查看日志。`
        Logger.error(msg, formattedErrors);
        throwUnprcessable(msg)
    }

    async loadUI(): Promise<ProjectActivityData> {
        const uiFile = this.getPath("type.json");
        const uiJSOn = await fsExtra.readJSON(uiFile);
        const prjdata = this.validatePrjData(uiFile, uiJSOn);
        return prjdata;
    }

    // 创建失败，返回错误信息。成功返回空字符串。
    async open(path: string): Promise<ProjectActivityData> {
        try {
            await this.close();
            this.#path = path;
            const prjdata = await this.loadUI();
            // if (meta && meta.type) {
            //     // 提前加载插件，才能注册tapable事件响应点。
            //     this.#plugin = await pluginManager.load(configService().get("plugin"), this)
            // }

            await openProject(this, prjdata.icon);
            return prjdata
        } catch (e) {
            secondConfig().removeProject(path)
            this.#path = "";
            throw e;
        }
    }

    // private async saveMeta(type: string): Promise<void> {
    //     return await fsExtra.writeJSON(this.getPath('meta.json'), { type })
    // }

    async create(path: string, type: string, bForce = false): Promise<ProjectActivityData> {
        try {
            await this.close();
            this.#path = path;
            // 提前加载插件，才能注册tapable事件响应点。支持无插件运行。
            // this.#plugin = await pluginManager.load(type, this)
            const typePath = await knowledgeCenter.getFile(type, "type.json");
            if (!typePath) {
                throwUnprcessable(`请求的类型${type}未提供UI界面定义。`)
            }
            const typejson = await fsExtra.readJSON(typePath, "utf-8");
            const prjdata = this.validatePrjData(typePath, typejson);
            await createProject(this, type, prjdata.icon, bForce);
            await Promise.all([
                // this.saveMeta(type),
                fsExtra.copyFile(typePath, this.getPath("type.json"))
            ])
            // Logger.debug(`copy from ${typePath} to ${this.getPath("type.json")}`)
            return prjdata;
        } catch (e) {
            this.#path = "";
            throw e;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.#plugin) {
                await this.#plugin.dispose();
                this.#plugin = null;
            }
            await closeProject(this);
        } finally {
            this.#path = ""
        }
    }
}