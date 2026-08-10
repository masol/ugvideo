import Logger from "electron-log";

// async function getCountryCode(): Promise<string | null> {
//     try {
//         const url = `http://ip-api.com/json/`;
//         const res = await fetch(url).then(r => r.json());
//         return res.status === 'success' ? res.countryCode as string : null;
//     } catch (error) {
//         Logger.error(`IP 查询失败:${error instanceof Error ? error.message : String(error)}`)
//     }
//     return null;
// }

// 根据所处位置，决定下载服务器的地址。
async function getCountry(): Promise<string | null> {
    try {
        const url = `http://ip.nc.gy/country`;
        const res = await fetch(url).then(r => r.text());
        return res;
    } catch (error) {
        Logger.error(`IP 查询失败:${error instanceof Error ? error.message : String(error)}`)
    }
    return null;
}

async function isChina(): Promise<boolean> {
    const country = await getCountry();
    if (country && country.toLocaleLowerCase() !== "china")
        return false;
    return true;
}

export class IPInfo {
    #inChina: boolean = true;
    #inited: boolean = false;
    get inChina() {
        return this.#inChina;
    }
    get inited() {
        return this.#inited;
    }
    async init(): Promise<void> {
        this.#inChina = await isChina();
        this.#inited = true;
    }
}


const KEY = Symbol.for('unigen.singleton.ip');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ipInfo: IPInfo = ((globalThis as any)[KEY] ??= new IPInfo());