import { KeyMapInfo } from "@piano/types";
import { defaultKeyMap } from "./default";
import { noBlack } from "./noBlack";

export const keyMaps: KeyMapInfo[] = [
    { name: "黑键方案(默认)", value: defaultKeyMap },
    { name: "不带黑键方案", value: noBlack },
];
