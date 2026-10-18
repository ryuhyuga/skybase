// Bờ đảo theo bài Codrops (Terrain/Rocks fragment): tô lên chính địa hình tại độ cao mực nước.
// - Cát ướt: sẫm lại trong khoảng ~10 m trên mực nước.
// - Dưới nước: ngả dần về màu đáy biển.
// - Dải bọt trắng ở đúng mực nước đang nhấp nhô (cùng hàm sin với mặt nước) -> sóng vỗ bờ, không cần depth pass.
import * as THREE from 'three';
import { waterShared, WATER } from './Ocean';

/** Vá shader của 1 material đảo (toon/standard) để có bờ biển kiểu Codrops. Giữ onBeforeCompile cũ nếu có. */
export function applyShoreline(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev.call(mat, sh, renderer);
    Object.assign(sh.uniforms, waterShared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vShoreY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShoreY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vShoreY;
uniform float uTime; uniform float uWaterLevel; uniform float uWaveSpeed; uniform float uWaveAmplitude;
uniform float uFoamDepth; uniform vec3 uUnderwaterColor; uniform float uSeabed; uniform float uFoamLight;
uniform float uShoreFoamOp; uniform float uShoreFadeStart; uniform float uShoreFadeEnd;`)
      .replace('#include <emissivemap_fragment>', `{
  float wetH = ${(WATER.worldScale * 1.0).toFixed(1)};
  // Cát ướt
  float heightFactor = smoothstep(uWaterLevel + wetH, uWaterLevel, vShoreY);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, heightFactor);
  // Phần chìm dưới nước ngả về màu đáy biển
  float oceanFactor = smoothstep(uWaterLevel - 4.0, uSeabed, vShoreY);
  diffuseColor.rgb = mix(diffuseColor.rgb, uUnderwaterColor, oceanFactor);
  // Dải bọt ở mực nước đang nhấp nhô
  float currentWaterHeight = uWaterLevel + sin(uTime * uWaveSpeed) * uWaveAmplitude;
  float e = 0.1;
  float stripe = smoothstep(currentWaterHeight + e, currentWaterHeight - e, vShoreY)
               - smoothstep(currentWaterHeight + uFoamDepth + e, currentWaterHeight + uFoamDepth - e, vShoreY);
  // Bay càng cao dải bọt càng nhạt (từ xa nhìn xuống nó thành viền trắng cứng)
  float camH = cameraPosition.y - uWaterLevel;
  stripe *= uShoreFoamOp * (1.0 - smoothstep(uShoreFadeStart, uShoreFadeEnd, camH));
  diffuseColor.rgb = mix(diffuseColor.rgb - stripe * 0.5, vec3(uFoamLight), stripe);
}
#include <emissivemap_fragment>`);
  };
  // Three.js gom chương trình shader theo onBeforeCompile.toString(); hàm bọc này giống nhau cho mọi material
  // -> phải tự tạo khoá riêng, nếu không Santorini (có tầng đá) sẽ dùng nhầm shader của đảo thường.
  const prevKey = prev.toString();
  mat.customProgramCacheKey = () => `shore|${prevKey}`;
  mat.needsUpdate = true;
}
