import { useState } from "react";
import { History } from "lucide-react";
import { Button, IconButton } from "@piano/ui";
import { ChangelogModal } from "./ChangelogModal";

export interface ChangelogButtonProps {
    /** 传了文案就渲染成普通按钮，否则是图标按钮 */
    label?: string;
    className?: string;
}

/** 更新日志按钮自带弹窗状态：点开时只重渲染按钮本身，不牵动页面。 */
export function ChangelogButton({ label, className }: ChangelogButtonProps) {
    const [opened, setOpened] = useState(false);
    return (
        <>
            {label ? (
                <Button
                    type="button"
                    color="secondary"
                    size="sm"
                    className={className}
                    onClick={() => setOpened(true)}
                >
                    <History size={14} /> {label}
                </Button>
            ) : (
                <IconButton
                    type="button"
                    aria-label="更新日志"
                    title="更新日志"
                    className={className}
                    onClick={() => setOpened(true)}
                >
                    <History size={15} />
                </IconButton>
            )}
            <ChangelogModal opened={opened} onClose={() => setOpened(false)} />
        </>
    );
}
