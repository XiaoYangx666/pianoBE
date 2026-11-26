export async function loadAddonTemplate(): Promise<never> {
    throw new Error("服务器管理版不在浏览器端装配附加包");
}

export function resolvePluginDependencies() {
    return {
        resolvedIds: [],
        missingDependencies: [],
        untrustedDependencies: [],
    };
}
