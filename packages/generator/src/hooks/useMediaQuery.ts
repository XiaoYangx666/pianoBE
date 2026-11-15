import { useEffect, useState } from "react";

/** 订阅一个媒体查询；SSR 环境下返回 false。 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window === "undefined" ? false : window.matchMedia(query).matches
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mql = window.matchMedia(query);
        const update = () => setMatches(mql.matches);
        update();
        mql.addEventListener("change", update);
        return () => mql.removeEventListener("change", update);
    }, [query]);

    return matches;
}
