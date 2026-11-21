import { pointBrushRect } from "./atlas.mjs";

export function buildParticleDocuments(manifest) {
    const { width, height, texture, tiles, pointBrushGrid, strokeBrushStrip, pointBrushes, strokeBrushes } = manifest;

    const param = (name, fallback) => `(variable.vfx_${name} ?? ${fallback})`;
    const age = "variable.particle_age";
    const random = (index) => `variable.particle_random_${index}`;
    const saturate = (expr) => `math.clamp(${expr}, 0, 1)`;
    const fade = (inTime, outTime, time = age, life = "variable.particle_lifetime") =>
        `${saturate(`(${time}) / ${inTime}`)} * ${saturate(`(${life} - (${time})) / ${outTime}`)}`;
    const rightX = param("right_x", 1);
    const rightZ = param("right_z", 0);
    const rotate = (x, y, z) => [`(${x}) * ${rightX} + (${z}) * ${rightZ}`, y, `(${x}) * ${rightZ} - (${z}) * ${rightX}`];
    const scaled = (expr) => `(${expr}) * ${param("scale", 1)}`;
    const position = (x, y, z) => rotate(x, y, z).map(scaled);
    const stageDepth = param("stage_depth", 1);
    const uv = ([x, y, w, h]) => ({ texture_width: width, texture_height: height, uv: [x, y], uv_size: [w, h] });

    function alternateUv(base, alternate, name) {
        const coordinate = (index) => base[index] === alternate[index]
            ? base[index]
            : `${param(name, 0)} > 0.5 ? ${alternate[index]} : ${base[index]}`;
        return { ...uv(base), uv: [coordinate(0), coordinate(1)], uv_size: [coordinate(2), coordinate(3)] };
    }

    function thirdUv(base, middle, last, name) {
        const coordinate = (index) => base[index] === middle[index] && middle[index] === last[index]
            ? base[index]
            : `${param(name, 0)} > 1.5 ? ${last[index]} : (${param(name, 0)} > 0.5 ? ${middle[index]} : ${base[index]})`;
        return { ...uv(base), uv: [coordinate(0), coordinate(1)], uv_size: [coordinate(2), coordinate(3)] };
    }

    const tint = ([r, g, b], alpha) => ({
        color: [param("red", r), param("green", g), param("blue", b), `${param("opacity", 0.75)} * ${alpha}`],
    });
    const localSpace = { position: true, rotation: true };
    const point = { offset: [0, 0, 0] };

    const docs = [];
    function particle(name, components) {
        const document = {
            format_version: "1.10.0",
            particle_effect: {
                description: {
                    identifier: `pbe:vfx_${name}`,
                    basic_render_parameters: { material: "particles_add", texture },
                },
                components,
            },
        };
        docs.push([`particles/pbe_vfx_${name}.particle.json`, JSON.stringify(document, null, 2) + "\n"]);
    }

    const extent = param("range", 1);
    const fieldAngle = `360 * ${random(1)}`;
    const fieldRadius = `(1.49 + 1.32 * ${random(3)}) * ${extent}`;
    const moteSize = scaled(`${param("size", 1)} * (0.042 + 0.105 * math.pow(${random(4)}, 2.6))`);
    const drift = (scale, seed) => `${random(4)} < 0.32 ? 0 : ${scale} * ${param("speed", 1)} * (2 * ${random(seed)} - 1)`;
    particle("field", {
        "minecraft:emitter_rate_steady": { spawn_rate: param("rate", 12), max_particles: param("max_particles", 38) },
        "minecraft:emitter_lifetime_once": { active_time: param("active", 2.1) },
        "minecraft:emitter_shape_custom": {
            offset: position(`math.cos(${fieldAngle}) * ${fieldRadius}`,
                `1.08 + ${param("height", 0)} + 1.64 * (${random(2)} - 0.5)`,
                `math.sin(${fieldAngle}) * ${fieldRadius} * 0.91 * ${stageDepth}`),
            direction: [0, 1, 0],
        },
        "minecraft:particle_initial_speed": position(drift(0.22, 3), drift(0.13, 1), drift(0.17, 2)),
        "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 0.38 },
        "minecraft:particle_lifetime_expression": { max_lifetime: `1.2 + 2.0 * ${random(1)}` },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "lookat_xyz",
            size: [moteSize, moteSize],
            uv: { ...uv(tiles.mote), uv: [`${random(4)} > 0.82 ? ${tiles.glint[0]} : ${tiles.mote[0]}`, tiles.mote[1]] },
        },
        "minecraft:particle_appearance_tinting": tint([0.65, 0.72, 0.98],
            `${fade(0.78, 0.86)} * (0.26 + 0.63 * ${random(4)}) * (0.87 + 0.13 * math.sin(${age} * 180 + ${random(2)} * 360))`),
    });

    const phase = `${param("phase", 0)} - ${param("angular_speed", 124)} * ${age}`;
    const waveLife = param("life", 4.7);
    const harmonic = `math.sin(${phase}) + 0.23 * math.sin(2 * (${phase}) + 30)`;
    const waveRadius = scaled(param("radius", 0.109));
    const amplitude = param("amplitude", 0.37);
    const previousAmplitude = param("previous_amplitude", 0.37);
    particle("wave", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: waveLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: [0, scaled(`math.lerp(${previousAmplitude}, ${amplitude}, ${saturate(`${age} / 0.48`)}) * (${harmonic})`), 0],
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: waveLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz",
            size: [waveRadius, `0.72 * ${waveRadius}`],
            uv: uv(tiles.silk),
        },
        "minecraft:particle_appearance_tinting": tint([0.58, 0.90, 1],
            `${fade(0.66, 0.86)} * (0.88 + 0.12 * math.sin((${phase}) - 60))`),
    });

    const delay = param("delay", 0);
    const life = param("life", 2.7);
    const beamLife = `${life} + ${delay}`;
    const elapsed = `${age} - ${delay}`;
    const progress = saturate(`(${elapsed}) / ${life}`);
    const bend = param("bend", 0.56);
    const span = param("span", 4.8);
    const track = `${param("start", -2.4)} + ${span} * ${progress}`;
    const lateral = `${bend} * math.sin(180 * ${progress})`;
    const dirX = param("dir_x", 1);
    const dirZ = param("dir_z", 0);
    const crossSlope = `3.141593 * ${bend} * math.cos(180 * ${progress}) / ${span}`;
    const heightDelta = param("height_delta", 0);
    const climb = `${heightDelta} * (1 - ${saturate(`(${elapsed}) / 0.64`)})`;
    const arc = param("around", 1);
    const arcSweep = param("arc_sweep", 212);
    const arcAngle = `${param("arc_phase", 35)} + ${arcSweep} * ${progress}`;
    const arcRadius = param("arc_radius", 2.48);
    const arcDepth = `(0.77 + 0.1 * math.abs(${bend})) * ${stageDepth}`;
    const arcSign = `${arcSweep} < 0 ? -1 : 1`;
    const arcOrLine = (curve, line) => `(${arc} > 0.5 ? (${curve}) : (${line}))`;
    const lineSlopeY = `(1.665044 * math.abs(${bend}) * math.cos(180 * ${progress} - 24) - ((${elapsed}) >= 0 && (${elapsed}) < 0.64 ? ${heightDelta} * ${life} / 0.64 : 0)) / ${span}`;
    particle("beam", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: beamLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                arcOrLine(`math.cos(${arcAngle}) * ${arcRadius}`, `(${track}) * ${dirX} - (${lateral}) * ${dirZ}`),
                `${arcOrLine(`0.59 * ${bend} * math.sin(${arcAngle} - 24)`,
                    `0.53 * math.abs(${bend}) * math.sin(180 * ${progress} - 24)`)} + ${climb}`,
                arcOrLine(`math.sin(${arcAngle}) * ${arcRadius} * ${arcDepth}`, `(${track}) * ${dirZ} + (${lateral}) * ${dirX}`)),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: beamLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "direction_x",
            size: [scaled(`0.5 * ${param("length", 1.36)} * (0.64 + 0.36 * math.sin(180 * ${progress}))`),
                scaled(`0.5 * ${param("width", 0.16)}`)],
            direction: {
                mode: "custom",
                custom_direction: rotate(
                    arcOrLine(`-(${arcSign}) * math.sin(${arcAngle})`, `${dirX} - (${crossSlope}) * ${dirZ}`),
                    arcOrLine(`(${arcSign}) * 0.59 * ${bend} * math.cos(${arcAngle} - 24) / ${arcRadius}`, lineSlopeY),
                    arcOrLine(`(${arcSign}) * math.cos(${arcAngle}) * ${arcDepth}`, `${dirZ} + (${crossSlope}) * ${dirX}`)),
            },
            uv: alternateUv(tiles.beam, tiles.flow, "silk"),
        },
        "minecraft:particle_appearance_tinting": tint([1, 0.85, 0.70], fade(0.22, 0.53, elapsed, life)),
    });

    const shortLife = "variable.particle_lifetime";
    const normalizedAge = saturate(`${age} / ${shortLife}`);
    const ringRadius = scaled(`${param("radius", 2.15)} * (0.16 + 0.84 * math.pow(${normalizedAge}, 0.65)) * ${param("size", 1)} * ${stageDepth}`);
    particle("ripple", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: param("life", 1.1) },
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_lifetime_expression": { max_lifetime: param("life", 1.1) },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "emitter_transform_xz", size: [ringRadius, ringRadius], uv: uv(tiles.ripple),
        },
        "minecraft:particle_appearance_tinting": tint([0.54, 0.89, 0.86], fade(0.13, 0.65)),
    });

    const fountainSpeed = param("speed", 1);
    const sparkSize = scaled(`(0.036 + 0.035 * ${random(3)}) * ${param("size", 1)}`);
    particle("fountain", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 8) },
        "minecraft:emitter_lifetime_once": { active_time: 1.4 },
        "minecraft:emitter_shape_custom": { offset: position(`0.19 * (2 * ${random(1)} - 1)`, 0, `0.15 * (2 * ${random(4)} - 1)`) },
        "minecraft:particle_initial_speed": position(`${param("side", 1)} * (0.22 + 0.85 * ${random(1)})`,
            `(2.6 + 1.65 * ${random(2)}) * ${fountainSpeed}`, `0.15 + 0.58 * ${random(4)}`),
        "minecraft:particle_motion_dynamic": { linear_acceleration: [0, scaled(-7.6), 0], linear_drag_coefficient: 0.15 },
        "minecraft:particle_lifetime_expression": { max_lifetime: `${param("life", 1.15)} * (0.65 + 0.5 * ${random(2)})` },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz", size: [sparkSize, `1.45 * ${sparkSize}`], uv: uv(tiles.spark),
        },
        "minecraft:particle_appearance_tinting": tint([1, 0.86, 0.65], fade(0.09, 0.46)),
    });

    const shardLife = `(1.3 + 0.53 * ${random(3)}) / ${param("speed", 1)}`;
    const shardProgress = `math.pow(${saturate(`${age} / (${shardLife})`)}, 0.76)`;
    const shardFlow = param("flow", 1);
    const shardDistance = `math.lerp(1 - (${shardProgress}), ${shardProgress}, 0.5 + 0.5 * ${shardFlow})`;
    const shardSpread = `(0.35 + 0.65 * ${random(1)}) * (${shardDistance}) * ${extent}`;
    const shardWidth = scaled(`(0.092 + 0.115 * ${random(4)}) * ${param("size", 1)}`);
    particle("shard", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 5) },
        "minecraft:emitter_lifetime_once": { active_time: 0.06 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_initial_spin": {
            rotation: `-30 + 60 * ${random(2)}`,
            rotation_rate: `${param("side", 1)} * (29 + 95 * ${random(3)}) * ${shardFlow}`,
        },
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `${param("side", 1)} * (1.33 * ${shardSpread} + 0.23 * ${random(4)})`,
                `0.13 + 0.31 * ${random(2)} + (0.25 + 0.74 * ${random(4)}) * math.sin(105 * (${shardDistance}))`,
                `(0.33 * (2 * ${random(1)} - 1) + (0.46 + 0.81 * ${random(2)}) * ${shardSpread}) * ${stageDepth}`),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: shardLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz",
            size: [`(${shardWidth}) * (0.72 + 0.28 * math.abs(math.cos(210 * ${age} + 270 * ${random(1)})))`,
                `(1.63 + 0.7 * ${random(1)}) * (${shardWidth})`],
            uv: uv(tiles.shard),
        },
        "minecraft:particle_appearance_tinting": tint([0.55, 0.82, 1],
            `${fade(0.15, 0.52)} * (0.48 + 0.52 * math.abs(math.cos(143 * ${age} + 360 * ${random(4)})))`),
    });

    const curtainLife = param("life", 1.38);
    const curtainPhase = `${param("phase", 0)} + 130 * ${param("speed", 1)} * ${age}`;
    const sheet = param("sheet", 0);
    const curtainLength = param("length", 1.4);
    const sheetHeight = `math.lerp(${param("previous_length", 1.4)}, ${curtainLength}, ${saturate(`${age} / 0.86`)})`;
    const curtainY = `${sheet} > 1.5 ? (0.5 * ${sheetHeight} + 0.08 * math.sin(${curtainPhase})) : (${sheet} > 0.5 ? 0.16 * math.sin(${curtainPhase}) : 0.16 * math.sin(${curtainPhase}) - 0.32 * ${age})`;
    const curtainX = `${sheet} > 0.5 ? 0.18 * math.cos(${curtainPhase}) : 0`;
    particle("curtain", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: curtainLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_initial_spin": { rotation: param("roll", 0) },
        "minecraft:particle_motion_parametric": {
            relative_position: position(curtainX, curtainY, `(${sheet} > 0.5 ? 0.14 : 0.21) * math.cos(${curtainPhase})`),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: curtainLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "lookat_y",
            size: [scaled(`0.5 * ${param("width", 0.14)}`), scaled(`0.5 * (${sheet} > 0.5 ? ${sheetHeight} : ${curtainLength})`)],
            uv: thirdUv(tiles.curtain, tiles.aurora, tiles.drape, "sheet"),
        },
        "minecraft:particle_appearance_tinting": tint([0.55, 0.62, 0.94],
            `(${sheet} > 0.5 ? ${fade(0.89, 0.89)} * (0.79 + 0.14 * math.sin(${curtainPhase})) : ${fade(0.34, 0.52)})`),
    });

    const orbitLife = param("life", 2.45);
    const orbitAngle = `${param("phase", 0)} + 360 * ${random(1)} + 67 * ${param("speed", 1)} * ${age}`;
    const orbitRadius = `${param("radius", 2.32)} * (0.92 + 0.16 * ${random(2)})`;
    const orbitSize = scaled(`(0.035 + 0.039 * ${random(4)}) * ${param("size", 1)}`);
    particle("orbit", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 10) },
        "minecraft:emitter_lifetime_once": { active_time: orbitLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `math.cos(${orbitAngle}) * ${orbitRadius}`,
                `0.43 * math.sin(${orbitAngle}) + 0.18 * (2 * ${random(3)} - 1)`,
                `0.89 * math.sin(${orbitAngle}) * ${orbitRadius} * ${stageDepth}`),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: orbitLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz", size: [orbitSize, orbitSize], uv: uv(tiles.glint),
        },
        "minecraft:particle_appearance_tinting": tint([0.83, 0.66, 0.99], fade(0.38, 0.6)),
    });

    const shaftLife = param("life", 1.6);
    const shaftLength = `math.lerp(${param("previous_length", 2)}, ${param("length", 2)}, ${saturate(`${age} / 0.8`)})`;
    const shaftDirection = [param("dir_x", 0), param("dir_y", 1), param("dir_z", 0)];
    particle("shaft_upright", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: shaftLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": { relative_position: position(0, `0.5 * (${shaftLength})`, 0) },
        "minecraft:particle_lifetime_expression": { max_lifetime: shaftLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "lookat_y",
            size: [scaled(`0.5 * ${param("width", 0.15)}`), scaled(`0.5 * (${shaftLength})`)],
            uv: uv(tiles.upright),
        },
        "minecraft:particle_appearance_tinting": tint([0.66, 0.87, 1], fade(0.8, 0.8)),
    });
    particle("shaft", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: shaftLife },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: position(...shaftDirection.map(axis => `0.5 * (${shaftLength}) * (${axis})`)),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: shaftLife },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "lookat_direction",
            size: [scaled(`0.5 * (${shaftLength})`), scaled(`0.5 * ${param("width", 0.15)}`)],
            direction: { mode: "custom", custom_direction: rotate(...shaftDirection) },
            uv: thirdUv(tiles.shaft, tiles.haze, tiles.bar, "shaft_style"),
        },
        "minecraft:particle_appearance_tinting": tint([0.66, 0.87, 1], fade(0.8, 0.8)),
    });

    // Generic parameterized drawing primitives
    const drawAge = "math.clamp(variable.particle_age / math.max(0.01, variable.particle_lifetime), 0, 1)";
    const drawCurve = `math.pow(${drawAge}, ${param("curve", 1)})`;
    const drawFade = `${fade(`math.max(0.01, ${param("fade_in", 0.16)})`, `math.max(0.01, ${param("fade_out", 0.35)})`)}`;
    const drawTint = {
        color: [
            `math.lerp(${param("red", 1)}, ${param("red2", param("red", 1))}, ${drawAge})`,
            `math.lerp(${param("green", 1)}, ${param("green2", param("green", 1))}, ${drawAge})`,
            `math.lerp(${param("blue", 1)}, ${param("blue2", param("blue", 1))}, ${drawAge})`,
            `${param("opacity", 0.8)} * ${drawFade}`,
        ],
    };

    const ptAngle = `${param("phase", 0)} + ${param("phase_spread", 360)} * ${random(1)} + ${param("omega", 0)} * ${age}`;
    const ptRadius = `math.lerp(${param("radius", 0)}, ${param("radius_end", 0)}, ${drawCurve}) + ${param("radial_jitter", 0)} * (2 * ${random(3)} - 1)`;
    const ptFlutter = param("flutter", 0);
    const ptX = `${param("spread_x", 0)} * (2 * ${random(2)} - 1) + (${ptRadius}) * math.cos(${ptAngle}) + ${param("vx", 0)} * ${age} + 0.5 * ${param("ax", 0)} * ${age} * ${age} + (${ptFlutter}) * math.sin(170 * ${age} + 360 * ${random(2)})`;
    const ptY = `${param("spread_y", 0)} * (2 * ${random(3)} - 1) + ${param("tilt", 0)} * math.sin(${ptAngle}) + ${param("rise", 0)} * ${drawCurve} + ${param("vy", 0)} * ${age} + 0.5 * ${param("ay", 0)} * ${age} * ${age}`;
    const ptZ = `(${param("spread_z", 0)} * (2 * ${random(4)} - 1) + (${ptRadius}) * ${param("depth_ratio", 0.9)} * math.sin(${ptAngle}) + ${param("vz", 0)} * ${age} + 0.5 * ${param("az", 0)} * ${age} * ${age} + (${ptFlutter}) * math.cos(145 * ${age} + 360 * ${random(3)})) * ${stageDepth}`;
    const ptSize = scaled(`math.lerp(${param("size", 0.08)}, ${param("size_end", 0.08)}, ${drawAge}) * (1 + ${param("size_jitter", 0.25)} * (2 * ${random(4)} - 1))`);
    const ptTwinkle = `((1 - ${param("twinkle", 0)}) + ${param("twinkle", 0)} * (0.45 + 0.55 * math.sin(260 * ${age} + 360 * ${random(4)})))`;

    const maxPointBrush = pointBrushes.length - 1;
    const ptBrush = `math.floor(math.clamp(${param("brush", 0)}, 0, ${maxPointBrush}))`;
    particle("draw_point", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_initial_spin": {
            rotation: `${param("spin", 0)} + ${param("spin_jitter", 0)} * (2 * ${random(2)} - 1)`,
            rotation_rate: param("spin_rate", 0),
        },
        "minecraft:particle_motion_parametric": { relative_position: position(ptX, ptY, ptZ) },
        "minecraft:particle_lifetime_expression": {
            max_lifetime: `math.max(0.1, ${param("life", 1.5)} * (1 + ${param("life_jitter", 0.2)} * (2 * ${random(1)} - 1)))`,
        },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz",
            size: [ptSize, ptSize],
            uv: {
                texture_width: width,
                texture_height: height,
                uv: [
                    `${pointBrushGrid.originX} + math.mod(${ptBrush}, ${pointBrushGrid.cols}) * ${pointBrushGrid.cellSize}`,
                    `${pointBrushGrid.originY} + math.floor((${ptBrush}) / ${pointBrushGrid.cols}) * ${pointBrushGrid.cellSize}`,
                ],
                uv_size: [pointBrushGrid.cellSize, pointBrushGrid.cellSize],
            },
        },
        "minecraft:particle_appearance_tinting": {
            color: [drawTint.color[0], drawTint.color[1], drawTint.color[2], `${drawTint.color[3]} * ${ptTwinkle}`],
        },
    });

    const maxStrokeBrush = strokeBrushes.length - 1;
    const strokeLen = scaled(`math.lerp(${param("length", 0.3)}, ${param("length_end", 0.3)}, ${drawAge})`);
    particle("draw_stroke", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `${param("vx", 0)} * ${age} + 0.5 * ${param("ax", 0)} * ${age} * ${age}`,
                `${param("vy", 0)} * ${age} + 0.5 * ${param("ay", 0)} * ${age} * ${age}`,
                `(${param("vz", 0)} * ${age} + 0.5 * ${param("az", 0)} * ${age} * ${age}) * ${stageDepth}`),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: `math.max(0.1, ${param("life", 1.4)})` },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "direction_x",
            size: [`0.5 * (${strokeLen})`, scaled(`0.5 * ${param("width", 0.08)}`)],
            direction: {
                mode: "custom",
                custom_direction: rotate(param("tx", 1), param("ty", 0), `${param("tz", 0)} * ${stageDepth}`),
            },
            uv: {
                texture_width: width,
                texture_height: height,
                uv: [
                    `${strokeBrushStrip.originX} + math.floor(math.clamp(${param("brush", 0)}, 0, ${maxStrokeBrush})) * ${strokeBrushStrip.cellWidth}`,
                    strokeBrushStrip.originY,
                ],
                uv_size: [strokeBrushStrip.cellWidth, strokeBrushStrip.cellHeight],
            },
        },
        "minecraft:particle_appearance_tinting": drawTint,
    });

    const ringIndex = pointBrushes.findIndex((b) => b.id === "ring");
    const ringTile = pointBrushRect(manifest, ringIndex >= 0 ? ringIndex : 0);
    const planeR = scaled(`math.lerp(${param("radius_start", 0.4)}, ${param("radius_end", 2.4)}, math.pow(${drawAge}, ${param("curve", 0.7)})) * ${stageDepth}`);
    particle("draw_plane", {
        "minecraft:emitter_rate_instant": { num_particles: 1 },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_initial_spin": { rotation: param("spin", 0), rotation_rate: param("spin_rate", 0) },
        "minecraft:particle_motion_parametric": { relative_position: position(0, `${param("vy", 0)} * ${age}`, 0) },
        "minecraft:particle_lifetime_expression": { max_lifetime: `math.max(0.1, ${param("life", 1.2)})` },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "emitter_transform_xz",
            size: [planeR, planeR],
            uv: alternateUv(tiles.ripple, ringTile, "style"),
        },
        "minecraft:particle_appearance_tinting": drawTint,
    });

    const cloudSize = scaled(`math.lerp(${param("size", 0.9)}, ${param("size_end", 1.35)}, ${drawAge}) * (1 + ${param("size_jitter", 0.2)} * (2 * ${random(4)} - 1))`);
    particle("draw_cloud", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_initial_spin": {
            rotation: `${param("spin", 0)} + ${param("spin_jitter", 14)} * (2 * ${random(2)} - 1)`,
            rotation_rate: param("spin_rate", 0),
        },
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `${param("spread_x", 0)} * (2 * ${random(1)} - 1) + ${param("vx", 0)} * ${age}`,
                `${param("spread_y", 0)} * (2 * ${random(2)} - 1) + ${param("vy", 0)} * ${age}`,
                `(${param("spread_z", 0)} * (2 * ${random(3)} - 1) + ${param("vz", 0)} * ${age}) * ${stageDepth}`),
        },
        "minecraft:particle_lifetime_expression": {
            max_lifetime: `math.max(0.2, ${param("life", 3.2)} * (1 + ${param("life_jitter", 0.18)} * (2 * ${random(1)} - 1)))`,
        },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "rotate_xyz",
            size: [cloudSize, `(${cloudSize}) * 0.62`],
            uv: uv(tiles.cloud_puff),
        },
        "minecraft:particle_appearance_tinting": drawTint,
    });

    const cometLen = scaled(`math.lerp(${param("length", 2.8)}, ${param("length_end", 3.4)}, ${drawAge})`);
    particle("draw_comet", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `${param("vx", 0)} * ${age} + 0.5 * ${param("ax", 0)} * ${age} * ${age}`,
                `${param("vy", 0)} * ${age} + 0.5 * ${param("ay", 0)} * ${age} * ${age}`,
                `(${param("vz", 0)} * ${age} + 0.5 * ${param("az", 0)} * ${age} * ${age}) * ${stageDepth}`),
        },
        "minecraft:particle_lifetime_expression": { max_lifetime: `math.max(0.2, ${param("life", 2.2)})` },
        "minecraft:particle_appearance_billboard": {
            facing_camera_mode: "direction_x",
            size: [`0.5 * (${cometLen})`, scaled(`0.5 * ${param("width", 0.55)}`)],
            direction: {
                mode: "custom",
                custom_direction: rotate(param("tx", 1), param("ty", 0), `${param("tz", 0)} * ${stageDepth}`),
            },
            uv: uv(tiles.comet_body),
        },
        "minecraft:particle_appearance_tinting": drawTint,
    });

    // Folded dust & shock particles from the unified vfx_lab atlas
    const dustLife = param("life", 1.3);
    const driftAngle = `360 * ${random(1)} + ${param("phase", 0)} + (15 + 22 * ${random(2)}) * ${age}`;
    const dustRadius = `math.lerp(1.72 + 3.15 * ${random(3)}, ${param("radius", 2.8)} * (0.73 + 0.46 * ${random(3)}), ${param("coherence", 0)}) + ${param("release", 0)} * ${age} * (0.5 + ${random(4)})`;
    const dustSize = scaled(`(0.034 + 0.071 * math.pow(${random(4)}, 2.2))`);
    particle("dust", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_lifetime_expression": { max_lifetime: dustLife },
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `(${dustRadius}) * math.sin(${driftAngle})`,
                `0.18 + 2.7 * math.pow(${random(2)}, 1.8) + 0.15 * math.sin(130 * ${age} + ${random(3)} * 360)`,
                `(${dustRadius}) * 0.87 * math.cos(${driftAngle}) * ${stageDepth}`),
        },
        "minecraft:particle_appearance_billboard": {
            size: [dustSize, dustSize],
            facing_camera_mode: "rotate_xyz",
            uv: uv(tiles.cinema_dust),
        },
        "minecraft:particle_appearance_tinting": tint([1, 0.78, 0.49],
            `(${fade(0.51, 0.56)}) * (0.30 + 0.63 * ${random(4)}) * (0.45 + 0.55 * ${param("bright", 0.4)})`),
    });

    const shockLife = param("life", 1.3);
    const shockProgress = "math.clamp(variable.particle_age / variable.particle_lifetime, 0, 1)";
    const strength = param("strength", 0.89);
    const shockAngle = `360 * ${random(1)} + ${param("phase", 0)} - (24 + 15 * ${random(4)}) * ${age}`;
    const front = `math.pow(${shockProgress}, 0.69)`;
    const shockRadius = `(0.85 + 0.87 * ${random(2)} + (1.92 + 1.83 * ${strength} + ${random(3)}) * (${front}))`;
    const shockSize = scaled(`(0.15 + 0.20 * ${random(3)}) * (1 - 0.29 * (${front}))`);
    particle("shock", {
        "minecraft:emitter_rate_instant": { num_particles: param("count", 1) },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_local_space": localSpace,
        "minecraft:emitter_shape_point": point,
        "minecraft:particle_lifetime_expression": { max_lifetime: shockLife },
        "minecraft:particle_motion_parametric": {
            relative_position: position(
                `${shockRadius} * math.sin(${shockAngle})`,
                `0.16 + (0.20 + 1.20 * ${random(4)} * ${random(4)}) * math.sin(135 * (${front})) * ${strength}`,
                `0.91 * ${shockRadius} * math.cos(${shockAngle}) * ${stageDepth}`),
        },
        "minecraft:particle_appearance_billboard": {
            size: [shockSize, shockSize],
            facing_camera_mode: "rotate_xyz",
            uv: {
                ...uv(tiles.cinema_cluster),
                uv: [`${random(3)} < 0.48 ? ${tiles.cinema_flecks[0]} : ${tiles.cinema_cluster[0]}`, tiles.cinema_cluster[1]],
            },
        },
        "minecraft:particle_appearance_tinting": tint([1, 0.78, 0.49],
            `(${fade(0.07, 0.78)}) * (0.54 + 0.46 * ${random(2)})`),
    });

    return docs;
}
