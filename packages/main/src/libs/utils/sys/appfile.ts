import { pathToFileURL } from "url";


export const PROTOCAL_NAME = 'appfile';



export function path2URL(path: string) {
    const fileUrl = pathToFileURL(path).href;
    return fileUrl.replace(/^file:/, `${PROTOCAL_NAME}:`);
}