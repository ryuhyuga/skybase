// Cỏ kiểu Ghibli: rất nhiều ngọn cỏ trong 1 draw call (InstancedBufferGeometry).
// - Một "ô cỏ" vuông bám theo camera; vị trí ngọn cỏ quấn (wrap) quanh camera trong shader -> cỏ vô tận
//   mà không cần sinh lại. Độ cao + vùng mọc lấy từ heightmap của Terrain.
// - Gốc xanh đậm -> ngọn xanh vàng, điểm vài mảng úa vàng; rạp theo gió thành từng đợt sóng.
// - Mờ/nhỏ dần ra rìa bán kính; bay cao quá thì tắt hẳn (nhìn từ cao chỉ cần màu nền đảo).
import * as THREE from 'three';
import { Environment } from '../sky/Environment';
import { COLORS } from '../sky/palette';
import { HEIGHTMAP, Terrain } from './Terrain';

/** Chỉnh cỏ ở đây. */
export const GRASS = {
  enabled: false,      // TẮT mặc định cho nhẹ máy; đặt true để bật lại cỏ
  count: 180000,       // số ngọn cỏ (giảm nếu máy chậm)
  tile: 230,           // cạnh ô cỏ quanh camera (m)
  radius: 110,         // bán kính hiển thị (m)
  bladeHeight: 1.5,    // m
  bladeWidth: 0.24,    // m
  windStrength: 0.9,
  windDir: new THREE.Vector2(0.92, 0.38).normalize(),
  maxViewHeight: 240,  // camera cao hơn mặt đất quá mức này thì tắt cỏ
};

const VERT = /* glsl */ `
attribute vec2 iOffset;
attribute vec4 iRand;
uniform sampler2D uHeight;
uniform vec3 uHB;          // minX, minZ, size
uniform vec3 uCam;
uniform float uTile;
uniform float uRadius;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uBladeH;
uniform float uBladeW;
varying float vT;
varying float vVar;
varying float vDist;
varying float vSide;

void main() {
  vec2 rel = mod(iOffset - uCam.xz + uTile * 0.5, uTile) - uTile * 0.5;
  vec2 xz = uCam.xz + rel;
  float dist = length(rel);
  vec2 huv = (xz - uHB.xy) / uHB.z;
  vec4 hm = texture2D(uHeight, huv);
  float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
  float m = hm.g * inside;
  float fade = 1.0 - smoothstep(uRadius * 0.65, uRadius, dist);
  float scale = m * fade;
  if (scale < 0.04) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // bỏ ngọn cỏ này

  float t = position.y;    // 0 = gốc, 1 = ngọn
  float H = uBladeH * (0.5 + 0.9 * iRand.x) * mix(0.35, 1.0, scale) * (0.75 + 0.5 * hm.b);
  float W = uBladeW * (0.7 + 0.6 * iRand.y) * (1.0 - pow(t, 1.5));

  // Hướng phiến lá: ngẫu nhiên nhưng nghiêng một nửa về phía camera để không bị "mỏng dính" khi nhìn ngang
  float ang = iRand.z * 6.28318;
  vec2 toCam = normalize(uCam.xz - xz + 1e-4);
  vec2 side = normalize(mix(vec2(cos(ang), sin(ang)), vec2(-toCam.y, toCam.x), 0.55));

  // Gió: sóng lớn chạy qua đồng cỏ + rung nhỏ từng ngọn
  float wave = sin(uTime * 1.1 - dot(xz, uWindDir) * 0.045) * 0.5 + 0.5;
  float flutter = sin(uTime * 3.2 + iRand.w * 6.28318 + dot(xz, uWindDir) * 0.3) * 0.5 + 0.5;
  float bend = uWind * (0.18 + 0.55 * wave * wave + 0.15 * flutter) + iRand.x * 0.12;
  vec2 lean = uWindDir * bend + vec2(cos(ang + 1.3), sin(ang + 1.3)) * 0.12;

  vec3 p = vec3(xz.x, hm.r - 0.15, xz.y);
  p.xz += side * position.x * W;
  p.y += t * H * (1.0 - 0.35 * bend * t);
  p.xz += lean * t * t * H;

  vT = t;
  vVar = hm.b * 0.6 + iRand.y * 0.4;
  vDist = distance(cameraPosition, p);
  vSide = position.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uDry;
uniform vec3 uSun;
uniform vec3 uAmb;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vT;
varying float vVar;
varying float vDist;
varying float vSide;
void main() {
  // Gốc đậm -> ngọn sáng, một số vùng ngả úa vàng
  vec3 tip = mix(uTip, uDry, smoothstep(0.62, 0.85, vVar));
  vec3 col = mix(uBase, tip, smoothstep(0.0, 1.0, pow(vT, 0.8)));
  // Ánh sáng giả: ngọn đón nắng nhiều hơn gốc, 2 mép phiến lá hơi khác sáng (nét vẽ tay)
  float light = 0.55 + 0.45 * vT + vSide * 0.08;
  col *= uAmb + uSun * light;
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Grass {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private time = 0;

  constructor(scene: THREE.Scene, private islands: Terrain) {
    // Phiến cỏ: 4 đoạn + chóp nhọn (9 đỉnh), y = 0..1 dọc thân, x = -0.5..0.5 bề ngang
    const SEG = 4;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < SEG; i++) { const t = i / SEG; pos.push(-0.5, t, 0, 0.5, t, 0); }
    pos.push(0, 1, 0);
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const tipI = SEG * 2;
    idx.push((SEG - 1) * 2, (SEG - 1) * 2 + 1, tipI);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const n = GRASS.count;
    const off = new Float32Array(n * 2), rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      off[i * 2] = Math.random() * GRASS.tile;
      off[i * 2 + 1] = Math.random() * GRASS.tile;
      rnd.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = n;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uHeight: { value: islands.getHeightTexture() },
        uHB: { value: new THREE.Vector3(HEIGHTMAP.minX, HEIGHTMAP.minZ, HEIGHTMAP.size) },
        uCam: { value: new THREE.Vector3() },
        uTile: { value: GRASS.tile },
        uRadius: { value: GRASS.radius },
        uTime: { value: 0 },
        uWindDir: { value: GRASS.windDir },
        uWind: { value: GRASS.windStrength },
        uBladeH: { value: GRASS.bladeHeight },
        uBladeW: { value: GRASS.bladeWidth },
        uBase: { value: new THREE.Color(COLORS.grassBase) },
        uTip: { value: new THREE.Color(COLORS.grassTip) },
        uDry: { value: new THREE.Color(COLORS.grassDry) },
        uSun: { value: new THREE.Color() },
        uAmb: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 1000 },
        uFogFar: { value: 7000 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, cam: THREE.Vector3, env: Environment): void {
    this.time += dt;
    // Bay cao quá thì tắt cỏ (từ xa chỉ thấy màu nền đảo, đỡ tốn GPU)
    const ground = Math.max(0, this.islands.heightAt(cam.x, cam.z));
    this.mesh.visible = cam.y - ground < GRASS.maxViewHeight;
    if (!this.mesh.visible) return;

    const u = this.material.uniforms;
    u.uCam.value.copy(cam);
    u.uTime.value = this.time;
    u.uSun.value.copy(env.c.sun).multiplyScalar(0.25 + 0.75 * env.dayFactor);
    u.uAmb.value.copy(env.c.ambient).multiplyScalar(0.35 + 0.25 * env.dayFactor);
    u.uFogColor.value.copy(env.fog.color);
    u.uFogNear.value = env.fog.near;
    u.uFogFar.value = env.fog.far;
  }
}
