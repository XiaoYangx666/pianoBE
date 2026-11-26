const unsupported = (): never => {
    throw new Error("服务器管理版不包含本地工作区功能");
};

export const migrateLegacyGeneratorIfNeeded = async () => {};
export const archiveToStudioPlugin = () => unsupported();
export const loadBuiltinPluginIndex = async () => [];
export const fetchBuiltinPluginBytes = async () => unsupported();
export const loadDefaultTemplate = async () => unsupported();
export const loadLocalState = async () => ({
    songs: [],
    libraries: [],
    plugins: [],
});
export const saveLocalSongsBulk = async () => unsupported();
export const saveLocalSongBytes = async () => unsupported();
export const renameLocalSong = async () => unsupported();
export const deleteLocalSong = async () => unsupported();
export const saveLocalLibrary = async () => unsupported();
export const deleteLocalLibrary = async () => unsupported();
export const addSongsToLocalLibrary = async () => unsupported();
export const removeSongFromLocalLibrary = async () => unsupported();
export const clearLocalLibrary = async () => 0;
export const saveLocalPerformance = async () => unsupported();
export const deleteLocalPerformance = async () => false;
export const installLocalPluginBytes = async () => unsupported();
export const trustLocalPlugin = async () => unsupported();
export const setLocalPluginEnabled = async () => unsupported();
export const uninstallLocalPlugin = async () => unsupported();
export const exportLocalLibraryPlugin = () => unsupported();
export const exportLocalAddon = async () => unsupported();
export const importScoresFromArchiveFile = async () => unsupported();
export const computeLocalSongPluginMatch = () => ({
    requiredEffects: [],
    requiredPluginIds: [],
    missingEffects: [],
    disabledRequiredEffects: [],
});
export const getLocalImportCode = () => unsupported();
