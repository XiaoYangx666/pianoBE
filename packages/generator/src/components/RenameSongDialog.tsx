import { useEffect, useState } from "react";
import { MAX_SONG_NAME_CHARS } from "@piano/core";
import { Button, Dialog, Textfield } from "@piano/ui";

export interface RenameSongDialogProps {
    opened: boolean;
    initialName: string;
    title?: string;
    onClose: () => void;
    onConfirm: (name: string) => void;
}

/** 曲目改名弹窗：只做输入与长度校验，实际写入由调用方的 store 动作负责。 */
export function RenameSongDialog({
    opened,
    initialName,
    title = "重命名曲目",
    onClose,
    onConfirm,
}: RenameSongDialogProps) {
    const [value, setValue] = useState(initialName);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!opened) return;
        setValue(initialName);
        setError("");
    }, [opened, initialName]);

    const submit = () => {
        const next = value.trim();
        if (!next) {
            setError("曲名不能为空");
            return;
        }
        if (Array.from(next).length > MAX_SONG_NAME_CHARS) {
            setError(`曲名最多 ${MAX_SONG_NAME_CHARS} 个字符`);
            return;
        }
        onConfirm(next);
        onClose();
    };

    return (
        <Dialog
            opened={opened}
            onClose={onClose}
            title={title}
            size="sm"
            footer={
                <>
                    <Button type="button" color="secondary" size="sm" onClick={onClose}>
                        取消
                    </Button>
                    <Button type="button" size="sm" onClick={submit}>
                        保存
                    </Button>
                </>
            }
        >
            <Textfield
                label={`曲名（最多 ${MAX_SONG_NAME_CHARS} 个字符）`}
                value={value}
                error={error || ""}
                autoFocus
                onInput={(event) => {
                    const target = event.target as unknown as { value?: unknown };
                    if (typeof target?.value === "string") {
                        setValue(target.value);
                        setError("");
                    }
                }}
                onKeyDown={(event: React.KeyboardEvent) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                    }
                }}
            />
        </Dialog>
    );
}
