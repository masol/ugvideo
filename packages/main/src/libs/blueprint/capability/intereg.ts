import { getInternalName } from "$libs/blueprint/capability/is.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { Capability } from "$types/blueprint/capability.js";
import type { BaseFunctor } from "./base.js";
import { ICapaFunctor } from "./type.js";


class InterReg {
    // name to InterBase
    #namemap: Map<string, BaseFunctor> = new Map();
    // id to InterBase
    #idmap: Map<string, BaseFunctor> = new Map();

    constructor() {
    }

    init() { }

    has(name: string): boolean {
        return this.#namemap.has(name);
    }

    hasId(id: string): boolean {
        return this.#idmap.has(id);
    }

    // 通过名称获取capa的id.
    idByName(name: string): string | null {
        const capa = this.#namemap.get(name);
        return capa?.capa.id ?? null;
    }

    // 通过id获取capa。
    capaById(id: string): Capability | null {
        const ret = this.#idmap.get(id);
        return ret ? ret.capa : null;
    }

    get(name: string): ICapaFunctor | null {
        const ret = this.#namemap.get(name);
        return ret ? ret : null;
    }

    rm(name: string): void {
        const capa = this.#namemap.get(name);
        if (capa) {
            this.#namemap.delete(name);
            if (capa.capa.id) {
                this.#idmap.delete(capa.capa.id);
            }
        }
    }

    rmById(id: string): void {
        const capa = this.#idmap.get(id);
        if (capa) {
            this.#idmap.delete(id);
            const interName = getInternalName(capa.capa.name);
            if (interName) {
                this.#namemap.delete(interName);
            }
        }
    }

    // 强制全体从InterBase派生 -- inter也需要响应Input/output结构的动态变化。
    reg(functor: BaseFunctor): void {
        const interName = getInternalName(functor.capa.name);
        const id = functor.capa.id;

        // console.log("functor.capa=", functor.capa)

        if (!interName || !id) {
            throwPrecondition(`capa id or name is empty, cannot register intereg: ${JSON.stringify(functor.capa)}`);
        }

        // 1. 如果有同名的旧数据，通过 rm 方法把它的 name 和 id 彻底从两个 Map 中抹去
        if (this.has(interName)) {
            this.rm(interName);
        }

        // 2. 如果有同 ID 的旧数据（比如名字改了但 ID 没变），通过 rmById 彻底抹去
        if (this.hasId(id)) {
            this.rmById(id);
        }

        // 3. 此时两边都已经是一张白纸，安全写入新引用的指针
        this.#namemap.set(interName, functor);
        this.#idmap.set(id, functor);
    }
}

const KEY = Symbol.for('unigen.singleton.intereg');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const intereg: InterReg = ((globalThis as any)[KEY] ??= new InterReg());
