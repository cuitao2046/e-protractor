// components/protractor-dial/protractor-dial.js
// 复刻 iOS 指南针的盘面 + 量角器扩展：
//  - 盘面整体随手机旋转(rotate=-phoneHeading)：刻度环/数字/NESW 都转到正确世界方位
//  - phoneHeading 处的红色扇形带(填充扇区) + 白色短粗线段
//  - 顶部固定红色 N 三角(进刻度环内侧) + 中心暗圆十字(手机水平时变绿=水平仪)
//  - 基准十字：固定在 baselineAngle(屏幕坐标系)
Component({
  properties: {
    // 手机当前朝向（0-360），从 DeviceMotion alpha
    phoneHeading: { type: Number, value: 0, observer() { this._redraw(); } },
    // 基准线方向（0-360），初始 0（正北）
    baselineAngle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（靠近 0° 测量值，N 三角/红弧/白线变绿）
    isSnap: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否已锁定基准线（锁定后才绘制基准十字）
    baselineSet: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否水平（|beta|<2 且 |gamma|<2），中心十字变绿
    isLevel: { type: Boolean, value: false, observer() { this._redraw(); } },
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
      const { phoneHeading, baselineAngle, isSnap, baselineSet, isLevel } = this.properties;
      this._draw(
        phoneHeading || 0,
        baselineAngle || 0,
        !!isSnap,
        !!baselineSet,
        !!isLevel
      );
    },

    _draw(phoneHeading, baselineAngle, isSnap, baselineSet, isLevel) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
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

      // —— 2. 旋转的盘面（随 phoneHeading 旋转，NESW 指向真实世界方位）——
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-phoneHeading * Math.PI) / 180);

      // 2a. 红色扇形带（仿 iOS：phoneHeading 两侧各约 15° 的填充扇区）
      const sectorHalf = 0.26; // radians
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R - 1, -sectorHalf, sectorHalf);
      ctx.closePath();
      ctx.fillStyle = isSnap ? 'rgba(74, 222, 128, 0.55)' : 'rgba(255, 59, 48, 0.55)';
      ctx.fill();

      // 2b. 刻度环（1°/5°/10°/30°）
      for (let d = 0; d < 360; d++) {
        const rad = (d * Math.PI) / 180;
        const isMajor = d % 30 === 0;
        const isMedium = d % 10 === 0;
        const isMinor = d % 5 === 0;
        const rIn = R - (isMajor ? 18 : (isMedium ? 10 : (isMinor ? 6 : 3)));
        const rOut = R - 1;
        ctx.beginPath();
        ctx.moveTo(Math.sin(rad) * rIn, -Math.cos(rad) * rIn);
        ctx.lineTo(Math.sin(rad) * rOut, -Math.cos(rad) * rOut);
        ctx.lineWidth = isMajor ? 1.5 : (isMedium ? 1 : 0.5);
        ctx.strokeStyle = isMajor ? '#ffffff' : (isMedium ? '#9ca3af' : '#6b7280');
        ctx.stroke();
      }

      // 2c. 数字（30° 间隔，刻度环外侧）
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 30) {
        const rad = (d * Math.PI) / 180;
        const rText = R + 12;
        const x = Math.sin(rad) * rText;
        const y = -Math.cos(rad) * rText;
        ctx.fillText(String(d), x, y);
      }

      // 2d. 方位字（北红/东南西白，刻度环内侧）
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
        const x = Math.sin(rad) * rText;
        const y = -Math.cos(rad) * rText;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, x, y);
      }

      ctx.restore();

      // —— 3. 中心暗圆 + 中心十字（水平仪：手机水平时十字变绿）——
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - R * 0.1, cy);
      ctx.lineTo(cx + R * 0.1, cy);
      ctx.moveTo(cx, cy - R * 0.1);
      ctx.lineTo(cx, cy + R * 0.1);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = isLevel ? '#4ade80' : '#4b5563';
      ctx.stroke();

      // —— 4. 顶部固定红色 N 三角（进刻度环内侧，磁吸时变绿）——
      const triColor = isSnap ? '#4ade80' : '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 18);     // 尖端比之前更靠内
      ctx.lineTo(cx - 5, cy - R + 30);
      ctx.lineTo(cx + 5, cy - R + 30);
      ctx.closePath();
      ctx.fillStyle = triColor;
      ctx.fill();

      // —— 5. 白色短粗线段（紧贴 N 三角下方，固定表示当前手机朝向=顶部）——
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 32);
      ctx.lineTo(cx, cy - R + 46);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // —— 6. 基准十字（固定在屏幕坐标 baselineAngle，色系与盘面线条一致）——
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
    },
  },
});
