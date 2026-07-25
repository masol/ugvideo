import { configService } from "$libs/store/index.js";
import { secondConfig } from "$libs/store/second.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import { isDirEmpty } from "$libs/utils/sys/fs.js";
import { COMMON_ORPC_ERROR_DEFS } from "@orpc/client";
import { ORPCError } from "@orpc/server";
import Logger from "electron-log/main.js";
import { emptyDir } from "fs-extra";
import { ProjectDbKeys } from "../../utils/db/dbkeys.js";
import { PrjDB } from "../controllers/drizzle/index.js";
import { LanceDB } from "../controllers/lance/index.js";
import { IProjectContext } from "../type.js";


export async function openProject(prj: IProjectContext, icon: string): Promise<void> {
    Logger.debug(`[Project] open ${prj.path}`)
    const pdb = PrjDB.ensure(prj);
    try {
        await pdb.open(false);
        const lance = LanceDB.ensure(prj);
        await lance.open();

        secondConfig().addProject(prj.path, (new Date()).getTime(), icon)
    } catch (e) {
        // 异常路径：强制关闭数据库，释放文件锁，避免目录被锁死
        pdb.forceClose();
        throw e;
    }
}

export async function closeProject(prj: IProjectContext): Promise<void> {
    if (!prj.path) {
        return;
    }
    Logger.debug(`[Project] close ${prj.path}`)
    const pdb = PrjDB.ensure(prj);
    pdb.close();
    const lance = LanceDB.ensure(prj);
    lance.close();
}


export async function createProject(prj: IProjectContext, type: string, icon: string, bForce = false): Promise<boolean> {
    Logger.debug(`[Project] open ${prj.path}`)

    const isEmpty = await isDirEmpty(prj.path);
    if (!isEmpty) {
        if (bForce) {
            await emptyDir(prj.path)
        } else {
            throw new ORPCError(COMMON_ORPC_ERROR_DEFS.UNSUPPORTED_MEDIA_TYPE.message, {
                status: COMMON_ORPC_ERROR_DEFS.UNSUPPORTED_MEDIA_TYPE.status,
                message: prj.path
            })
        }
    }

    const pdb = PrjDB.ensure(prj);
    try {
        await pdb.open(true);
        pdb.set(ProjectDbKeys.version, __APP_VERSION__);
        pdb.set(ProjectDbKeys.projectType, type)
        const embed = configService().get("embed_model");
        if (embed) {
            pdb.set("embed", configService().get("embed_model"));
            const lance = LanceDB.ensure(prj);
            await lance.open();
        }

        await knowledgeCenter.initProject(prj, type);
    } catch (e) {
        // 异常路径：强制关闭数据库并清理目录，让用户可以重试
        pdb.forceClose();
        try {
            await emptyDir(prj.path);
        } catch (cleanupErr) {
            Logger.error('[Project] 创建失败后清理目录时出错:', cleanupErr);
        }
        throw e;
    }

    secondConfig().addProject(prj.path, (new Date()).getTime(), icon)
    return true
}