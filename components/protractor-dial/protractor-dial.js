// components/protractor-dial/protractor-dial.js
// iOS 指南针风格罗盘盘面：旋转刻度 + 正向数字/方位 + 固定顶部红针 + 中心十字
Component({
  properties: {
    // 相对基准线的角度（度），范围 [-180, 180]
    angle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（顶部指针变绿）
    isSnap: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否 Auto-Hold 锁定（可扩展视觉，当前不改变盘面）
    holdLatched: { type: Boolean, value: false, observer() { this._redraw(); } },
  },

  data: {},

  lifetimes: {
    attached() {
      this._inited = false;
      this._initCanvas();
    },
    ready() {
      // 布局完成后再取一次节点尺寸，作为兜底
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
          const w = res[0].width || 0;
          const h = res[0].height || 0;
          if (w <= 0 || h <= 0) {
            // 布局尚未完成，稍后重试，避免永久不绘制
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
      const { angle, isSnap, holdLatched } = this.properties;
      this._draw(angle || 0, !!isSnap, !!holdLatched);
    },

    _draw(angle, isSnap, holdLatched) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 10;
      if (R <= 0) return; // 尺寸未就绪时直接跳过，避免负半径抛异常
      const dialRad = (-angle * Math.PI) / 180;

      ctx.clearRect(0, 0, W, H);

      // 外圈底盘
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2c2c2e';
      ctx.stroke();

      // —— 旋转刻度环 ——
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(dialRad);
      for (let d = 0; d < 360; d++) {
        const rad = (d * Math.PI) / 180;
        const isMajor = d % 10 === 0;
        const isMedium = d % 5 === 0;
        const rIn = R - (isMajor ? 22 : (isMedium ? 14 : 8));
        const rOut = R - 2;
        ctx.beginPath();
        ctx.moveTo(Math.sin(rad) * rIn, -Math.cos(rad) * rIn);
        ctx.lineTo(Math.sin(rad) * rOut, -Math.cos(rad) * rOut);
        ctx.lineWidth = isMajor ? 2 : 1;
        ctx.strokeStyle = isMajor ? '#ffffff' : '#6b7280';
        ctx.stroke();
      }
      ctx.restore();

      // —— 正向数字（每 30°）——
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 30) {
        const screenAngle = d - angle;
        const rad = (screenAngle * Math.PI) / 180;
        const rText = R - 38;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillText(String(d), x, y);
      }

      // —— 方位字（北/东/南/西）——
      const cardinals = [
        { d: 0, label: '北', color: '#ef4444' },
        { d: 90, label: '东', color: '#ffffff' },
        { d: 180, label: '南', color: '#ffffff' },
        { d: 270, label: '西', color: '#ffffff' },
      ];
      ctx.font = '700 18px sans-serif';
      for (const c of cardinals) {
        const screenAngle = c.d - angle;
        const rad = (screenAngle * Math.PI) / 180;
        const rText = R - 64;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, x, y);
      }

      // —— 中心暗圆 + 十字线（固定不转）——
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1c1e';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.12, cy);
      ctx.lineTo(cx + R * 0.12, cy);
      ctx.moveTo(cx, cy - R * 0.12);
      ctx.lineTo(cx, cy + R * 0.12);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#3a3a3c';
      ctx.stroke();

      // —— 顶部固定指向标（iOS 指南针红三角）——
      const markerColor = isSnap ? '#4ade80' : '#ef4444';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 4);
      ctx.lineTo(cx - 10, cy - R + 30);
      ctx.lineTo(cx + 10, cy - R + 30);
      ctx.closePath();
      ctx.fillStyle = markerColor;
      ctx.fill();

      // 顶部竖线（与红三角同宽，强调指向）
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 30);
      ctx.lineTo(cx, cy - R + 48);
      ctx.lineWidth = 2;
      ctx.strokeStyle = markerColor;
      ctx.stroke();

      // 锁定状态小点
      if (holdLatched) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    },
  },
});
