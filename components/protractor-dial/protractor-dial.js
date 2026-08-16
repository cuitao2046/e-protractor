// components/protractor-dial/protractor-dial.js
// 拟物仪表盘：Canvas 2D 绘制旋转刻度环 + 基准指针 + 实时弧度填充 + 磁吸高亮
Component({
  properties: {
    // 相对基准线的角度（度），范围 [-180, 180]
    angle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（高亮变绿）
    isSnap: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否 Auto-Hold 锁定
    holdLatched: { type: Boolean, value: false, observer() { this._redraw(); } },
  },

  data: {},

  lifetimes: {
    attached() {
      this._inited = false;
      this._initCanvas();
    },
    detached() {
      this.canvas = null;
      this.ctx = null;
    },
  },

  methods: {
    _initCanvas() {
      const query = this.createSelectorQuery();
      query
        .select('#dialCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);
          this.canvas = canvas;
          this.ctx = ctx;
          this.W = res[0].width;
          this.H = res[0].height;
          this._inited = true;
          this._redraw();
        });
    },

    _redraw() {
      if (!this._inited || !this.ctx) return;
      const { angle, isSnap, holdLatched } = this.properties;
      this._draw(angle || 0, !!isSnap, !!holdLatched);
    },

    _draw(angle, isSnap, holdLatched) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 8;

      ctx.clearRect(0, 0, W, H);

      // 背景圆盘（毛玻璃感：半透明填充 + 描边）
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18, 24, 38, 0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isSnap ? '#4ade80' : (holdLatched ? '#f59e0b' : '#2b3550');
      ctx.stroke();

      const accent = isSnap ? '#4ade80' : '#38bdf8';
      const arcColor = isSnap ? 'rgba(74, 222, 128, 0.18)' : 'rgba(56, 189, 248, 0.16)';

      // —— 旋转刻度环（每 5° 一格，每 30° 主刻度）——
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-angle * Math.PI) / 180); // 随相对角反向微转，模拟机械表盘
      for (let d = 0; d < 360; d += 5) {
        const isMajor = d % 30 === 0;
        const rad = (d * Math.PI) / 180;
        const r1 = R - (isMajor ? 26 : 14);
        const r2 = R - 2;
        ctx.beginPath();
        ctx.moveTo(Math.sin(rad) * r1, -Math.cos(rad) * r1);
        ctx.lineTo(Math.sin(rad) * r2, -Math.cos(rad) * r2);
        ctx.lineWidth = isMajor ? 3 : 1.5;
        ctx.strokeStyle = isMajor ? '#cbd5e1' : '#475569';
        ctx.stroke();
      }
      ctx.restore();

      // —— 实时弧度填充（从基准线 0° 扫到当前角）——
      const aRad = (angle * Math.PI) / 180;
      const rArc = R * 0.72;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(cx, cy, rArc, -Math.PI / 2, -Math.PI / 2 + aRad, angle < 0);
      ctx.closePath();
      ctx.fillStyle = arcColor;
      ctx.fill();
      // 弧边描线
      ctx.beginPath();
      ctx.arc(cx, cy, rArc, -Math.PI / 2, -Math.PI / 2 + aRad, angle < 0);
      ctx.lineWidth = 3;
      ctx.strokeStyle = accent;
      ctx.stroke();

      // —— 固定基准指针（顶部，amber 虚线感三角）——
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 2);
      ctx.lineTo(cx - 9, cy - R + 22);
      ctx.lineTo(cx + 9, cy - R + 22);
      ctx.closePath();
      ctx.fillStyle = '#f59e0b';
      ctx.fill();

      // —— 中心轴点 ——
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = isSnap ? '#4ade80' : '#38bdf8';
      ctx.fill();

      // —— 当前角端点指示点 ——
      const ex = cx + Math.sin(aRad) * rArc;
      const ey = cy - Math.cos(aRad) * rArc;
      ctx.beginPath();
      ctx.arc(ex, ey, 6, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    },
  },
});
