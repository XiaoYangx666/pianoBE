import * as THREE from "three";

export interface Instance {
    position: [number, number, number];
    size: [number, number];
    color: [number, number, number, number];
    uv: [number, number, number, number];
    axis: [number, number, number] | null;
}

const vertexShader = /* glsl */`
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iUv;
attribute vec3 iAxis;

varying vec2 vUv;
varying vec4 vColor;

void main() {
    vec2 corner = position.xy;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    if (dot(iAxis, iAxis) > 0.0001) {
        vec3 axis = normalize(iAxis);
        vec3 viewDir = normalize(cameraPosition - iPos);
        vec3 normal = viewDir - axis * dot(viewDir, axis);
        if (dot(normal, normal) < 0.0001) {
            normal = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        }
        normal = normalize(normal);
        right = axis;
        up = cross(normal, axis);
    }

    vec3 world = iPos + right * (corner.x * iSize.x) + up * (corner.y * iSize.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vUv = vec2(mix(iUv.x, iUv.z, corner.x + 0.5), mix(iUv.y, iUv.w, corner.y + 0.5));
    vColor = iColor;
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;

void main() {
    vec4 tex = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
}
`;

const CAPACITY = 4096;
const HALO_SCALE = 2.4;
const HALO_ALPHA = 0.15;

/** Instanced billboards that follow the two appearance modes used by the staging. */
export class BillboardRenderer {
    readonly mesh: THREE.Mesh;
    private readonly geometry = new THREE.InstancedBufferGeometry();
    private readonly position = new Float32Array(CAPACITY * 3);
    private readonly size = new Float32Array(CAPACITY * 2);
    private readonly color = new Float32Array(CAPACITY * 4);
    private readonly uv = new Float32Array(CAPACITY * 4);
    private readonly axis = new Float32Array(CAPACITY * 3);
    private readonly attributes: {
        position: THREE.InstancedBufferAttribute;
        size: THREE.InstancedBufferAttribute;
        color: THREE.InstancedBufferAttribute;
        uv: THREE.InstancedBufferAttribute;
        axis: THREE.InstancedBufferAttribute;
    };

    constructor(texture: THREE.Texture) {
        this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
            -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
        ]), 3));
        this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const attribute = (array: Float32Array, size: number) => {
            const result = new THREE.InstancedBufferAttribute(array, size);
            result.setUsage(THREE.DynamicDrawUsage);
            return result;
        };
        this.attributes = {
            position: attribute(this.position, 3),
            size: attribute(this.size, 2),
            color: attribute(this.color, 4),
            uv: attribute(this.uv, 4),
            axis: attribute(this.axis, 3),
        };
        this.geometry.setAttribute("iPos", this.attributes.position);
        this.geometry.setAttribute("iSize", this.attributes.size);
        this.geometry.setAttribute("iColor", this.attributes.color);
        this.geometry.setAttribute("iUv", this.attributes.uv);
        this.geometry.setAttribute("iAxis", this.attributes.axis);
        this.geometry.instanceCount = 0;

        const material = new THREE.ShaderMaterial({
            uniforms: { map: { value: texture } },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
    }

    setInstances(instances: readonly Instance[]) {
        const count = Math.min(instances.length, CAPACITY / 2);
        let slot = 0;
        const write = (instance: Instance, size: number, alpha: number) => {
            if (slot >= CAPACITY) return;
            const { position, size: full, color, uv, axis } = instance;
            this.position.set(position, slot * 3);
            this.size.set([full[0] * size, full[1] * size], slot * 2);
            this.color.set([color[0], color[1], color[2], color[3] * alpha], slot * 4);
            this.uv.set(uv, slot * 4);
            this.axis.set(axis ?? [0, 0, 0], slot * 3);
            slot++;
        };
        for (let i = 0; i < count; i++) {
            const instance = instances[i];
            // A cheap bloom pass: every dash gets a wider, faint twin so the
            // additive result reads like the game's emissive particles.
            write(instance, HALO_SCALE, HALO_ALPHA);
            write(instance, 1, 1);
        }
        for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
        this.geometry.instanceCount = slot;
    }
}
