// prod2adimg/nodes/extract-product-profile/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { Storage } from "../../storage.js";
import { PROFILE_EXTRACTOR_PROMPT } from "./prompts/profile-extractor.js";

export async function extractProductProfile(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: ["product", "productImages", "product_img", ...store.userConfigKeys()],
        outputKeys: store.productProfileKey(),
    })) {
        ctx.info("[extractProductProfile] 产品事实仍新鲜，跳过");
        return;
    }

    const productArr = store.getProductInput();
    if (!productArr.length) {
        throwPrecondition("[extractProductProfile] 缺少产品输入");
    }
    const productRaw = productArr.join("\n");
    const hasImages = (await store.getProductImages()).length > 0;
    const userCtx = store.getUserProductContext();

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: PROFILE_EXTRACTOR_PROMPT.system,
        prompt: PROFILE_EXTRACTOR_PROMPT.user(productRaw, hasImages, userCtx),
    });

    store.saveProductProfile(text);
    ctx.info(`[extractProductProfile] 完成，产品事实 ${text.length} 字${hasImages ? "（有产品图）" : ""}${userCtx ? "（含用户确认信息）" : ""}`);
}