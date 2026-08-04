// type.ts
export interface IProjectContext {
    readonly path: string;
    readonly wid: number;
    getPath(partName: string | string[], root?: boolean): string;
    notify(evtName: string, payload: unknown, srcId?: number): boolean;
    register<T extends IProjectController>(token: ServiceToken<T>): void;
    getService<T extends IProjectController>(token: ServiceToken<T>): T | null;
}

export interface IProjectController {
    init?(): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

/** 携带稳定 symbol 的构造函数类型 */
export interface ServiceToken<T extends IProjectController = IProjectController> {
    readonly serviceKey: symbol;
    new(context: IProjectContext): T;
}

export type ControllerConstructor<T extends IProjectController = IProjectController> =
    new (context: IProjectContext) => T;

export interface EmbedKVStore {
    get<T>(key: string): T | undefined | null;
    set(key: string, value: unknown): void;
}

export const metaDirName = 'meta';