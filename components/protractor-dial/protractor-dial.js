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
    // 是否已锁定基准线（顶部标记变琥珀色 + 绘制基线）
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
      const { angle, isSnap, holdLatched, baselineSet } = this.properties;
      this._draw(angle || 0, !!isSnap, !!holdLatched, !!baselineSet);
    },

    _draw(angle, isSnap, holdLatched, baselineSet) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 10;
      if (R <= 0) return; // 尺寸未就绪时直接跳过，避免负半径抛异常

      ctx.clearRect(0, 0, W, H);

      // 外圈底盘
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 20, 20, 0.6)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2c2c2e';
      ctx.stroke();

      // —— 固定刻度环（盘面不随转动旋转，方向保持恒定）——
      for (let d = 0; d < 360; d++) {
        const rad = (d * Math.PI) / 180;
        const isMajor = d % 10 === 0;
        const isMedium = d % 5 === 0;
        const rIn = R - (isMajor ? 22 : (isMedium ? 14 : 8));
        const rOut = R - 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(rad) * rIn, cy - Math.cos(rad) * rIn);
        ctx.lineTo(cx + Math.sin(rad) * rOut, cy - Math.cos(rad) * rOut);
        ctx.lineWidth = isMajor ? 2 : 1;
        ctx.strokeStyle = isMajor ? '#ffffff' : '#6b7280';
        ctx.stroke();
      }

      // —— 正向数字（每 30°，固定不转）——
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 30) {
        const rad = (d * Math.PI) / 180; // 固定：0 在顶部、顺时针递增
        const rText = R - 38;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillText(String(d), x, y);
      }

      // —— 方位字（北/东/南/西，固定不转）——
      const cardinals = [
        { d: 0, label: '北', color: '#ef4444' },
        { d: 90, label: '东', color: '#ffffff' },
        { d: 180, label: '南', color: '#ffffff' },
        { d: 270, label: '西', color: '#ffffff' },
      ];
      ctx.font = '700 18px sans-serif';
      for (const c of cardinals) {
        const rad = (c.d * Math.PI) / 180;
        const rText = R - 64;
        const x = cx + Math.sin(rad) * rText;
        const y = cy - Math.cos(rad) * rText;
        ctx.fillStyle = c.color;
        ctx.fillText(c.label, x, y);
      }

      // —— 旋转指针（指示相对角度；盘面固定，仅指针转动）——
      // 正角度 = 顺时针，与相对角度符号一致；0° 时指针朝上指向基准(北)
      const needleRad = (angle * Math.PI) / 180;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(needleRad);
      const needleLen = R - 8;
      // 红头（指向被测方向）
      ctx.beginPath();
      ctx.moveTo(0, -needleLen);
      ctx.lineTo(-8, -14);
      ctx.lineTo(8, -14);
      ctx.closePath();
      ctx.fillStyle = '#ff453a';
      ctx.fill();
      // 杆
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, needleLen * 0.42);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ff453a';
      ctx.stroke();
      // 尾（浅色配重）
      ctx.beginPath();
      ctx.moveTo(0, needleLen * 0.42);
      ctx.lineTo(-6, needleLen * 0.42 + 18);
      ctx.lineTo(6, needleLen * 0.42 + 18);
      ctx.closePath();
      ctx.fillStyle = '#e5e5ea';
      ctx.fill();
      ctx.restore();

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

      // —— 顶部固定基准标记（不随盘面旋转）——
      // 配色优先级：磁吸归零(绿) > 已锁定基线(琥珀) > 未锁定(暗灰)
      let markerColor = '#3a3a3c';
      if (isSnap) markerColor = '#4ade80';
      else if (baselineSet) markerColor = '#f59e0b';

      // 已锁定基线：从中心到顶的细参考线（固定不转），清晰标示 0° 方向
      if (baselineSet && !isSnap) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - R + 10);
        ctx.stroke();
        ctx.restore();
      }

      // 顶部三角指向标
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 4);
      ctx.lineTo(cx - 10, cy - R + 30);
      ctx.lineTo(cx + 10, cy - R + 30);
      ctx.closePath();
      ctx.fillStyle = markerColor;
      ctx.fill();

      // 顶部竖线（与三角同宽，强调指向）
      ctx.beginPath();
      ctx.moveTo(cx, cy - R + 30);
      ctx.lineTo(cx, cy - R + 48);
      ctx.lineWidth = 2;
      ctx.strokeStyle = markerColor;
      ctx.stroke();

      // 磁吸/锁定 时的中心小圆点（锁定点）
      if (baselineSet || isSnap) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = markerColor;
        ctx.fill();
      }

      // 锁定状态小点（Auto-Hold）
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
