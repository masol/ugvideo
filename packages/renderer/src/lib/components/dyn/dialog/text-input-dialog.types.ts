export type TextInputDialogProps = {
    title?: string;
    description?: string;
    placeholder?: string;
    initialText?: string;
    alert?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    rows?: number;
    requireNonEmpty?: boolean;
    /**
     * 可选预设片段列表（字符串数组）。传入且非空时显示"插入片段"下拉。
     * - 数组中每一项的**完整原始字符串**即为选中后插入到输入框的内容；
     * - UI 展示时会用 CSS 省略号截断以保持布局整齐，悬停 title 显示完整值；
     * - 截断只是视觉表现，与插入内容始终一致。
     */
    options?: string[];
};