export async function readAddonArchive(): Promise<never> {
    throw new Error("服务器管理版不支持在浏览器端读取 .mcaddon 归档");
}
