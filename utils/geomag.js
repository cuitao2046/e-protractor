/**
 * utils/geomag.js
 * WMM2025 纯 JS 实现（移植自 NOAA geomag70 算法 / wiedehopf/geomag 的 C 源码）
 *
 * 仅暴露 declination(lat, lon, year, altKm) 计算「磁偏角」(declination，东正)，
 * 供电子量角器把真北换算为磁北。无任何外部依赖，可直接在小程序中使用。
 *
 * 输入：
 *   lat   地理纬度(°，北正)
 *   lon   地理经度(°，东正)
 *   year  十进制年份(如 2025.6)，WMM2025 有效期 2025–2030
 *   altKm 海拔(km，相对 WGS84 椭球)，默认 0
 * 输出：
 *   declination(°，东正：磁北在真北东侧为正；西侧为负)
 *
 * 算法要点（与 NOAA 官方一致）：
 *   - 大地纬度→球坐标(geocentric)转换(WGS84 a/b)
 *   - Schmidt 半归一化高斯系数 → 非归一化
 *   - 关联勒让德函数及导数递归合成地磁场分量
 *   - dec = atan2(B_east, B_north)
 */

// WMM2025 系数（epoch 2025.0，含主场 g/h 与年变率 gdot/hdot）
var COF = [
  '2025.0            WMM-2025        11/13/2024',
  '  1  0  -29351.8       0.0       12.0        0.0',
  '  1  1   -1410.8    4545.4        9.7      -21.5',
  '  2  0   -2556.6       0.0      -11.6        0.0',
  '  2  1    2951.1   -3133.6       -5.2      -27.7',
  '  2  2    1649.3    -815.1       -8.0      -12.1',
  '  3  0    1361.0       0.0       -1.3        0.0',
  '  3  1   -2404.1     -56.6       -4.2        4.0',
  '  3  2    1243.8     237.5        0.4       -0.3',
  '  3  3     453.6    -549.5      -15.6       -4.1',
  '  4  0     895.0       0.0       -1.6        0.0',
  '  4  1     799.5     278.6       -2.4       -1.1',
  '  4  2      55.7    -133.9       -6.0        4.1',
  '  4  3    -281.1     212.0        5.6        1.6',
  '  4  4      12.1    -375.6       -7.0       -4.4',
  '  5  0    -233.2       0.0        0.6        0.0',
  '  5  1     368.9      45.4        1.4       -0.5',
  '  5  2     187.2     220.2        0.0        2.2',
  '  5  3    -138.7    -122.9        0.6        0.4',
  '  5  4    -142.0      43.0        2.2        1.7',
  '  5  5      20.9     106.1        0.9        1.9',
  '  6  0      64.4       0.0       -0.2        0.0',
  '  6  1      63.8     -18.4       -0.4        0.3',
  '  6  2      76.9      16.8        0.9       -1.6',
  '  6  3    -115.7      48.8        1.2       -0.4',
  '  6  4     -40.9     -59.8       -0.9        0.9',
  '  6  5      14.9      10.9        0.3        0.7',
  '  6  6     -60.7      72.7        0.9        0.9',
  '  7  0      79.5       0.0       -0.0        0.0',
  '  7  1     -77.0     -48.9       -0.1        0.6',
  '  7  2      -8.8     -14.4       -0.1        0.5',
  '  7  3      59.3      -1.0        0.5       -0.8',
  '  7  4      15.8      23.4       -0.1        0.0',
  '  7  5       2.5      -7.4       -0.8       -1.0',
  '  7  6     -11.1     -25.1       -0.8        0.6',
  '  7  7      14.2      -2.3        0.8       -0.2',
  '  8  0      23.2       0.0       -0.1        0.0',
  '  8  1      10.8       7.1        0.2       -0.2',
  '  8  2     -17.5     -12.6        0.0        0.5',
  '  8  3       2.0      11.4        0.5       -0.4',
  '  8  4     -21.7      -9.7       -0.1        0.4',
  '  8  5      16.9      12.7        0.3       -0.5',
  '  8  6      15.0       0.7        0.2       -0.6',
  '  8  7     -16.8      -5.2       -0.0        0.3',
  '  8  8       0.9       3.9        0.2        0.2',
  '  9  0       4.6       0.0       -0.0        0.0',
  '  9  1       7.8     -24.8       -0.1       -0.3',
  '  9  2       3.0      12.2        0.1        0.3',
  '  9  3      -0.2       8.3        0.3       -0.3',
  '  9  4      -2.5      -3.3       -0.3        0.3',
  '  9  5     -13.1      -5.2        0.0        0.2',
  '  9  6       2.4       7.2        0.3       -0.1',
  '  9  7       8.6      -0.6       -0.1       -0.2',
  '  9  8      -8.7       0.8        0.1        0.4',
  '  9  9     -12.9      10.0       -0.1        0.1',
  ' 10  0      -1.3       0.0        0.1        0.0',
  ' 10  1      -6.4       3.3        0.0        0.0',
  ' 10  2       0.2       0.0        0.1       -0.0',
  ' 10  3       2.0       2.4        0.1       -0.2',
  ' 10  4      -1.0       5.3       -0.0        0.1',
  ' 10  5      -0.6      -9.1       -0.3       -0.1',
  ' 10  6      -0.9       0.4        0.0        0.1',
  ' 10  7       1.5      -4.2       -0.1        0.0',
  ' 10  8       0.9      -3.8       -0.1       -0.1',
  ' 10  9      -2.7       0.9       -0.0        0.2',
  ' 10 10      -3.9      -9.1       -0.0       -0.0',
  ' 11  0       2.9       0.0        0.0        0.0',
  ' 11  1      -1.5       0.0       -0.0       -0.0',
  ' 11  2      -2.5       2.9        0.0        0.1',
  ' 11  3       2.4      -0.6        0.0       -0.0',
  ' 11  4      -0.6       0.2        0.0        0.1',
  ' 11  5      -0.1       0.5       -0.1       -0.0',
  ' 11  6      -0.6      -0.3        0.0       -0.0',
  ' 11  7      -0.1      -1.2       -0.0        0.1',
  ' 11  8       1.1      -1.7       -0.1       -0.0',
  ' 11  9      -1.0      -2.9       -0.1        0.0',
  ' 11 10      -0.2      -1.8       -0.1        0.0',
  ' 11 11       2.6      -2.3       -0.1        0.0',
  ' 12  0      -2.0       0.0        0.0        0.0',
  ' 12  1      -0.2      -1.3        0.0       -0.0',
  ' 12  2       0.3       0.7       -0.0        0.0',
  ' 12  3       1.2       1.0       -0.0       -0.1',
  ' 12  4      -1.3      -1.4       -0.0        0.1',
  ' 12  5       0.6      -0.0       -0.0       -0.0',
  ' 12  6       0.6       0.6        0.1       -0.0',
  ' 12  7       0.5      -0.1       -0.0       -0.0',
  ' 12  8      -0.1       0.8        0.0        0.0',
  ' 12  9      -0.4       0.1        0.0       -0.0',
  ' 12 10      -0.2      -1.0       -0.1       -0.0',
  ' 12 11      -1.3       0.1       -0.0        0.0',
  ' 12 12      -0.7       0.2       -0.1       -0.1',
  ' 999999999999999999999999999999999999999999999999',
  ' 999999999999999999999999999999999999999999999999'
];

var MAXORD = 12;
var _ready = false;
var A, B, RE, A2, B2, C2, A4, B4, C4, EPOCH;
var cM, cdM, snorm, kM, fn, fm;

function make2D() {
  var a = [];
  for (var i = 0; i <= MAXORD; i++) a.push(new Array(MAXORD + 1).fill(0));
  return a;
}

function buildModel() {
  if (_ready) return;
  A = 6378.137; B = 6356.7523142; RE = 6371.2;
  A2 = A * A; B2 = B * B; C2 = A2 - B2; A4 = A2 * A2; B4 = B2 * B2; C4 = A4 - B4;

  cM = make2D(); cdM = make2D(); snorm = make2D(); kM = make2D();
  fn = new Array(MAXORD + 1).fill(0);
  fm = new Array(MAXORD + 1).fill(0);

  // 解析系数行
  for (var i = 0; i < COF.length; i++) {
    var ln = COF[i].replace(/^\s+|\s+$/g, '');
    if (ln.indexOf('9999') === 0) break;            // 终止行
    if (i === 0) {                                  // 头部行：epoch
      EPOCH = parseFloat(ln.split(/\s+/)[0]);
      continue;
    }
    var p = ln.split(/\s+/);
    if (p.length < 6) continue;
    var n = parseInt(p[0], 10), m = parseInt(p[1], 10);
    var g = parseFloat(p[2]), h = parseFloat(p[3]);
    var gdot = parseFloat(p[4]), hdot = parseFloat(p[5]);
    if (n > MAXORD || m < 0 || m > n) continue;
    cM[m][n] = g; cdM[m][n] = gdot;
    if (m !== 0) { cM[n][m - 1] = h; cdM[n][m - 1] = hdot; }
  }

  // Schmidt 半归一化 → 非归一化
  snorm[0][0] = 1.0;
  fm[0] = 0.0;
  for (var nn = 1; nn <= MAXORD; nn++) {
    snorm[nn][0] = snorm[nn - 1][0] * (2 * nn - 1) / nn;
    var j = 2;
    for (var mm = 0, D2 = nn + 1; D2 > 0; D2--, mm++) {
      kM[mm][nn] = ((nn - 1) * (nn - 1) - mm * mm) / ((2 * nn - 1) * (2 * nn - 3));
      if (mm > 0) {
        var flnmj = (nn - mm + 1) * j / (nn + mm);
        snorm[nn][mm] = snorm[nn][mm - 1] * Math.sqrt(flnmj);
        j = 1;
        cM[nn][mm - 1] = snorm[nn][mm] * cM[nn][mm - 1];
        cdM[nn][mm - 1] = snorm[nn][mm] * cdM[nn][mm - 1];
      }
      cM[mm][nn] = snorm[nn][mm] * cM[mm][nn];
      cdM[mm][nn] = snorm[nn][mm] * cdM[mm][nn];
    }
    fn[nn] = nn + 1;
    fm[nn] = nn;
  }
  kM[1][1] = 0.0;
  _ready = true;
}

// 计算磁偏角(°)，东正
function declination(glat, glon, time, altKm) {
  buildModel();
  if (typeof altKm !== 'number') altKm = 0;
  var pi = 3.14159265359;
  var dtr = pi / 180.0;
  var dt = time - EPOCH;

  var rlon = glon * dtr, rlat = glat * dtr;
  var srlon = Math.sin(rlon), srlat = Math.sin(rlat);
  var crlon = Math.cos(rlon), crlat = Math.cos(rlat);
  var srlat2 = srlat * srlat, crlat2 = crlat * crlat;

  var sp = new Array(MAXORD + 1).fill(0);
  var cp = new Array(MAXORD + 1).fill(0);
  sp[0] = 0.0; cp[0] = 1.0;
  sp[1] = srlon; cp[1] = crlon;

  // 大地坐标 → 球坐标
  var q = Math.sqrt(A2 - C2 * srlat2);
  var q1 = altKm * q;
  var q2 = (q1 + A2) / (q1 + B2);
  var q2sq = q2 * q2;
  var ct = srlat / Math.sqrt(q2sq * crlat2 + srlat2);
  var st = Math.sqrt(1.0 - ct * ct);
  var r2 = altKm * altKm + 2.0 * q1 + (A4 - C4 * srlat2) / (q * q);
  var r = Math.sqrt(r2);
  var d = Math.sqrt(A2 * crlat2 + B2 * srlat2);
  var ca = (altKm + d) / r;
  var sa = C2 * crlat * srlat / (r * d);

  for (var m = 2; m <= MAXORD; m++) {
    sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
    cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
  }

  var P = make2D();
  P[0][0] = 1.0;
  var dp = make2D();
  var tc = make2D();
  var pp = new Array(MAXORD + 1).fill(0);

  var aor = RE / r;
  var ar = aor * aor;
  var br = 0, bt = 0, bp = 0, bpp = 0;

  for (var n = 1; n <= MAXORD; n++) {
    ar = ar * aor;
    for (var mm = 0, D4 = n + 1; D4 > 0; D4--, mm++) {
      // 关联勒让德函数及导数（Schmidt 半归一化）
      if (n === mm) {
        P[n][mm] = st * P[n - 1][mm - 1];
        dp[mm][n] = st * dp[mm - 1][n - 1] + ct * P[n - 1][mm - 1];
      } else if (n === 1 && mm === 0) {
        P[n][mm] = ct * P[n - 1][mm];
        dp[mm][n] = ct * dp[mm][n - 1] - st * P[n - 1][mm];
      } else if (n > 1 && n !== mm) {
        if (mm > n - 2) { P[n - 2][mm] = 0.0; dp[mm][n - 2] = 0.0; }
        P[n][mm] = ct * P[n - 1][mm] - kM[mm][n] * P[n - 2][mm];
        dp[mm][n] = ct * dp[mm][n - 1] - st * P[n - 1][mm] - kM[mm][n] * dp[mm][n - 2];
      }

      // 时间调整高斯系数 + 球谐累加
      tc[mm][n] = cM[mm][n] + dt * cdM[mm][n];
      if (mm !== 0) tc[n][mm - 1] = cM[n][mm - 1] + dt * cdM[n][mm - 1];

      var par = ar * P[n][mm];
      var temp1, temp2;
      if (mm === 0) {
        temp1 = tc[mm][n] * cp[mm];
        temp2 = tc[mm][n] * sp[mm];
      } else {
        temp1 = tc[mm][n] * cp[mm] + tc[n][mm - 1] * sp[mm];
        temp2 = tc[mm][n] * sp[mm] - tc[n][mm - 1] * cp[mm];
      }
      bt = bt - ar * temp1 * dp[mm][n];
      bp += fm[mm] * temp2 * par;
      br += fn[n] * temp1 * par;

      if (st === 0.0 && mm === 1) {
        if (n === 1) pp[n] = pp[n - 1];
        else pp[n] = ct * pp[n - 1] - kM[mm][n] * pp[n - 2];
        var parp = ar * pp[n];
        bpp += fm[mm] * temp2 * parp;
      }
    }
  }
  if (st === 0.0) bp = bpp; else bp /= st;

  var bx = -bt * ca - br * sa;
  var by = bp;
  var bz = bt * sa - br * ca;
  var dec = Math.atan2(by, bx) / dtr;
  return dec;
}

module.exports = { declination: declination, EPOCH: 2025.0 };
