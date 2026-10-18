// Hậu kỳ: bloom (toả sáng) kiểu anime cho mặt trời, đèn lồng, cột sáng và viền mây sáng nhất.
// Render scene vào render target HDR (HalfFloat, có MSAA) -> bloom -> OutputPass (đổi sang sRGB).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Chỉnh độ bloom ở đây. */
export const BLOOM = {
  enabled: true,
  strength: 0.45,    // độ mạnh
  radius: 0.65,      // độ loang
  threshold: 0.93,   // chỉ vùng sáng hơn ngưỡng này mới toả (màu linear; mây trắng ~0.9 nên không bị loá)
  nightBoost: 0.35,  // ban đêm tăng thêm để đèn lồng nổi hơn
  nightThresholdDrop: 0.25, // ban đêm hạ ngưỡng (đêm tối hơn)
};

export class PostFX {
  enabled = true;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Chèn pass ngay sau RenderPass (trước bloom), ví dụ ghép mây volumetric. */
  insertAfterScene(pass: Pass): void {
    this.composer.insertPass(pass, 1);
  }

  /** Chèn pass ngay trước OutputPass (sau bloom), ví dụ speed lines. */
  insertBeforeOutput(pass: Pass): void {
    this.composer.insertPass(pass, this.composer.passes.length - 1);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** night: 0 = ngày, 1 = đêm. */
  render(night: number, dt: number): void {
    this.bloom.enabled = this.enabled && BLOOM.enabled;
    this.bloom.strength = BLOOM.strength + BLOOM.nightBoost * night;
    this.bloom.threshold = BLOOM.threshold - BLOOM.nightThresholdDrop * night; // đêm tối hơn nên hạ ngưỡng
    this.bloom.radius = BLOOM.radius;
    this.composer.render(dt);
  }
}
