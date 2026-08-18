// components/protractor-dial/protractor-dial.js
// 严格按 iOS 指南针规格复刻 + 量角器扩展
//
// 旋转层（绕 -phoneHeading，当前朝向永远在顶部）：
//  - 刻度：主每10°(14px/2px)，次每1°(7px/1px/0.7)；0°主刻度不画(被顶部指针替代)
//  - 数字：每30°，主刻度外18px；灰色#8E8E93 22px/300，最近顶部的白色32px/400
//  - 方位字 北东南西：36px/300，半径×0.62，随盘面转（北永远指真实北方）
//  - 红色北方扇形环：350°→010°(各10°)，内半径=刻度内缘，外半径=盘缘，#FF3B30/0.9
//
// 固定层（屏幕坐标系）：
//  - 顶部指针：白竖线(3px宽，盘缘向外) + 红三角(底12高14，尖朝圆心)
//  - 中心暗圆 #1C1C1E(直径32%盘径) + 十字准星 + 水平仪气泡(beta/gamma)
//  - 基准十字(量角器)：画在 (baselineAngle - phoneHeading) 屏幕角，随手机转动
Component({
  properties: {
    // 手机当前朝向（0-360），从 DeviceMotion alpha
    phoneHeading: { type: Number, value: 0, observer() { this._redraw(); } },
    // 基准线方向（0-360），初始 0（正北）
    baselineAngle: { type: Number, value: 0, observer() { this._redraw(); } },
    // 俯仰角 beta（X 轴），水平仪气泡 y 偏移
    beta: { type: Number, value: 0, observer() { this._redraw(); } },
    // 横滚角 gamma（Y 轴），水平仪气泡 x 偏移
    gamma: { type: Number, value: 0, observer() { this._redraw(); } },
    // 是否磁吸归零（靠近 0° 测量值，基准十字变绿）
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
      // 内缩 32：给外侧数字(18px)与顶部白指针留空间
      const R = Math.min(W, H) / 2 - 32;
      if (R <= 0) return;

      ctx.clearRect(0, 0, W, H);

      // ====================== 旋转层：表盘绕 -phoneHeading ======================
      // 当前朝向永远在顶部；北/数字/刻度随盘面转，北永远指向真实北方
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-phoneHeading * Math.PI) / 180);

      const edgeIn = R - 2;          // 盘缘（刻度外端）
      const tickInner = edgeIn - 14; // 主刻度内端

      // —— 4.7 红色北方扇形环：350°→010°（各 10°，共 20°）——
      const a0 = ((350 - 90) * Math.PI) / 180; // 盘角→画布角(0°顶=canvas -90°)
      const a1 = ((10 - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(0, 0, edgeIn, a0, a1, false);       // 外弧 350→10 过 0°
      ctx.arc(0, 0, tickInner, a1, a0, true);     // 内弧反向
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 59, 48, 0.9)';
      ctx.fill();

      // —— 4.2 刻度：主每10°(14px/2px白)，次每1°(7px/1px/0.7)；0°主刻度不画 ——
      for (let d = 0; d < 360; d++) {
        const isMain = d % 10 === 0;
        if (isMain && d === 0) continue; // 0° 被顶部固定指针替代
        const rad = (d * Math.PI) / 180;
        const len = isMain ? 14 : 7;
        const rIn = edgeIn - len;
        ctx.beginPath();
        ctx.moveTo(Math.sin(rad) * rIn, -Math.cos(rad) * rIn);
        ctx.lineTo(Math.sin(rad) * edgeIn, -Math.cos(rad) * edgeIn);
        ctx.lineWidth = isMain ? 2 : 1;
        ctx.strokeStyle = isMain ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)';
        ctx.stroke();
      }

      // —— 4.3 数字：每30°，主刻度外侧；最近顶部的白32px/400，其余 iOS 灰 22px/300 ——
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const rText = edgeIn + 18;
      for (let d = 0; d < 360; d += 30) {
        // 距顶部偏角（归一化到 -180..180）
        const off = (((d - phoneHeading) % 360) + 540) % 360 - 180;
        const isNearest = Math.abs(off) <= 15;
        const rad = (d * Math.PI) / 180;
        ctx.font = isNearest ? '400 32px sans-serif' : '300 22px sans-serif';
        ctx.fillStyle = isNearest ? '#FFFFFF' : '#8E8E93';
        ctx.fillText(String(d), Math.sin(rad) * rText, -Math.cos(rad) * rText);
      }

      // —— 4.4 方位字：北东南西 36px/300，半径×0.62，随盘面转 ——
      const cardinals = [
        { d: 0, label: '北', color: '#FF3B30' },
        { d: 90, label: '东', color: '#FFFFFF' },
        { d: 180, label: '南', color: '#FFFFFF' },
        { d: 270, label: '西', color: '#FFFFFF' },
      ];
      ctx.font = '300 36px sans-serif';
      const rCard = R * 0.62;
      for (const c of cardinals) {
        const rad = (c.d * Math.PI) / 180;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, Math.sin(rad) * rCard, -Math.cos(rad) * rCard);
      }

      ctx.restore();
      // ====================== 旋转层结束 ======================

      // ====================== 固定层 ======================

      // —— 4.6 顶部固定指针：白竖线(3px，盘缘向外) + 红三角(底12高14，尖朝圆心) ——
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - 1.5, cy - R - 22, 3, 22);
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 16);      // 尖（朝圆心）
      ctx.lineTo(cx - 6, cy - R + 2);   // 底边左（贴盘缘）
      ctx.lineTo(cx + 6, cy - R + 2);   // 底边右
      ctx.closePath();
      ctx.fillStyle = '#FF3B30';
      ctx.fill();

      // —— 4.5 中心：暗圆 #1C1C1E（直径 32% 盘径）+ 十字准星 ——
      const innerR = R * 0.32;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = '#1C1C1E';
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillRect(cx - 30, cy - 0.5, 60, 1);
      ctx.fillRect(cx - 0.5, cy - 30, 1, 60);

      // —— 水平仪气泡（量角器保留项）：beta 俯仰 / gamma 横滚 ——
      const levelScale = 1.6;
      const bx = cx + gamma * levelScale;
      const by = cy + beta * levelScale;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = isLevel ? '#4ade80' : '#FFFFFF';
      ctx.fill();

      // —— 基准十字（量角器）：屏幕角 = baselineAngle - phoneHeading，随手机转动 ——
      if (baselineSet) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((baselineAngle - phoneHeading) * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(-(R - 4), 0);
        ctx.lineTo(R - 4, 0);
        ctx.moveTo(0, -(R - 4));
        ctx.lineTo(0, R - 4);
        ctx.lineWidth = 1;
        ctx.strokeStyle = isSnap ? 'rgba(74, 222, 128, 0.5)' : 'rgba(255, 255, 255, 0.35)';
        ctx.stroke();
        ctx.restore();
      }
    },
  },
});
