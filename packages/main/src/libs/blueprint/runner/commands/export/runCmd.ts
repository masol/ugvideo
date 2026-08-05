import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import { configService } from '$libs/store/index.js';
import { ProjectDbKeys } from '$libs/utils/db/dbkeys.js';
import { throwCancel, throwUnprcessable } from '$libs/utils/err.js';
import { knowledgeCenter } from '$libs/utils/kc.js';
import { WindowService } from '$libs/utils/window.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { dialog } from 'electron';
import fsExtra from 'fs-extra';
import pMap from 'p-map';
import { join } from 'path';
import { collectJobs } from './collect.js';
import { parseFlags } from './flags.js';
import { runJob, type WriteResult } from './write.js';

/** 对外唯一入口：解析目标目录后执行导出 */
export async function runCmd(ctx: IRunnerContext): Promise<void> {
    const args = ctx.cmd.args ?? {};
    const useKc = Boolean(args['kc']);

    let targetPath: string;

    if (useKc) {
        const prjdb = PrjDB.ensure(ctx.prj)
        const type = prjdb.get<string>(ProjectDbKeys.projectType) || 'common';
        targetPath = join(knowledgeCenter.kcPath, type);
        // 确保目录存在
        await fsExtra.ensureDir(targetPath);
    } else {
        const context = { project: ctx.prj };

        const { canceled, filePaths } = await WindowService.instance.withModalWindow(
            context,
            (parent) => {
                return dialog.showOpenDialog(parent, {
                    properties: ['openDirectory', 'createDirectory'],
                });
            },
        );

        if (canceled || !filePaths || filePaths.length === 0) {
            throwCancel('用户取消');
        }

        targetPath = filePaths[0];
        // 确保目录存在
        await fsExtra.ensureDir(targetPath);
    }

    await runExport(ctx, targetPath);
}

async function runExport(ctx: IRunnerContext, targetPath: string): Promise<void> {
    if (!targetPath) throwUnprcessable('targetPath is required');

    const flags = parseFlags(ctx.cmd);
    const prjdb = PrjDB.ensure(ctx.prj);

    ctx.notify('Collecting', 'Building export job list...');
    const jobs = collectJobs(prjdb, targetPath, flags);

    if (jobs.length === 0) {
        ctx.notify('', '**Export complete** — nothing to export (0 items).');
        return;
    }

    let done = 0;
    let codeCount = 0;
    const errors: string[] = [];

    const results = await pMap(
        jobs,
        async (job) => {
            try {
                const res: WriteResult = await runJob(job);
                if (res.codePath) codeCount += 1;
                done += 1;
                if (done % 25 === 0 || done === jobs.length) {
                    ctx.notify('Exporting', `Progress: ${done}/${jobs.length} files written.`);
                }
                return res;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`- \`${job.filePath}\`: ${msg}`);
                return null;
            }
        },
        { concurrency: configService().get("concurrency"), stopOnError: false },
    );

    if (errors.length > 0) {
        ctx.notify(
            'error',
            [
                `## Export failed`,
                ``,
                `${errors.length} of ${jobs.length} items failed:`,
                ``,
                ...errors,
            ].join('\n'),
        );
        throwUnprcessable(`Export failed for ${errors.length} item(s).`);
    }

    const written = results.filter(Boolean).length;
    ctx.notify(
        '',
        [
            `## Export complete`,
            ``,
            `- Files written: **${written}**`,
            `- Capa code files: **${codeCount}**`,
            `- Target: \`${targetPath}\``,
        ].join('\n'),
    );
}