import type { ReactNode } from "react";
import { Button } from "../primitives";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
    opened: boolean;
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 危险操作使用红色按钮 */
    danger?: boolean;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/** 二次确认弹窗：替代原先的 modals.openConfirmModal。 */
export function ConfirmDialog({
    opened,
    title,
    description,
    confirmLabel = "确定",
    cancelLabel = "取消",
    danger,
    loading,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    return (
        <Dialog
            opened={opened}
            onClose={onCancel}
            title={title}
            size="sm"
            footer={
                <>
                    <Button type="button" color="secondary" size="sm" onClick={onCancel}>
                        {cancelLabel}
                    </Button>
                    <Button
                        type="button"
                        color={danger ? "destructive" : "primary"}
                        size="sm"
                        loading={loading}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            <div className="text-[13px] leading-relaxed text-ore-dim">{description}</div>
        </Dialog>
    );
}
