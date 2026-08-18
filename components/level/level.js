// components/level/level.js
// iOS 风格水平仪组件
//
// 平放模式（|beta| < 50°，手机面朝上）：
//  - 外圈固定白色圆环
//  - 内部深灰圆盘 + 中心小十字（+），随倾斜移动，接近时重合
//  - 完全水平时整体变绿
//
// 竖放模式（|beta| >= 50°，手机立起）：
//  - 中央水平参考线
//  - 气泡沿水平线滚动，表示左右倾斜
Component({
  properties: {
    beta: { type: Number, value: 0, observer() { this._redraw(); } },
    gamma: { type: Number, value: 0, observer() { this._redraw(); } },
  },

  data: {},

  lifetimes: {
    attached() {
      this._inited = false;
      this._initCanvas();
    },
    ready() {
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
        .select('#levelCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const w = res[0].width || 0;
          const h = res[0].height || 0;
          if (w <= 0 || h <= 0) {
            setTimeout(() => this._initCanvas(), 60);
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.scale(dpr, dpr);
          this.canvas = canvas;
          this.ctx = ctx;
          this.W = w;
          this.H = h;
          this._inited = true;
          this._redraw();
        });
    },

    _redraw() {
      if (!this._inited || !this.ctx) return;
      const { beta, gamma } = this.properties;
      this._draw(beta || 0, gamma || 0);
    },

    _draw(beta, gamma) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.min(W, H) / 2 - 12;

      ctx.clearRect(0, 0, W, H);

      // 平放 / 竖放判断
      const isFlat = Math.abs(beta) < 50;
      const tilt = isFlat
        ? Math.sqrt(beta * beta + gamma * gamma)
        : Math.abs(gamma);
      const isLevel = tilt < 0.3;
      const accent = isLevel ? '#30D158' : '#FFFFFF';

      if (isFlat) {
        // ============ 平放模式：外圈 + 灰盘气泡 ============
        const outerCircleR = maxR * 0.42;   // 外圈半径
        const diskR = maxR * 0.22;          // 灰盘半径

        // 外圈固定白环
        ctx.beginPath();
        ctx.arc(cx, cy, outerCircleR, 0, Math.PI * 2);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = accent;
        ctx.stroke();

        // 灰盘偏移（朝倾斜方向，微妙）
        const sens = maxR * 0.75 / 40;
        let bx = cx + gamma * sens;
        let by = cy + beta * sens;
        const maxDist = outerCircleR - diskR - maxR * 0.03;
        const dx = bx - cx, dy = by - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist && dist > 0) {
          bx = cx + dx / dist * maxDist;
          by = cy + dy / dist * maxDist;
        }

        // 灰色圆盘
        ctx.beginPath();
        ctx.arc(bx, by, diskR, 0, Math.PI * 2);
        ctx.fillStyle = '#1C1C1E';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = accent;
        ctx.stroke();

        // 灰盘中心小十字 (+)，粗细与罗盘细刻度线一致（0.5px）
        const armHalf = diskR * 0.55;
        const notch = diskR * 0.2;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bx - armHalf, by);
        ctx.lineTo(bx - notch, by);
        ctx.moveTo(bx + notch, by);
        ctx.lineTo(bx + armHalf, by);
        ctx.moveTo(bx, by - armHalf);
        ctx.lineTo(bx, by - notch);
        ctx.moveTo(bx, by + notch);
        ctx.lineTo(bx, by + armHalf);
        ctx.stroke();
      } else {
        // ============ 竖放模式：单轴水平线 ============
        const lineHalf = maxR * 0.8;

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(cx - lineHalf, cy - 0.5, lineHalf * 2, 1);

        // 中心竖刻度
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(cx - 0.5, cy - 10, 1, 20);

        // 两端刻度
        ctx.fillRect(cx - lineHalf - 0.5, cy - 5, 1, 10);
        ctx.fillRect(cx + lineHalf - 0.5, cy - 5, 1, 10);

        // 气泡（沿水平线滚动）
        const sensX = lineHalf / 40;
        let px = cx + gamma * sensX;
        px = Math.max(cx - lineHalf, Math.min(cx + lineHalf, px));

        ctx.beginPath();
        ctx.arc(px, cy, 10, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();

        // 气泡中心深色点
        ctx.beginPath();
        ctx.arc(px, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();
      }
    },
  },
});