// Bảng tự lái: luôn hiện khi tàu đang tự lái và nhân vật ở trên tàu.
// Bấm chuột để chọn đích, kéo thanh trượt để đặt độ cao + tốc độ, nút dừng tự lái.
// Giá trị ghi thẳng vào AUTOPILOT nên tự lái đổi theo ngay (và bảng G cũng lưu lại).
import { AUTOPILOT, AUTOPILOT_MAX_ALT, AUTOPILOT_MAX_SPEED, DESTINATIONS, type Autopilot, type Destination } from './Autopilot';
import type { Ship } from './Ship';

const STYLE = `
.ap { position: absolute; right: 12px; top: 12px; width: 250px; pointer-events: auto; display: none; font-size: 13px; padding: 10px 14px 12px; }
.ap.show { display: block; }
.ap h3 { margin: 0 0 2px; font-size: 16px; display: flex; justify-content: space-between; align-items: baseline; }
.ap h3 small { font-size: 11px; color: var(--ink-soft); font-weight: 700; }
.ap .st { color: var(--ink-soft); font-weight: 700; min-height: 18px; margin-bottom: 6px; }
.ap label { display: flex; justify-content: space-between; font-weight: 800; margin-top: 8px; }
.ap label b { color: var(--rust); font-variant-numeric: tabular-nums; }
.ap input[type=range] { width: 100%; accent-color: var(--rust); margin: 4px 0 0; cursor: pointer; }
.ap .ticks { display: flex; justify-content: space-between; font-size: 10px; color: var(--ink-soft); font-weight: 700; }
.ap .dests { display: grid; gap: 4px; margin-top: 10px; }
.ap button { font: inherit; font-weight: 800; text-align: left; border: 2px solid rgba(74,52,38,.18); background: rgba(255,255,255,.35);
  color: var(--ink); border-radius: 9px; padding: 4px 9px; cursor: pointer; }
.ap button:hover { background: rgba(255,255,255,.7); }
.ap button.on { background: var(--teal); border-color: var(--teal); color: #fff; }
.ap button.stop { margin-top: 10px; width: 100%; text-align: center; background: var(--rust); border-color: var(--rust); color: #fff; }
`;

export class AutopilotPanel {
  private el: HTMLElement;
  private stEl: HTMLElement;
  private altIn: HTMLInputElement;
  private altVal: HTMLElement;
  private spdIn: HTMLInputElement;
  private spdVal: HTMLElement;
  private buttons: { dest: Destination | null; el: HTMLButtonElement }[] = [];
  private shown = false;

  constructor(root: HTMLElement, private ap: Autopilot, private ship: Ship, onStop: () => void, onPick: (d: Destination | null) => void) {
    const st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.className = 'panel ap';
    this.el.innerHTML = `
      <h3>Tự lái <small>bấm chuột để chỉnh</small></h3>
      <div class="st"></div>
      <label>Độ cao <b class="alt"></b></label>
      <input type="range" class="altIn" min="0" max="${AUTOPILOT_MAX_ALT}" step="5">
      <div class="ticks"><span>mặt nước</span><span>${AUTOPILOT_MAX_ALT} m</span></div>
      <label>Tốc độ <b class="spd"></b></label>
      <input type="range" class="spdIn" min="2" max="${AUTOPILOT_MAX_SPEED}" step="1">
      <div class="ticks"><span>chậm</span><span>${AUTOPILOT_MAX_SPEED} m/s</span></div>
      <div class="dests"></div>
      <button class="stop">Dừng tự lái</button>`;
    root.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.stEl = q('.st'); this.altVal = q('.alt'); this.spdVal = q('.spd');
    this.altIn = q<HTMLInputElement>('.altIn'); this.spdIn = q<HTMLInputElement>('.spdIn');

    this.altIn.addEventListener('input', () => { AUTOPILOT.altitude = Number(this.altIn.value); this.sync(); });
    this.spdIn.addEventListener('input', () => { AUTOPILOT.speed = Number(this.spdIn.value); this.sync(); });
    // thả chuột ra là trả focus cho game (để W/A/S/D, E… không bị thanh trượt giữ)
    for (const i of [this.altIn, this.spdIn]) i.addEventListener('change', () => i.blur());

    const list = q('.dests');
    for (const d of [...DESTINATIONS, null]) {
      const b = document.createElement('button');
      b.textContent = d ? d.name : 'Giữ hướng hiện tại';
      b.addEventListener('click', () => { onPick(d); b.blur(); this.sync(); });
      list.appendChild(b);
      this.buttons.push({ dest: d, el: b });
    }
    q<HTMLButtonElement>('.stop').addEventListener('click', (e) => { onStop(); (e.currentTarget as HTMLElement).blur(); });
    // bấm trong bảng không làm xoay camera / không lọt xuống game
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** show: có hiện bảng không (game quyết định: đang tự lái + đang ở trên tàu). */
  update(show: boolean): void {
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('show', show);
      if (show) this.sync();
    }
    if (!show) return;
    // giá trị đổi từ chỗ khác (bảng G): cập nhật lại thanh trượt
    if (Number(this.altIn.value) !== AUTOPILOT.altitude || Number(this.spdIn.value) !== AUTOPILOT.speed) this.sync();
    for (const b of this.buttons) b.el.classList.toggle('on', this.ap.dest === b.dest);
    this.stEl.textContent = `${this.ap.status(this.ship).replace(/^Tự lái\s*[·→]?\s*/, '')} · đang ${Math.round(this.ship.position.y)} m, ${Math.round(this.ship.speed)} m/s`;
  }

  private sync(): void {
    this.altIn.value = String(AUTOPILOT.altitude);
    this.spdIn.value = String(AUTOPILOT.speed);
    this.altVal.textContent = AUTOPILOT.altitude <= 0 ? 'mặt nước' : `${AUTOPILOT.altitude} m`;
    this.spdVal.textContent = `${AUTOPILOT.speed} m/s`;
    for (const b of this.buttons) b.el.classList.toggle('on', this.ap.active && this.ap.dest === b.dest);
  }
}
