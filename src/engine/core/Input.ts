// Gom input bàn phím + chuột. Dùng KeyboardEvent.code để không phụ thuộc bộ gõ (Unikey...).
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  dragging = false;

  constructor(dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // Đang gõ trong ô nhập (bảng chỉnh) thì không điều khiển tàu
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.code === 'Space' || e.code === 'F1' || e.code.startsWith('Arrow')) e.preventDefault(); // F1: không mở trợ giúp của trình duyệt
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', (e) => {
      this.dragging = false;
      dom.releasePointerCapture(e.pointerId);
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Gọi cuối mỗi frame. */
  endFrame(): void {
    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
  }
}
