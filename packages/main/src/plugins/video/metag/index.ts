import { NewMetagRow } from "$libs/blueprint/metag/is.js";
import { z } from "zod";
import { ParaItemSchema, ScriptItemSchema } from "./script.js";

export const videoMetags: NewMetagRow[] = [
    {
        fieldKey: "script", intent: "最原始输入的剧本数组",
        schema: z.array(ScriptItemSchema)
    },
    {
        fieldKey: "paragraph", intent: "给剧本原文按行划分，并带上总行号。",
        schema: z.array(ParaItemSchema)
    }
];