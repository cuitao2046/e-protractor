// components/protractor-dial/protractor-dial.js
// 复刻 iOS 指南针的盘面 + 量角器扩展：
//  - 盘面固定(世界坐标系)：刻度环/数字/NESW/中心暗圆/中心十字/顶部红 N 三角
//  - 红色弧 + 短粗白色线段：随 phoneHeading 旋转(表示手机当前朝向)
//  - 基准十字：固定在 baselineAngle(用户可设置，初始 0=正北)
Component({
  properties: {
    // 手机当前朝向（0-360），从 DeviceMotion alpha
    phoneHeading: { type: Number, value: 0, observer() { this._redraw(); } },
    // 基准线方向（0-360），初始 0（正北）
    baselineAngle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（靠近 0° 测量值，顶部三角/白线/红弧变绿）
    isSnap: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否已锁定基准线（锁定后才绘制基准十字）
    baselineSet: { type: Boolean, value: false, observer() { this._redraw(); } },
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
      const { phoneHeading, baselineAngle, isSnap, baselineSet } = this.properties;
      this._draw(phoneHeading || 0, baselineAngle || 0, !!isSnap, !!baselineSet);
    },

    _draw(phoneHeading, baselineAngle, isSnap, baselineSet) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      // 内缩 20rpx，给数字留出外侧空间
      const R = Math.min(W, H) / 2 - 20;
      if (R <= 0) return;

      ctx.clearRect(0, 0, W, H);

      // —— 1. 外圈底盘（仿 iOS 暗灰）——
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1c1e';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#2c2c2e';
      ctx.stroke();

      // —— 2. 刻度环（固定，仿 iOS：1°细/5°中/10°粗/30°主)——
      for (let d = 0; d < 360; d++) {
        const rad = (d * Math.PI) / 180;
        const isMajor = d % 30 === 0;
        const isMedium = d % 10 === 0;
        const isMinor = d % 5 === 0;
        const rIn = R - (isMajor ? 18 : (isMedium ? 10 : (isMinor ? 6 : 3)));
        const rOut = R - 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(rad) * rIn, cy - Math.cos(rad) * rIn);
        ctx.lineTo(cx + Math.sin(rad) * rOut, cy - Math.cos(rad) * rOut);
        ctx.lineWidth = isMajor ? 1.5 : (isMedium ? 1 : 0.5);
        ctx.strokeStyle = isMajor ? '#ffffff' : (isMedium ? '#9ca3af' : '#6b7280');
        ctx.stroke();
      }

      // —— 3. 数字（固定，30° 间隔，刻度环外侧）——
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 30) {
        const rad = (d * Math.PI) / 180;
        const rText = R + 12;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillText(String(d), x, y);
      }

      // —— 4. 方位字（固定，刻度环内侧；北为红色）——
      const cardinals = [
        { d: 0, label: '北', color: '#ff3b30' },
        { d: 90, label: '东', color: '#ffffff' },
        { d: 180, label: '南', color: '#ffffff' },
        { d: 270, label: '西', color: '#ffffff' },
      ];
      ctx.font = '600 16px sans-serif';
      for (const c of cardinals) {
        const rad = (c.d * Math.PI) / 180;
        const rText = R - 36;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, x, y);
      }

      // —— 5. 中心暗圆 + 中心十字（固定）——
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - R * 0.1, cy);
      ctx.lineTo(cx + R * 0.1, cy);
      ctx.moveTo(cx, cy - R * 0.1);
      ctx.lineTo(cx, cy + R * 0.1);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = '#4b5563';
      ctx.stroke();

      // —— 6. 顶部固定红色 N 三角（指向圆心；磁吸绿 > 默认红）——
      const triColor = isSnap ? '#4ade80' : '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 2);
      ctx.lineTo(cx - 5, cy - R + 14);
      ctx.lineTo(cx + 5, cy - R + 14);
      ctx.closePath();
      ctx.fillStyle = triColor;
      ctx.fill();

      // —— 7. 基准十字（固定，方向 = baselineAngle，色系与盘面线条一致）——
      if (baselineSet) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((baselineAngle * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -(R - 2));
        ctx.lineTo(0, R - 2);
        ctx.moveTo(-(R - 2), 0);
        ctx.lineTo(R - 2, 0);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = isSnap ? 'rgba(74, 222, 128, 0.5)' : 'rgba(255, 255, 255, 0.35)';
        ctx.stroke();
        ctx.restore();
      }

      // —— 8. 红色弧 + 短粗白色线段（随 phoneHeading 旋转，表示手机当前朝向）——
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((phoneHeading * Math.PI) / 180);

      // 红色弧（约 30° 宽，居于 phoneHeading 两侧各 15°）
      const arcWidth = 0.26;
      ctx.beginPath();
      ctx.arc(0, 0, R - 2, -arcWidth, arcWidth);
      ctx.lineWidth = 4;
      ctx.strokeStyle = isSnap ? '#4ade80' : '#ff3b30';
      ctx.stroke();

      // 白色短粗线段（从外沿向内延伸到约 82% 半径）
      ctx.beginPath();
      ctx.moveTo(0, -(R - 2));
      ctx.lineTo(0, -R * 0.82);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.restore();
    },
  },
});
