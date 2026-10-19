// Đèn giả lập bằng shader (không dùng PointLight của Three.js).
// - Mỗi đèn là 1 điểm trong thế giới + màu + tầm chiếu. Mỗi frame chọn tối đa LAMP_FX.maxLights đèn gần camera nhất,
//   đẩy vào 1 bộ uniform dùng chung cho MỌI vật liệu.
// - Shader của vật nhận sáng: với từng đèn, tính hướng tới đèn + pháp tuyến bề mặt (3 chiều) -> mặt hướng về đèn sáng,
//   mặt quay đi tối, chia mảng mềm kiểu toon; giảm dần theo khoảng cách tới hết tầm chiếu.
// - Chỉ bật về đêm (theo env.dayFactor), ban ngày tắt hẳn -> không tốn gì.
// - Tự vá mọi vật liệu MeshToon / MeshStandard / MeshLambert / MeshPhong trong scene (kể cả nước, bờ đảo, model .glb).
//
// Chi phí: mỗi pixel lặp qua số đèn đang bật. 4–8 đèn vẫn rất nhẹ so với mây volumetric.
// Dùng:  world.lamps.add(object3D, { color: 0xffb04a, range: 12 })
import * as THREE from 'three';

/** Số đèn tối đa trong shader (cố định lúc biên dịch). LAMP_FX.maxLights chọn bao nhiêu đèn thật sự bật. */
export const MAX_LAMPS = 8;

/** Chỉnh đèn ở đây (bảng G cũng chỉnh được). */
export const LAMP_FX = {
  enabled: true,
  maxLights: 4,        // số đèn chiếu sáng cùng lúc (gần camera nhất), tối đa 8
  intensity: 1.0,      // nhân độ sáng mọi đèn
  maxDistance: 220,    // đèn xa camera hơn mức này thì không chiếu (vẫn tự sáng + bloom)
  dayCutoff: 0.55,     // env.dayFactor lớn hơn mức này (trời sáng) thì đèn tắt hẳn
  flicker: 1.0,        // nhân độ lập loè của đèn lồng
  softness: 0.35,      // 0 = mảng sáng/tối sắc kiểu toon, 1 = chuyển mềm
};

export interface LampOptions {
  color?: THREE.ColorRepresentation;
  /** Tầm chiếu (m). */
  range?: number;
  intensity?: number;
  /** Lập loè 0..1 (đèn lồng, lửa). */
  flicker?: number;
  /** Lệch khỏi tâm object (toạ độ của object). */
  offset?: THREE.Vector3;
}

export interface Lamp {
  object: THREE.Object3D;
  color: THREE.Color;
  range: number;
  intensity: number;
  flicker: number;
  offset: THREE.Vector3;
  /** Tắt riêng đèn này. */
  on: boolean;
}

const shared = {
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },   // xyz + tầm chiếu
  uLampColor: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) }, // màu x độ sáng
  uLampCount: { value: 0 },
  uLampSoft: { value: LAMP_FX.softness },
};

const VERT_PARS = /* glsl */ `
varying vec3 vLampW;
varying vec3 vLampN;`;

const VERT_MAIN = /* glsl */ `
{
  vec4 lw = vec4(transformed, 1.0);
  vec3 ln = objectNormal;
  #ifdef USE_INSTANCING
    lw = instanceMatrix * lw;
    ln = mat3(instanceMatrix) * ln;
  #endif
  vLampW = (modelMatrix * lw).xyz;
  vLampN = normalize(mat3(modelMatrix) * ln);
}`;

const FRAG_PARS = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
uniform vec4 uLampPos[MAX_LAMPS];
uniform vec3 uLampColor[MAX_LAMPS];
uniform int uLampCount;
uniform float uLampSoft;
varying vec3 vLampW;
varying vec3 vLampN;
vec3 lampLight(vec3 albedo) {
  vec3 sum = vec3(0.0);
  vec3 n = normalize(vLampN);
  #ifdef DOUBLE_SIDED
    n *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLampPos[i].xyz - vLampW;
    float d = length(L);
    float range = uLampPos[i].w;
    if (d > range) continue;
    L /= max(d, 1e-3);
    // giảm theo khoảng cách: sáng gần đèn, tắt mềm ở mép tầm chiếu
    float att = 1.0 - d / range;
    att *= att;
    // 3 chiều: mặt hướng về đèn sáng, mặt quay đi tối (chia mảng kiểu toon, độ mềm chỉnh được)
    float ndl = dot(n, L);
    float s = mix(0.12, 0.45, uLampSoft);
    float shade = mix(0.18, 1.0, smoothstep(-s, s, ndl));
    sum += uLampColor[i] * att * shade;
  }
  return albedo * sum;
}`;

const PATCHABLE = new Set(['MeshToonMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);

/** Vá 1 vật liệu để nhận ánh sáng đèn. Gọi SAU các bản vá khác (shoreline, nước…). Trả về false nếu không hỗ trợ. */
export function applyLampLight(mat: THREE.Material): boolean {
  if (!PATCHABLE.has(mat.type) || mat.userData.sbLamp) return false;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey(); // khoá cũ (vd. shoreline) — chụp lại TRƯỚC khi thay onBeforeCompile
  mat.onBeforeCompile = (sh, renderer) => {
    prev.call(mat, sh, renderer);
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_PARS}`)
      .replace('#include <opaque_fragment>', `outgoingLight += lampLight(diffuseColor.rgb);\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|lamp`;
  mat.userData.sbLamp = true;
  mat.needsUpdate = true;
  return true;
}

export class LampLights {
  readonly lamps: Lamp[] = [];
  private t = 0;
  private scanTimer = 0;
  private tmp = new THREE.Vector3();
  private order: { lamp: Lamp; d: number; p: THREE.Vector3 }[] = [];

  constructor(private scene: THREE.Scene) {}

  add(object: THREE.Object3D, opts: LampOptions = {}): Lamp {
    const lamp: Lamp = {
      object,
      color: new THREE.Color(opts.color ?? 0xffb04a),
      range: opts.range ?? 10,
      intensity: opts.intensity ?? 1.6,
      flicker: opts.flicker ?? 0.1,
      offset: opts.offset?.clone() ?? new THREE.Vector3(),
      on: true,
    };
    this.lamps.push(lamp);
    return lamp;
  }

  remove(lamp: Lamp): void {
    const i = this.lamps.indexOf(lamp);
    if (i >= 0) this.lamps.splice(i, 1);
  }

  /** Vá vật liệu mới thêm vào scene (gọi định kỳ, tự động trong update). */
  scan(): void {
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m || !(o as THREE.Mesh).isMesh) return;
      if (Array.isArray(m)) m.forEach(applyLampLight); else applyLampLight(m);
    });
  }

  /** night: 0 = ngày, 1 = đêm (thường = 1 - env.dayFactor). */
  update(dt: number, camPos: THREE.Vector3, dayFactor: number): void {
    const C = LAMP_FX;
    this.t += dt;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) { this.scan(); this.scanTimer = 1; }
    shared.uLampSoft.value = C.softness;

    const nightK = C.enabled ? 1 - THREE.MathUtils.smoothstep(dayFactor, C.dayCutoff * 0.4, C.dayCutoff) : 0;
    if (nightK <= 0.001 || C.maxLights <= 0) { shared.uLampCount.value = 0; return; }

    // chọn các đèn gần camera nhất
    this.order.length = 0;
    for (const lamp of this.lamps) {
      if (!lamp.on || !lamp.object.visible) continue;
      const p = lamp.object.localToWorld(this.tmp.copy(lamp.offset)).clone();
      const d = p.distanceTo(camPos);
      if (d > C.maxDistance + lamp.range) continue;
      this.order.push({ lamp, d, p });
    }
    this.order.sort((a, b) => a.d - b.d);
    const n = Math.min(this.order.length, Math.min(MAX_LAMPS, Math.floor(C.maxLights)));
    for (let i = 0; i < n; i++) {
      const { lamp, d, p } = this.order[i];
      // mờ dần khi ra xa camera -> không bật/tắt giật khi đổi đèn
      const fade = 1 - THREE.MathUtils.smoothstep(d, C.maxDistance * 0.7, C.maxDistance + lamp.range);
      const fl = lamp.flicker * C.flicker;
      const flick = 1 - fl * (0.5 + 0.5 * Math.sin(this.t * 13.1 + i * 1.7) * Math.sin(this.t * 7.3 + i));
      const k = lamp.intensity * C.intensity * nightK * fade * flick;
      shared.uLampPos.value[i].set(p.x, p.y, p.z, lamp.range * (0.97 + 0.03 * flick));
      shared.uLampColor.value[i].set(lamp.color.r * k, lamp.color.g * k, lamp.color.b * k);
    }
    shared.uLampCount.value = n;
  }
}
