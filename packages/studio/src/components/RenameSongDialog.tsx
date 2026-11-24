import { useEffect, useState } from "react";
import { MAX_SONG_NAME_CHARS } from "@piano/core";
import { Button, Dialog, Textfield } from "@piano/ui";

export interface RenameSongDialogProps {
    opened: boolean;
    initialName: string;
    title?: string;
    label?: string;
    maxChars?: number;
    onClose: () => void;
    onConfirm: (name: string) => void;
}

export function RenameSongDialog({
    opened,
    initialName,
    title = "重命名曲目",
    label = `名称（最多 ${MAX_SONG_NAME_CHARS} 个字符）`,
    maxChars = MAX_SONG_NAME_CHARS,
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
            setError("名称不能为空");
            return;
        }
        if (Array.from(next).length > maxChars) {
            setError(`最多 ${maxChars} 个字符`);
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
                label={label}
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
