import { throwNotimplement } from "$libs/utils/err.js";
import { dataCenter } from "$libs/utils/sys/data.js";
import Logger from "electron-log/main.js";
import { sep } from "node:path";
import { getErrorMessage } from "radashi";
import { fillCapa } from "./base.js";
import { VmCapaFunctor } from "./code/index.js";
import { Capability } from "./is.js";
import { ICapaFunctor } from "./type.js";

// 文件能力放在目录
export async function loadFileCapa(...filepath: string[]): Promise<ICapaFunctor | null> {
    const nativeFullpath = filepath.join(sep)
    try {
        const code = await dataCenter.readFile('cap', ...filepath);
        if (!code) {
            throwNotimplement(`文件${nativeFullpath}没有提供任意代码。`)
        }

        const capa: Capability = fillCapa({
            name: `#code::${nativeFullpath}`,
            code
        })
        return new VmCapaFunctor(capa);
    } catch (e) {
        Logger.error(`从文件${nativeFullpath}中加载能力失败：${getErrorMessage(e)}`)
    }
    return null;
}
