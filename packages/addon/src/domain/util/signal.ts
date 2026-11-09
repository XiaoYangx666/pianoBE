export type EventCallback<T = any> = (data: T) => void;

export class Signal<T = any> {
    private isActive: boolean = true;
    private callbacks: Set<EventCallback<T>> = new Set();

    /**
     * 订阅事件
     * @param callback 回调函数
     * @returns 取消订阅的函数
     */
    subscribe(callback: EventCallback<T>): () => void {
        if (!this.isActive) return () => {};
        this.callbacks.add(callback);

        // 返回取消订阅函数
        return () => this.unsubscribe(callback);
    }

    /**
     * 取消订阅（直接传入回调函数）
     * @param callback 要取消的回调函数
     */
    unsubscribe(callback: EventCallback<T>): void {
        this.callbacks.delete(callback);
    }

    /**
     * 发布事件
     * @param data 传递的数据
     */
    publish(data?: T): void {
        if (!this.isActive) return;
        // 遍历时使用副本，避免回调中修改 callbacks 导致问题
        const callbacks = Array.from(this.callbacks);
        callbacks.forEach((callback) => {
            try {
                callback(data as T);
            } catch (error) {
                console.error(`Error in event handler:`, error);
            }
        });
    }

    /**
     * 清空所有订阅
     */
    clear(): void {
        this.callbacks.clear();
    }

    dispose(): void {
        this.callbacks.clear();
        this.isActive = false;
    }

    /**
     * 获取订阅者数量
     */
    listenerCount(): number {
        return this.callbacks.size;
    }
}
