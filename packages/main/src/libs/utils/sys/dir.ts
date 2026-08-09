import { app } from "electron";
import { join } from "node:path";



export function rerankPath(): string {
    const dataPath = app.getPath("userData");
    return join(dataPath, "models", "rerank")
}


export function embedingPath(): string {
    const dataPath = app.getPath("userData");
    return join(dataPath, "models", "embeding")
}


export function capFile(fname?: string | string[]): string {
    const dataPath = app.getPath("userData");
    if (fname && fname.length > 0) {
        const parts = Array.isArray(fname) ? fname : [fname]
        return join(dataPath, "cap", ...parts)
    }
    return join(dataPath, "cap");
}



export function themeFile(fname?: string): string {
    const dataPath = app.getPath("userData");
    if (fname && fname.length > 0) {
        return join(dataPath, "theme", fname)
    }
    return join(dataPath, "theme");
}

export function dataFile(fname?: string): string {
    const dataPath = app.getPath("userData");
    if (fname && fname.length > 0) {
        return join(dataPath, "theme", fname)
    }
    return join(dataPath, "theme");
}