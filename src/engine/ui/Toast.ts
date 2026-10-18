// Thông báo ngắn giữa màn hình (tự biến mất). Không phụ thuộc CSS của game.
const STYLE = `
.sb-toasts { position: fixed; top: 66px; left: 0; right: 0; display: grid; justify-items: center; gap: 6px; pointer-events: none; z-index: 15; font-family: 'Nunito', system-ui, sans-serif; }
.sb-toast { background: rgba(241, 230, 203, 0.92); color: #4a3426; font-weight: 800; padding: 8px 14px; border-radius: 14px;
  border: 2px solid rgba(74, 52, 38, 0.25); box-shadow: 0 4px 0 rgba(74, 52, 38, 0.18); animation: sb-toast 3.2s ease forwards; }
@keyframes sb-toast { 0% { opacity: 0; transform: translateY(-6px); } 8% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; } }`;

export class Toast {
  private root: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById('sb-toast-style')) {
      const s = document.createElement('style');
      s.id = 'sb-toast-style';
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.className = 'sb-toasts';
    parent.appendChild(this.root);
  }

  show(msg: string): void {
    const el = document.createElement('div');
    el.className = 'sb-toast';
    el.textContent = msg;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }
}
