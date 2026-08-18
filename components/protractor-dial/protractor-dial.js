// components/protractor-dial/protractor-dial.js
// 严格复刻 iOS 指南针 + 量角器扩展
//
// 旋转层（与盘面绑定）：
//  - 盘面(刻度环 + 30°间隔数字)绕 baselineAngle 旋转，让 0° 数字落在基准线上
//  - 红色弧 + 短粗白色线段绕 phoneHeading 旋转，标记手机当前朝向
//
// 固定层（屏幕坐标系）：
//  - NESW 方位字：顶/右/底/左，不随盘面转
//  - 顶部红色 N 三角：在刻度环内侧，永远指正北
//  - 中心暗圆 + 十字 + 水平仪气泡
//  - 基准十字：vertical+horizontal，穿过圆心
Component({
  properties: {
    // 手机当前朝向（0-360），从 DeviceMotion alpha
    phoneHeading: { type: Number, value: 0, observer() { this._redraw(); } },
    // 基准线方向（0-360），初始 0（正北）；盘面绕此旋转
    baselineAngle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 俯仰角 beta（X 轴），水平仪气泡 y 偏移
    beta: { type: Number, value: 0, observer() { this._redraw(); } },
    // 横滚角 gamma（Y 轴），水平仪气泡 x 偏移
    gamma: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（靠近 0° 测量值，顶部三角/红弧/白针变绿）
    isSnap: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 是否已锁定基准线
    baselineSet: { type: Boolean, value: false, observer() { this._redraw(); } },
    // 手机接近水平（|beta|<2 且 |gamma|<2）
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
      const { phoneHeading, baselineAngle, beta, gamma, isSnap, baselineSet, isLevel } = this.properties;
      this._draw(
        phoneHeading || 0,
        baselineAngle || 0,
        beta || 0,
        gamma || 0,
        !!isSnap,
        !!baselineSet,
        !!isLevel
      );
    },

    _draw(phoneHeading, baselineAngle, beta, gamma, isSnap, baselineSet, isLevel) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 20; // 内缩 20，给数字留外侧空间
      if (R <= 0) return;

      ctx.clearRect(0, 0, W, H);

      // ====================== 1. 外圈底盘（固定） ======================
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1c1e';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#2c2c2e';
      ctx.stroke();

      // ====================== 2. 旋转层：盘面(刻度环 + 30°数字) ======================
      // 盘面绕 baselineAngle 旋转，让 0° 数字永远落在基准方向
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((baselineAngle * Math.PI) / 180);

      // 刻度环：1° 细 / 5° 中 / 10° 粗 / 30° 主
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

      // 30° 间隔数字，位于刻度环外侧
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

      ctx.restore();
      // ====================== 旋转层结束 ======================

      // ====================== 3. 固定层：NESW 方位字 ======================
      // NESW 必须在屏幕固定位置（顶/右/底/左），不随盘面转
      const cardinals = [
        { d: 0, label: '北', color: '#ff3b30' },
        { d: 90, label: '东', color: '#ffffff' },
        { d: 180, label: '南', color: '#ffffff' },
        { d: 270, label: '西', color: '#ffffff' },
      ];
      ctx.font = '700 20px sans-serif';
      for (const c of cardinals) {
        const rad = (c.d * Math.PI) / 180;
        const rText = R - 40;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, x, y);
      }

      // ====================== 4. 固定层：顶部红色 N 三角 ======================
      // 位于刻度环内侧(NESW 之上)，永远指正北
      const triColor = isSnap ? '#4ade80' : '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 22);
      ctx.lineTo(cx - 6, cy - R + 36);
      ctx.lineTo(cx + 6, cy - R + 36);
      ctx.closePath();
      ctx.fillStyle = triColor;
      ctx.fill();

      // ====================== 5. 固定层：中心暗圆 + 十字 ======================
      const innerR = R * 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - R * 0.12, cy);
      ctx.lineTo(cx + R * 0.12, cy);
      ctx.moveTo(cx, cy - R * 0.12);
      ctx.lineTo(cx, cy + R * 0.12);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = '#4b5563';
      ctx.stroke();

      // ====================== 6. 固定层：水平仪气泡 ======================
      // beta = 俯仰(X)，gamma = 横滚(Y)；手机接近水平时气泡居中
      // scale: 每度 1.6px，让 ±30° 满幅 ≈ 中心暗圆
      const levelScale = 1.6;
      const bx = cx + gamma * levelScale;
      const by = cy + beta * levelScale;
      // 气泡轨道（极浅的圆环提示可移动范围）
      ctx.beginPath();
      ctx.arc(cx, cy, innerR * 0.85, 0, Math.PI * 2);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();
      // 气泡本体
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = isLevel ? '#4ade80' : '#ffffff';
      ctx.fill();

      // ====================== 7. 固定层：基准十字 ======================
      // 仅在已锁定基准线时绘制；颜色与盘面线一致(白色低透明度)
      if (baselineSet) {
        ctx.save();
        ctx.translate(cx, cy);
        // 基准十字的横竖线方向是固定的(与屏幕轴对齐)，不是 baselineAngle
        // 这样"垂直交叉"的观感最接近"经线/纬线"
        ctx.beginPath();
        ctx.moveTo(-(R - 4), 0);
        ctx.lineTo(R - 4, 0);
        ctx.moveTo(0, -(R - 4));
        ctx.lineTo(0, R - 4);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = isSnap ? 'rgba(74, 222, 128, 0.45)' : 'rgba(255, 255, 255, 0.3)';
        ctx.stroke();
        ctx.restore();
      }

      // ====================== 8. 旋转层：红色弧 + 短粗白色线段 ======================
      // 绕 phoneHeading 旋转，标记手机当前朝向
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((phoneHeading * Math.PI) / 180);

      // 红色弧：宽度扩到 60°(各 30°)，更接近 iOS 视觉
      const arcWidth = 0.52;
      ctx.beginPath();
      ctx.arc(0, 0, R - 2, -arcWidth, arcWidth);
      ctx.lineWidth = 5;
      ctx.strokeStyle = isSnap ? '#4ade80' : '#ff3b30';
      ctx.stroke();

      // 白色短粗线段：从外沿向内延伸到约 82% 半径
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