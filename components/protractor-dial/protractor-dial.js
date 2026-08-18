// components/protractor-dial/protractor-dial.js
// iOS 指南针罗盘 — 精确复刻（60fps 流畅版）
//
// 渲染优化：
//  - 刻度环 + 外圈白环：预先渲染到离屏 sprite，每帧仅一次 drawImage 旋转绘制（避免 180 次 stroke）
//  - requestAnimationFrame 合并重绘：传感器高频回调只标记脏帧，每帧只画一次
//  - DPR 上限 2，降低像素填充开销
//
// 旋转层（随 heading 反向旋转）：
//  - 外圈细白环 + 刻度线（每 2°/10°/30°）
//  - 数字 0/30/.../330 与方位字 北/东/南/西：文字始终正立，按 (d-heading) 定位
//
// 固定层（屏幕坐标）：
//  - 顶部白色竖线 + 红色三角（尖角朝外）
//  - 白色粗指针线段（灰盘向上延伸）
//  - 中央深灰圆盘 + 浮动小十字准星（beta/gamma 驱动）
Component({
  properties: {
    heading: { type: Number, value: 0, observer() { this._requestDraw(); } },
    stableHeading: { type: Number, value: 0, observer() { this._requestDraw(); } },
    beta: { type: Number, value: 0, observer() { this._requestDraw(); } },
    gamma: { type: Number, value: 0, observer() { this._requestDraw(); } },
  },

  data: {},

  lifetimes: {
    attached() {
      this._inited = false;
      this._dirty = false;
      this._raf = 0;
      this._sprite = null;
      this.refAngle = null;   // 单击罗盘设置的基准刻度（盘面坐标角度）
      this._initCanvas();
    },
    ready() {
      this._initCanvas();
    },
    detached() {
      if (this._raf && this.canvas && this.canvas.cancelAnimationFrame) {
        this.canvas.cancelAnimationFrame(this._raf);
      }
      if (this._tapTimer) { clearTimeout(this._tapTimer); this._tapTimer = 0; }
      this.canvas = null;
      this.ctx = null;
      this._sprite = null;
    },
  },

  methods: {
    // 单击：设置/取消基准；双击：记录一次测量（基准 + 偏移量）
    onTap() {
      const now = Date.now();
      if (this._lastTap && now - this._lastTap < 300) {
        // —— 双击：记录测量历史 ——
        if (this._tapTimer) { clearTimeout(this._tapTimer); this._tapTimer = 0; }
        this._lastTap = 0;
        const ref = this.refAngle;
        if (ref !== null && ref !== undefined) {
          // 测量用高精度稳定读数（静止平均，0.1°）
          const stable = this.properties.stableHeading;
          this.triggerEvent('measure', { refAngle: ref, delta: this._rel(stable, ref) });
        }
        return;
      }
      this._lastTap = now;
      if (this._tapTimer) clearTimeout(this._tapTimer);
      this._tapTimer = setTimeout(() => {
        this._tapTimer = 0;
        this._lastTap = 0;
        // —— 单击：切换基准（锁定用高精度稳定读数，0.1°）——
        if (this.refAngle !== null && this.refAngle !== undefined) {
          this.refAngle = null;   // 取消基准，恢复正常显示
        } else {
          const stable = this.properties.stableHeading;
          this.refAngle = Math.round(stable * 10) / 10;   // 指针当前指向的刻度设为基准
        }
        this.triggerEvent('refchange', { refAngle: this.refAngle });
        this._requestDraw();
      }, 250);
    },

    // 相对基准偏移量：顺时针为正，逆时针为负（范围 (-180, 180]），0.1° 精度
    _rel(heading, ref) {
      let rel = ((heading - ref) % 360 + 360) % 360;
      if (rel > 180) rel -= 360;
      return Math.round(rel * 10) / 10;
    },

    _initCanvas() {
      const query = this.createSelectorQuery();
      query
        .select('#compassCanvas')
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
          const dpr = Math.min(2, (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2);
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.scale(dpr, dpr);
          this.canvas = canvas;
          this.ctx = ctx;
          this.W = w;
          this.H = h;
          this.dpr = dpr;
          this._inited = true;

          // 预渲染刻度环 sprite
          this._initSprite();
          this._redraw();
        });
    },

    // 将「外圈白环 + 全部刻度线」一次性渲染到离屏 canvas
    _initSprite() {
      // 画布加大到 700rpx 后，除数同步调大，保持罗盘视觉半径不变、
      // 腾出更多外圈空间给数字环（字号不变，间距可继续外移）
      const outerR = Math.min(this.W, this.H) / 2 / 1.38;
      this.outerR = outerR;
      // 给离屏 sprite 留 padding，避免外圈白环描边被画布边缘裁剪
      const pad = 8;
      const size = Math.ceil(outerR * 2) + pad * 2;
      try {
        const sprite = wx.createOffscreenCanvas({ type: '2d', width: size * this.dpr, height: size * this.dpr });
        const sctx = sprite.getContext('2d');
        sctx.scale(this.dpr, this.dpr);
        sctx.translate(outerR + pad, outerR + pad);

        // 不画外缘刻度环（外圈白环），只画刻度线
        // 刻度：外环按 2° 分割成 180 份，正北(0°)为第 0 个点；
        // 刻度颜色统一纯白，粗/细刻度等长（0.15R），每 30° 加粗
        for (let d = 0; d < 360; d += 2) {
          const is30 = d % 30 === 0;
          const len = outerR * 0.15;           // 粗/细刻度等长
          const lw = is30 ? 2.2 : 0.5;         // 每30°加粗，其余细线
          const alpha = 1;                     // 颜色统一纯白
          const rad = (d * Math.PI) / 180;
          const x1 = Math.sin(rad) * outerR;
          const y1 = -Math.cos(rad) * outerR;
          const x2 = Math.sin(rad) * (outerR - len);
          const y2 = -Math.cos(rad) * (outerR - len);
          sctx.beginPath();
          sctx.moveTo(x1, y1);
          sctx.lineTo(x2, y2);
          sctx.lineWidth = lw;
          sctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          sctx.stroke();
        }
        this._sprite = sprite;
        this._spriteSize = size;
      } catch (e) {
        // 不支持离屏 canvas 时退回逐帧绘制
        this._sprite = null;
      }
    },

    // 传感器高频回调 → 标记脏帧，由 rAF 合并到每帧一次绘制
    _requestDraw() {
      if (!this._inited || !this.ctx) return;
      this._dirty = true;
      if (this._raf) return;
      const canvas = this.canvas;
      if (canvas && canvas.requestAnimationFrame) {
        this._raf = canvas.requestAnimationFrame(() => {
          this._raf = 0;
          if (!this._dirty) return;
          this._dirty = false;
          const { heading, beta, gamma } = this.properties;
          this._draw(heading || 0, beta || 0, gamma || 0);
        });
      } else {
        this._dirty = false;
        const { heading, beta, gamma } = this.properties;
        this._draw(heading || 0, beta || 0, gamma || 0);
      }
    },

    _redraw() {
      if (!this._inited || !this.ctx) return;
      const { heading, beta, gamma } = this.properties;
      this._draw(heading || 0, beta || 0, gamma || 0);
    },

    _draw(heading, beta, gamma) {
      const ctx = this.ctx;
      const W = this.W, H = this.H;
      const cx = W / 2, cy = H / 2;
      const outerR = this.outerR;
      if (!outerR || outerR <= 0) return;

      const innerR = outerR * 0.36;       // 中央灰盘半径
      const ringR = outerR * 0.72;        // 方位字环带半径（基本紧贴刻度内侧）

      ctx.clearRect(0, 0, W, H);

      // ============ 旋转层：离屏 sprite 整体旋转 ============
      if (this._sprite) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-heading * Math.PI) / 180);
        const s = this._spriteSize;
        ctx.drawImage(this._sprite, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        // 无离屏 canvas 时的退化绘制（不画外缘刻度环，只画刻度线）
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-heading * Math.PI) / 180);
        for (let d = 0; d < 360; d += 2) {
          const is30 = d % 30 === 0;
          const len = outerR * 0.15;           // 粗/细刻度等长
          const lw = is30 ? 2.2 : 0.5;         // 每30°加粗，其余细线
          const alpha = 1;                     // 颜色统一纯白
          const rad = (d * Math.PI) / 180;
          const x1 = Math.sin(rad) * outerR;
          const y1 = -Math.cos(rad) * outerR;
          const x2 = Math.sin(rad) * (outerR - len);
          const y2 = -Math.cos(rad) * (outerR - len);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineWidth = lw;
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.stroke();
        }
        ctx.restore();
      }

      // —— 基准锁定模式：指针从基准刻度扫过的红色环形带 ——
      if (this.refAngle !== null && this.refAngle !== undefined) {
        const sweep = ((heading - this.refAngle + 540) % 360) - 180;  // 最短扫过角 [-180,180)
        if (Math.abs(sweep) > 0.1) {
          const bandOuter = outerR - outerR * 0.15;    // 外缘与刻度线内边缘相邻
          const bandWidth = outerR * 0.15 * 1.5;       // 环带宽度 = 刻度线长度的 1.5 倍
          const bandInner = bandOuter - bandWidth;
          const a0 = (this.refAngle * Math.PI) / 180 - Math.PI / 2;
          const a1 = (heading * Math.PI) / 180 - Math.PI / 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate((-heading * Math.PI) / 180);
          ctx.beginPath();
          ctx.arc(0, 0, bandOuter, a0, a1, sweep < 0);
          ctx.arc(0, 0, bandInner, a1, a0, !(sweep < 0));
          ctx.closePath();
          ctx.fillStyle = 'rgba(230,0,18,1)';   // 中国红 #E60012，不透明；环带在旋转层绘制，位于东南西北文字之下
          ctx.fill();
          ctx.restore();
        }
      }

      // —— 基准刻度线（单击设置）：加粗，且向外延长一倍 ——
      if (this.refAngle !== null && this.refAngle !== undefined) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-heading * Math.PI) / 180);
        const rad = (this.refAngle * Math.PI) / 180;
        const r1 = outerR - outerR * 0.15;   // 内端（与原刻度等长向内）
        const r2 = outerR + outerR * 0.15;   // 外端（向外延长一倍）
        const x1 = Math.sin(rad) * r1;
        const y1 = -Math.cos(rad) * r1;
        const x2 = Math.sin(rad) * r2;
        const y2 = -Math.cos(rad) * r2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.stroke();
        ctx.restore();
      }
      // ============ 旋转层结束 ============

      // ============ 标签层（文字始终正立，按 (d-heading) 定位）============
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // —— 数字：每 30° 一个，刻度环外侧 ——
      // 字号保持 0.12R，数字环外移到 1.24R（画布加大后间距可继续放大）
      const numFontSize = Math.round(outerR * 0.12);
      const rNum = outerR * 1.24;
      const numList = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
      ctx.font = `400 ${numFontSize}px -apple-system,"SF Pro Display",sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const d of numList) {
        // 基准刻度已单独以粗体数值显示，此处跳过原刻度值
        if (this.refAngle !== null && this.refAngle !== undefined && d === this.refAngle) continue;
        const rad = ((d - heading) * Math.PI) / 180;
        ctx.fillText(String(d), cx + Math.sin(rad) * rNum, cy - Math.cos(rad) * rNum);
      }

      // —— 基准数字（单击设置的刻度）：外移、字体变大加粗，0.1° 精度 ——
      if (this.refAngle !== null && this.refAngle !== undefined) {
        const refRad = ((this.refAngle - heading) * Math.PI) / 180;
        const refFs = Math.round(outerR * 0.14);        // 大于普通数字(0.12R)
        const refR = rNum + outerR * 0.05;              // 比普通数字更靠外
        ctx.font = `700 ${refFs}px -apple-system,"SF Pro Display",sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        const refStr = (Math.round(this.refAngle * 10) / 10).toFixed(1).replace(/\.0$/, '');
        ctx.fillText(refStr, cx + Math.sin(refRad) * refR, cy - Math.cos(refRad) * refR);
      }

      // —— 中文方位字（缩小约 1/3，且更靠近罗盘内侧）——
      const cardFontSize = Math.round(outerR * 0.17);
      const cardinals = [
        { a: 0, label: '北' },
        { a: 90, label: '东' },
        { a: 180, label: '南' },
        { a: 270, label: '西' },
      ];
      ctx.font = `400 ${cardFontSize}px -apple-system,"SF Pro Display","PingFang SC",sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      for (const c of cardinals) {
        const rad = ((c.a - heading) * Math.PI) / 180;
        ctx.fillText(c.label, cx + Math.sin(rad) * ringR, cy - Math.cos(rad) * ringR);
      }
      // ============ 标签层结束 ============

      // —— 红色三角（正北标记，固定在盘面 0° 位，随盘面旋转）——
      // 尖端朝外（远离圆心），落在刻度环外圈与刻度数值之间空白的中间
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-heading * Math.PI) / 180);
      const triR = (outerR + rNum) / 2;      // 刻度环(outerR)与数字环(rNum)之间的中间
      const triH = outerR * 0.08;
      const triHalfW = outerR * 0.045;
      ctx.beginPath();
      ctx.moveTo(0, -(triR + triH / 2));                 // 尖端朝外（远离圆心）
      ctx.lineTo(-triHalfW, -(triR - triH / 2));          // 底边（内侧）左
      ctx.lineTo(triHalfW, -(triR - triH / 2));           // 底边（内侧）右
      ctx.closePath();
      ctx.fillStyle = '#FF3B30';
      ctx.fill();
      ctx.restore();

      // ============ 固定层（屏幕坐标）============

      // —— 白色粗指针线段（当前朝向指示）——
      // 内端（指向圆心一侧）落在粗刻度线内侧端点所在圆（内环圆，0.90R）；
      // 长度较上一版增加一倍（0.21R → 0.42R），外端到 1.32R，重叠不处理
      const ptrInnerR = outerR * 0.90;        // 内端 = 内环圆
      const ptrOuterR = outerR * 1.32;        // 外端（长度增加一倍）
      const ptrWidth = Math.max(2.5, outerR * 0.03);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(
        cx - ptrWidth / 2,
        cy - ptrOuterR,
        ptrWidth,
        (cy - ptrInnerR) - (cy - ptrOuterR)
      );

      // —— 中央深灰圆盘 ——
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = '#1C1C1E';
      ctx.fill();

      // —— 指针十字线（固定于罗盘中心）——
      // 线条粗细与罗盘细刻度线一致（0.5px），纯白；竖线与顶部粗指针共线；
      // 四端端点落在北/东/南/西四个方位字的内边缘所在圆上
      const crossR = ringR - cardFontSize / 2;   // 方位字内边缘半径
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - crossR, cy);
      ctx.lineTo(cx + crossR, cy);
      ctx.moveTo(cx, cy - crossR);
      ctx.lineTo(cx, cy + crossR);
      ctx.stroke();

      // —— 浮动小十字准星（水平仪指示）——
      // 与固定指针十字线重合（达到水平）时变绿，作为"已达水平"标记
      const tiltMag = Math.sqrt(beta * beta + gamma * gamma);
      const crossLevel = tiltMag < 0.5;
      const offScale = innerR * 0.35;
      let ox = -gamma * offScale / 45;
      let oy = beta * offScale / 45;
      const maxOff = innerR * 0.55;
      ox = Math.max(-maxOff, Math.min(maxOff, ox));
      oy = Math.max(-maxOff, Math.min(maxOff, oy));
      const pxc = cx + ox;
      const pyc = cy + oy;
      const armHalf = innerR * 0.7;
      const notch = innerR * 0.25;

      ctx.strokeStyle = crossLevel ? '#30D158' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pxc - armHalf, pyc);
      ctx.lineTo(pxc - notch, pyc);
      ctx.moveTo(pxc + notch, pyc);
      ctx.lineTo(pxc + armHalf, pyc);
      ctx.moveTo(pxc, pyc - armHalf);
      ctx.lineTo(pxc, pyc - notch);
      ctx.moveTo(pxc, pyc + notch);
      ctx.lineTo(pxc, pyc + armHalf);
      ctx.stroke();

      // 中心小点
      ctx.beginPath();
      ctx.arc(pxc, pyc, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
    },
  },
});