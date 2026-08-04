export type MediaKind = "image" | "video" | "unknown";

export interface ViewerToolbarProps {
    src: string;
    kind: MediaKind;
}