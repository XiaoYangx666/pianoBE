import { evaluate, type ParticleEffect } from "./particles";
import type { Instance } from "./renderer";

type Live = {
    effect: ParticleEffect;
    scope: Record<string, number>;
    origin: [number, number, number];
    age: number;
    life: number;
};

function channel(raw: string | number, index: number, scope: Record<string, number>) {
    if (typeof raw === "string" && raw.startsWith("#")) {
        const hex = Number.parseInt(raw.slice(1), 16);
        if (raw.length === 9) return ((hex >> (24 - index * 8)) & 255) / 255;
        return index === 3 ? 1 : ((hex >> (16 - index * 8)) & 255) / 255;
    }
    return Math.max(0, Math.min(1, evaluate(raw, scope)));
}

/** Simulates the scripted emitters using the real particle components. */
export class ParticleField {
    readonly particles: Live[] = [];

    spawn(effect: ParticleEffect, variables: Record<string, number>, origin: [number, number, number], count: number) {
        for (let index = 0; index < count; index++) {
            const scope: Record<string, number> = {};
            for (const [key, value] of Object.entries(variables)) scope[`variable.vfx_${key}`] = value;
            scope["variable.particle_random_1"] = Math.random();
            scope["variable.particle_random_2"] = Math.random();
            scope["variable.particle_random_3"] = Math.random();
            scope["variable.particle_random_4"] = Math.random();
            scope["variable.particle_age"] = 0;
            const life = Math.max(0.01, evaluate(effect.lifetime, scope, 1));
            scope["variable.particle_lifetime"] = life;
            this.particles.push({ effect, scope, origin, age: 0, life });
        }
    }

    update(delta: number) {
        for (let index = this.particles.length - 1; index >= 0; index--) {
            const particle = this.particles[index];
            particle.age += delta;
            if (particle.age >= particle.life) {
                this.particles.splice(index, 1);
                continue;
            }
            particle.scope["variable.particle_age"] = particle.age;
        }
    }

    sample(instances: Instance[]) {
        instances.length = 0;
        for (const { effect, scope, origin, age } of this.particles) {
            scope["variable.particle_age"] = age;
            const x = evaluate(effect.position[0], scope);
            const y = evaluate(effect.position[1], scope);
            const z = evaluate(effect.position[2], scope);
            const sizeX = evaluate(effect.size[0], scope);
            const sizeY = evaluate(effect.size[1], scope);
            const color: [number, number, number, number] = [0, 0, 0, 0];
            for (let index = 0; index < 4; index++) color[index] = channel(effect.color[index], index, scope);
            const width = effect.uv.width || 1;
            const height = effect.uv.height || 1;
            const u = evaluate(effect.uv.origin[0], scope) / width;
            const v = evaluate(effect.uv.origin[1], scope) / height;
            const uv: [number, number, number, number] = [u, v,
                u + effect.uv.size[0] / width, v + effect.uv.size[1] / height];
            if (color[3] <= 0.002 || sizeX <= 0 || sizeY <= 0) continue;
            instances.push({
                position: [origin[0] + x, origin[1] + y, origin[2] + z],
                size: [sizeX, sizeY],
                color,
                uv,
                axis: effect.axis
                    ? [evaluate(effect.axis[0], scope), evaluate(effect.axis[1], scope), evaluate(effect.axis[2], scope)]
                    : null,
            });
        }
    }

    clear() {
        this.particles.length = 0;
    }
}
