import * as THREE from "three";

const contour = [
    [-4.90, -5.80], [-4.90, 1.62], [-3.52, 3.16], [3.52, 3.16],
    [4.90, 1.62], [4.90, -5.80], [3.65, -7.07], [-3.65, -7.07],
] as const;

/** A neutral rehearsal set shared by all presets and comparison frames. */
export function createDeck() {
    const deck = new THREE.Group();
    const surface = new THREE.MeshStandardMaterial({ color: 0x20283a, metalness: 0.25, roughness: 0.63 });
    const fascia = new THREE.MeshStandardMaterial({ color: 0x111725, metalness: 0.43, roughness: 0.55 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x4c5f7e, metalness: 0.45, roughness: 0.57 });
    const undercut = new THREE.MeshBasicMaterial({ color: 0x343e57 });

    function platform(scale: number, y: number, depth: number) {
        const shape = new THREE.Shape(contour.map(([x, z]) => new THREE.Vector2(x * scale, -z * scale)));
        const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.018,
            bevelThickness: 0.018, bevelSegments: 1, steps: 1 });
        const mesh = new THREE.Mesh(geometry, [surface, fascia]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        mesh.receiveShadow = true;
        deck.add(mesh);
    }
    platform(1.025, -0.50, 0.17);
    platform(1, -0.33, 0.30);

    for (const [index, [x, z]] of contour.entries()) {
        const [nextX, nextZ] = contour[(index + 1) % contour.length];
        const span = Math.hypot(nextX - x, nextZ - z);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(span - 0.10, 0.012, 0.028), edge);
        trim.rotation.y = -Math.atan2(nextZ - z, nextX - x);
        trim.position.set((x + nextX) * 0.485, -0.010, (z + nextZ) * 0.485);
        trim.scale.x *= 0.97;
        deck.add(trim);
        if (index >= 1 && index <= 3) {
            const slit = new THREE.Mesh(new THREE.BoxGeometry(span * 0.77, 0.019, 0.022), undercut);
            slit.rotation.y = trim.rotation.y;
            slit.position.set((x + nextX) * 0.512, -0.24, (z + nextZ) * 0.512);
            deck.add(slit);
        }
    }
    return deck;
}
