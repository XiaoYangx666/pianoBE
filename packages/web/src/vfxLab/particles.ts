import type { Camera, ShaderMaterial, Vector3 } from "three";
import { LinearFilter, TextureLoader } from "three";
import Wintersky from "wintersky";
import type { Config, Emitter } from "wintersky";
import type Molang from "molangjs";
import atlasUrl from "../../../addon/rp/textures/particle/vfx_lab.png";
import cinemaAtlasUrl from "../../../addon/rp/textures/particle/secret_cinema.png";
import type { VfxEffect, VfxParticle } from "../../../addon/src/domain/piano/vfxLab";

type Expression = number | string;
interface Definition {
    particle_effect: {
        description: { identifier: `pbe:vfx_${VfxParticle}` };
        components: {
            "minecraft:particle_initial_speed"?: [Expression, Expression, Expression] | Expression;
        };
    };
}

// Wintersky 1.4 exposes these runtime members without declaring them in its types.
interface RuntimeEmitter extends Emitter {
    Molang: Molang;
    active_time: number;
    view_age: number;
    enabled: boolean;
    material: ShaderMaterial;
    particles: { position: Vector3 }[];
    spawnParticles(count: number): void;
    calculate(expression: Expression, variables: object): number;
    params(): object;
}

const documents = import.meta.glob<Definition>("../../../addon/rp/particles/pbe_vfx_*.particle.json", {
    eager: true, import: "default",
});
const stepRate = 40;

export const particleStep = 1 / stepRate;

export async function loadParticles() {
    const loader = new TextureLoader();
    const [texture, cinemaTexture] = await Promise.all([loader.loadAsync(atlasUrl), loader.loadAsync(cinemaAtlasUrl)]);
    for (const sheet of [texture, cinemaTexture]) {
        sheet.magFilter = LinearFilter;
        sheet.minFilter = LinearFilter;
    }
    const scene = new Wintersky.Scene();
    scene.global_options.tick_rate = stepRate;
    scene.global_options.ground_collision = false;
    const configs = new Map<VfxParticle, Config>();
    const rates = new Map<VfxParticle, Expression>();
    for (const doc of Object.values(documents)) {
        const particle = doc.particle_effect.description.identifier.slice("pbe:vfx_".length) as VfxParticle;
        const config = new Wintersky.Config(scene, doc);
        config.texture.dispose();
        config.texture = particle.startsWith("cinema_") ? cinemaTexture : texture;

        // Wintersky normalizes vector initial speed. Restore its magnitude with the same Molang components.
        const initial = doc.particle_effect.components["minecraft:particle_initial_speed"];
        if (Array.isArray(initial)) {
            config.particle_motion_linear_speed = `math.sqrt(${initial.map(expr =>
                `((${expr}) * (${expr}))`).join(" + ")})`;
        }
        // The built-in steady scheduler rounds 1/rate to whole ticks. Integrate the authored rate here.
        if (config.emitter_rate_mode === "steady") {
            rates.set(particle, config.emitter_rate_rate);
            config.emitter_rate_rate = 0;
        }
        configs.set(particle, config);
    }

    interface LiveEmitter {
        effect: VfxEffect;
        particle: VfxParticle;
        instance: RuntimeEmitter;
        carry: number;
    }
    let active: LiveEmitter[] = [];
    let randomState = 1;
    function withSeededRandom(fn: () => void) {
        // Wintersky uses Math.random directly. Keep the override inside its synchronous calls.
        const original = Math.random;
        Math.random = () => {
            randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
            return randomState / 4294967296;
        };
        try { fn(); } finally { Math.random = original; }
    }
    function reset() {
        active.forEach(({ instance }) => instance.delete());
        active = [];
        randomState = 1;
    }
    return {
        space: scene.space,
        get active() { return active; },
        spawn(effect: VfxEffect, particle: VfxParticle, position: { x: number; y: number; z: number }, values: Record<string, number>) {
            withSeededRandom(() => {
                const instance = new Wintersky.Emitter(scene, configs.get(particle)!, {
                    loop_mode: "once", parent_mode: "world",
                }) as RuntimeEmitter;
                instance.Molang.global_variables = Object.fromEntries(Object.entries(values).map(
                    ([key, value]) => [`variable.vfx_${key}`, value],
                ));
                instance.global_space.position.set(position.x, position.y, position.z);
                instance.start();
                active.push({ effect, particle, instance, carry: 0 });
            });
        },
        step() {
            withSeededRandom(() => {
                active = active.filter(entry => {
                    const { instance } = entry;
                    const rate = rates.get(entry.particle);
                    if (rate !== undefined && instance.enabled) {
                        entry.carry += instance.calculate(rate, instance.params()) * particleStep;
                        const count = Math.floor(entry.carry + 1e-9);
                        entry.carry -= count;
                        instance.spawnParticles(count);
                    }
                    instance.tick();
                    if (instance.enabled || instance.particles.length) return true;
                    instance.delete();
                    return false;
                });
            });
        },
        face(camera: Camera) { scene.updateFacingRotation(camera); },
        reset,
        dispose() { reset(); texture.dispose(); cinemaTexture.dispose(); },
    };
}
