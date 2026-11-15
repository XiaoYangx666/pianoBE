import { memo, useEffect, useRef, useState, type ReactNode } from "react";

export interface VirtualSongListProps<T> {
    items: T[];
    /** 单行高度（px，不含 gap），必须与行组件高度一致 */
    rowHeight: number;
    gap?: number;
    overscan?: number;
    empty?: ReactNode;
    /** 需保持引用稳定（useCallback），否则滚动时每行都会重渲染 */
    renderItem: (item: T, index: number) => ReactNode;
    getKey?: (item: T, index: number) => string | number;
    className?: string;
}

interface RowProps<T> {
    item: T;
    index: number;
    top: number;
    height: number;
    renderItem: (item: T, index: number) => ReactNode;
}

function RowInner<T>({ item, index, top, height, renderItem }: RowProps<T>) {
    return (
        <div className="absolute inset-x-0" style={{ top, height }}>
            {renderItem(item, index)}
        </div>
    );
}

const Row = memo(RowInner) as typeof RowInner;

/** 定高行虚拟列表：自身即滚动容器，需要外层给出确定高度（flex 子项需 min-h-0） */
export function VirtualSongList<T>({
    items,
    rowHeight,
    gap = 2,
    overscan = 4,
    empty,
    renderItem,
    getKey,
    className,
}: VirtualSongListProps<T>) {
    const ref = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setViewportHeight(el.clientHeight);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const step = rowHeight + gap;
    const totalHeight = items.length > 0 ? items.length * step - gap : 0;
    const start = Math.max(0, Math.floor(scrollTop / step) - overscan);
    const count = Math.ceil(viewportHeight / step) + overscan * 2 + 1;
    const end = Math.min(items.length, start + count);

    const rows: ReactNode[] = [];
    for (let index = start; index < end; index++) {
        const item = items[index];
        rows.push(
            <Row
                key={getKey ? getKey(item, index) : index}
                item={item}
                index={index}
                top={index * step}
                height={rowHeight}
                renderItem={renderItem}
            />
        );
    }

    return (
        <div
            ref={ref}
            className={`relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain ${className ?? ""}`}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
            {items.length === 0 ? (
                empty
            ) : (
                <div className="relative w-full" style={{ height: totalHeight }}>
                    {rows}
                </div>
            )}
        </div>
    );
}
