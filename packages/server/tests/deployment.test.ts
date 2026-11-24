import { expect, test } from "bun:test";
import { DeploymentService } from "../src/services/deployment";

function manifest(uuid: string, depUuid: string, version = "1.3.0") {
    return {
        format_version: 3,
        header: { uuid, version },
        modules: [],
        dependencies: [{ uuid: depUuid, version }],
    };
}

test("部署版本递增，BP/RP 依赖版本双向同步", () => {
    const state = new Map<string, string>();
    const songPort = {
        getState: (key: string) => state.get(key),
        setState: (key: string, value: string) => {
            state.set(key, value);
        },
    };
    const service = new DeploymentService(
        songPort as never,
        {} as never,
        {} as never
    );
    const bump = (
        service as unknown as {
            bumpPackVersions: (
                bp: Map<string, Uint8Array>,
                rp: Map<string, Uint8Array>
            ) => void;
        }
    ).bumpPackVersions.bind(service);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const makeFiles = () =>
        [
            new Map([
                [
                    "manifest.json",
                    encoder.encode(JSON.stringify(manifest("bp-uuid", "rp-uuid"))),
                ],
            ]),
            new Map([
                [
                    "manifest.json",
                    encoder.encode(JSON.stringify(manifest("rp-uuid", "bp-uuid"))),
                ],
            ]),
        ] as const;

    let [bpFiles, rpFiles] = makeFiles();
    bump(bpFiles, rpFiles);

    const bp = JSON.parse(decoder.decode(bpFiles.get("manifest.json")!));
    const rp = JSON.parse(decoder.decode(rpFiles.get("manifest.json")!));
    expect(bp.header.version).toBe("1.3.1");
    expect(rp.header.version).toBe("1.3.1");
    expect(bp.dependencies[0].version).toBe("1.3.1");
    expect(rp.dependencies[0].version).toBe("1.3.1");
    expect(state.get("deploy_seq")).toBe("1");

    // 第二次部署从模板的 1.3.0 重新生成，序号继续累计
    [bpFiles, rpFiles] = makeFiles();
    bump(bpFiles, rpFiles);
    const bp2 = JSON.parse(decoder.decode(bpFiles.get("manifest.json")!));
    expect(bp2.header.version).toBe("1.3.2");
    expect(state.get("deploy_seq")).toBe("2");
});
