// Dựng buồng lái low-poly bằng primitive: boong gỗ, lan can kem, thân cam gỉ sét,
// bánh lái, la bàn đồng, đèn mũi tàu, cờ, vỏ khí cầu phía trên.
// Trục: -Z là mũi tàu, boong ở y = 0.
// TODO: thay bằng model .glb (giữ tên các object trả về: wheel, needle, flag, lamp).
import * as THREE from 'three';
import { COLORS } from '../engine/sky/palette';
import { toon } from '../engine/render/toon';

export interface CockpitParts {
  root: THREE.Group;
  wheel: THREE.Group;
  needle: THREE.Group;
  flag: THREE.Mesh;
  lamp: THREE.MeshStandardMaterial;
  propeller: THREE.Group;
}

/** Thanh dầm nối 2 điểm. */
function beam(a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  return m;
}

export function buildCockpit(): CockpitParts {
  const root = new THREE.Group();
  const wood = toon(COLORS.wood), woodDark = toon(COLORS.woodDark), cream = toon(COLORS.hullCream);
  const hull = toon(COLORS.hull), brass = toon(COLORS.brass), env = toon(COLORS.envelope), stripe = toon(COLORS.envelopeStripe);

  // Boong + mũi nhọn
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 9), wood);
  deck.position.set(0, -0.15, -2.5);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.3, 2.55), wood);
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, -0.15, -7);
  // Thân tàu dưới boong (thấy khi nhìn qua lan can)
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.8, 9.4), hull);
  body.position.set(0, -1.1, -2.4);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.7, 1.8), hull);
  keel.rotation.y = Math.PI / 4;
  keel.scale.set(1, 0.66, 1);
  keel.position.set(0, -1.1, -7);
  root.add(deck, bow, body, keel);

  // Lan can
  const railY = 1.0;
  const pts = [
    new THREE.Vector3(-1.75, railY, 1.8), new THREE.Vector3(-1.75, railY, -6.2),
    new THREE.Vector3(0, railY, -8.8),
    new THREE.Vector3(1.75, railY, -6.2), new THREE.Vector3(1.75, railY, 1.8),
  ];
  for (let i = 0; i < pts.length - 1; i++) root.add(beam(pts[i], pts[i + 1], 0.12, cream));
  for (const x of [-1.75, 1.75]) {
    for (let z = 1.8; z >= -6.2; z -= 1.6) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, railY, 5), cream);
      post.position.set(x, railY / 2, z);
      root.add(post);
    }
  }

  // Bánh lái
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.1, 6), woodDark);
  stand.position.set(0, 0.55, -1.7);
  root.add(stand);
  const wheel = new THREE.Group();
  wheel.position.set(0, 1.2, -1.62);
  wheel.scale.setScalar(0.72);
  wheel.rotation.x = -0.35;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), woodDark);
  wheel.add(rim);
  // 4 nan xuyên tâm = 8 tay cầm nhô ra ngoài vành
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.42, 0.045), wood);
    spoke.rotation.z = (i * Math.PI) / 4;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), brass);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  root.add(wheel);

  // La bàn đồng
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.1, 6), woodDark);
  ped.position.set(0.95, 0.55, -1.25);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.12, 12), brass);
  bowl.position.set(0.95, 1.15, -1.25);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), cream);
  face.rotation.x = -Math.PI / 2;
  face.position.set(0.95, 1.215, -1.25);
  const needle = new THREE.Group();
  needle.position.set(0.95, 1.23, -1.25);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 4), hull);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.1;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 4), toon(0x3f8f98));
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 0.07;
  needle.add(tip, tail);
  root.add(ped, bowl, face, needle);

  // Cột mũi + đèn + cờ
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), woodDark);
  mast.position.set(0, 1.3, -8.4);
  const lamp = new THREE.MeshStandardMaterial({ color: COLORS.lantern, emissive: 0xffb04a, emissiveIntensity: 1 });
  const lampMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lamp);
  lampMesh.position.set(0, 2.1, -8.4);
  const flagGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, -0.25, 1.1),
  ]);
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshToonMaterial({ color: COLORS.hull, side: THREE.DoubleSide }));
  flag.position.set(0, 2.6, -8.4);
  root.add(mast, lampMesh, flag);

  // Vỏ khí cầu + 2 sọc cam
  const envelope = new THREE.Group();
  envelope.position.set(0, 10.5, -2.2);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), env);
  shell.scale.set(5, 4.2, 11);
  envelope.add(shell);
  for (const z of [-0.45, 0.35]) {
    const band = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), stripe);
    const k = Math.sqrt(1 - z * z);
    band.scale.set(5 * k + 0.05, 4.2 * k + 0.05, 0.9);
    band.position.z = z * 11;
    envelope.add(band);
  }
  // Đuôi khí cầu: vây đứng + vây ngang (thấy rõ ở camera góc 3)
  const finV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 3.2), stripe);
  finV.position.set(0, 2.2, 9.6);
  const finH = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 2.6), stripe);
  finH.position.set(0, 0, 9.6);
  envelope.add(finV, finH);
  root.add(envelope);

  // Đuôi thuyền + cánh quạt
  const stern = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5, 1.6), hull);
  stern.position.set(0, -0.9, 2.9);
  const propeller = new THREE.Group();
  propeller.position.set(0, -0.9, 3.9);
  const hubP = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 8), brass);
  hubP.rotation.x = Math.PI / 2;
  propeller.add(hubP);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.08), wood);
    blade.position.y = 0.9;
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI * 2) / 3;
    blade.rotation.y = 0.4;
    arm.add(blade);
    propeller.add(arm);
  }
  root.add(stern, propeller);

  // Dây néo
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x5e4a3a });
  for (const x of [-1, 1]) for (const z of [1.4, -2.5, -5.8]) {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x * 1.75, railY, z), new THREE.Vector3(x * 2.6, 7.2, z * 0.9 - 0.2),
    ]);
    root.add(new THREE.Line(g, ropeMat));
  }

  return { root, wheel, needle, flag, lamp, propeller };
}
