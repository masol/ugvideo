export function parseTimeout(raw: string): number | null {
    const trimmed = raw.trim();

    // 处理 ISO 8601 (PT1H, P1D, 等)
    const isoMatch = trimmed.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (isoMatch) {
        const [, years, months, days, hours, minutes, seconds] = isoMatch.map(v => parseInt(v || '0', 10));
        const ms =
            years * 365 * 24 * 60 * 60 * 1000 +
            months * 30 * 24 * 60 * 60 * 1000 +
            days * 24 * 60 * 60 * 1000 +
            hours * 60 * 60 * 1000 +
            minutes * 60 * 1000 +
            seconds * 1000;
        if (ms > 0) return ms;
    }

    // 处理简写 (1h, 30m, 2d, 1.5M)
    const shortMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhdwMy]?)$/);
    if (shortMatch) {
        const amount = parseFloat(shortMatch[1]);
        const unit = shortMatch[2] || '';

        const unitMap: Record<string, number> = {
            's': 1000,
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
            'w': 7 * 24 * 60 * 60 * 1000,
            'M': 30 * 24 * 60 * 60 * 1000,
            'y': 365 * 24 * 60 * 60 * 1000,
        };

        if (unit === '') {
            // 纯数字
            const num = parseFloat(trimmed);
            if (num > 0) return num;
        } else {
            const factor = unitMap[unit];
            if (factor) {
                const ms = amount * factor;
                if (ms > 0) return ms;
            }
        }
    }

    // 最后尝试数字
    const num = parseFloat(trimmed);
    if (num > 0) return num;

    return null;
}