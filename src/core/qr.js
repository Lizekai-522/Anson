/**
 * 「安程」自研二维码引擎（QR Code Model 2，参照 ISO/IEC 18004）。
 *
 * 设计目标：
 * - 纯 ESM、零 import、零运行时依赖，便于审计与离线使用；
 * - 完整实现：GF(256) 上的 Reed-Solomon 纠错、8 种掩码 + 规范罚分自动选优、
 *   格式信息 BCH(15,5)、版本 7+ 的版本信息 BCH(18,6)、
 *   Finder / Timing / Alignment / 固定深色模块、码字交错排布；
 * - 字节模式（UTF-8），纠错级别支持 'L' / 'M'（默认 'M'），版本 1-25 自动选择；
 * - 中文注释逐步解释每个环节——这是产品强调“自研可读性”的部分。
 *
 * encodeQR 的编码流水线：
 *   1. 文本 → UTF-8 字节；
 *   2. 组装位流：模式指示符(0100) + 字符计数 + 数据 + 终止符 + 填充码字；
 *   3. 按版本/级别的 RS 块结构切分数据码字，逐块计算纠错码字，再块间交错；
 *   4. 绘制全部功能图案（含当前掩码对应的格式信息）；
 *   5. 码字按“两列一组、蛇形向上/向下”填入数据区，再异或掩码；
 *   6. 对 8 个候选矩阵按规范罚分规则（规则 1-4）打分，取分最低者。
 */

/* ----------------------------- GF(256) 伽罗瓦域 ----------------------------- */
/*
 * Reed-Solomon 纠错的四则运算在 GF(256) 上进行：每个元素是一个字节（0..255），
 * 乘除法通过“指数表 EXP / 对数表 LOG”完成。本原多项式取 0x11D
 * （x^8 + x^4 + x^3 + x^2 + 1），生成元 α = 2，即 EXP[i] = α^i。
 */
const EXP = new Uint8Array(512); // EXP[i] = α^i；i≥255 时按周期回绕（避免取模运算）
const LOG = new Uint8Array(256); // LOG[x] = log_α(x)，x≠0

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;                    // 乘 α 等价于左移一位
    if (x & 0x100) x ^= 0x11d;  // 超出 8 位时按本原多项式回卷，保证仍是域内元素
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; // α^255 = 1，周期 255
})();

// GF(256) 乘法：α^a · α^b = α^(a+b mod 255)；任一因子为 0 结果为 0。
function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

/* ----------------------------- Reed-Solomon 纠错 ----------------------------- */
/*
 * 纠错原理：把每块数据码字看成 GF(256) 上的多项式 f(x)，纠错码字是
 * f(x)·x^d 除以生成多项式 g(x) = ∏_{i=0}^{d-1}(x - α^i) 的余数系数。
 * 解码端只要错误码字数 ≤ d/2，就能通过余式校正还原数据。
 */

// 生成多项式缓存（同一 degree 只算一次）。系数 MSB-first：gen[0] 对应最高次项。
const genCache = new Map();
function rsGenPoly(degree) {
  let gen = genCache.get(degree);
  if (gen) return gen;
  gen = [1]; // 初始为多项式 1
  for (let i = 0; i < degree; i++) {
    // 当前 g(x) 乘以 (x + α^i)：next[k] = g[k]（x·g 项）+ g[k-1]·α^i（α^i·g 项）
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], EXP[i]);
    }
    gen = next;
  }
  genCache.set(degree, gen);
  return gen;
}

// 对一块数据码字计算 ecLen 个纠错码字：LFSR 式多项式除法，返回余数系数（MSB-first）。
function rsEncodeBlock(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let k = 0; k < data.length; k++) {
    const factor = data[k] ^ rem[0]; // 本次要消去的最高次项系数
    rem.copyWithin(0, 1);            // 寄存器左移一位
    rem[ecLen - 1] = 0;
    if (factor) for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ------------------------------- 版本结构表 ------------------------------- */
/*
 * RS 块结构表（对应 ISO/IEC 18004 的纠错特性表，摘录版本 1-25 的 L / M 两列）。
 * 每行 = 一个版本；每列 = 一个纠错级别，格式：
 *   [每块纠错码字数, 组1块数, 组1每块数据码字数, 组2块数, 组2每块数据码字数, ...]
 * 组 1 为“短块”，组 2 为“长块”（每块多 1 个数据码字）；只有一种块长时省去组 2。
 * 行尾注释为该版本总码字数 = 所有块(数据+纠错)之和。
 */
const RS_BLOCKS = [
  [[7, 1, 19], [10, 1, 16]],                                  // v1  26
  [[10, 1, 34], [16, 1, 28]],                                 // v2  44
  [[15, 1, 55], [26, 1, 44]],                                 // v3  70
  [[20, 1, 80], [18, 2, 32]],                                 // v4  100
  [[26, 1, 108], [24, 2, 43]],                                // v5  134
  [[18, 2, 68], [16, 4, 27]],                                 // v6  172
  [[20, 2, 78], [18, 4, 31]],                                 // v7  196
  [[24, 2, 97], [22, 2, 38, 2, 39]],                          // v8  242
  [[30, 2, 116], [22, 3, 36, 2, 37]],                         // v9  292
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44]],                   // v10 346
  [[20, 4, 81], [30, 1, 50, 4, 51]],                          // v11 404
  [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37]],                   // v12 466
  [[26, 4, 107], [22, 8, 37, 1, 38]],                         // v13 532
  [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41]],                 // v14 581
  [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42]],                   // v15 655
  [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46]],                   // v16 733
  [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47]],                // v17 815
  [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44]],                 // v18 901
  [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45]],                // v19 991
  [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42]],                // v20 1085
  [[28, 4, 116, 4, 117], [26, 17, 42]],                       // v21 1156
  [[28, 2, 111, 7, 112], [28, 17, 46]],                       // v22 1258
  [[30, 4, 121, 5, 122], [28, 4, 47, 14, 48]],                // v23 1364
  [[30, 6, 117, 4, 118], [28, 6, 45, 14, 46]],                // v24 1474
  [[26, 8, 106, 4, 107], [28, 8, 47, 13, 48]],                // v25 1588
];

/*
 * Alignment 图案中心坐标表（下标 = 版本 - 1）。
 * 实际绘制的图案 = 所有 (行, 列) 坐标组合中，去掉与三个 Finder 重叠的三个角组合。
 * 注意：v2-6 只有一个 alignment 图案（坐标 [6, size-7] 组合后仅剩角上那个）。
 */
const ALIGN_CENTERS = [
  [],                       // v1
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],   // v2 - v6
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], // v7 - v13
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
  [6, 30, 58, 86], [6, 34, 62, 90],              // v14 - v20
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],                          // v21 - v25
];

const ECL_INDEX = { L: 0, M: 1 };     // 纠错级别 → 表列下标
const FORMAT_LEVEL_BITS = [1, 0];     // 格式信息中的级别位：L=01, M=00
const MAX_VERSION = 25;

// 把 RS 表条目解析成 { ecLen, groups: [[块数, 每块数据码字]...], dataCW 总数据码字 }。
function blockSpec(version, level) {
  const entry = RS_BLOCKS[version - 1][level];
  const ecLen = entry[0];
  const groups = [];
  let dataCW = 0;
  for (let i = 1; i < entry.length; i += 2) {
    groups.push([entry[i], entry[i + 1]]);
    dataCW += entry[i] * entry[i + 1];
  }
  return { ecLen, groups, dataCW };
}

// 字节模式的字符计数指示位数：版本 1-9 用 8 位，10-25 用 16 位。
const countBits = (version) => (version < 10 ? 8 : 16);

// 某版本/级别可容纳的最大字节数（扣除 4 位模式指示符与计数指示位后向下取整）。
function byteCapacity(version, level) {
  const { dataCW } = blockSpec(version, level);
  return Math.floor((dataCW * 8 - 4 - countBits(version)) / 8);
}

/* ------------------------------- 位流与码字 ------------------------------- */

// MSB 先序的位流写入器：push(value, n) 把 value 的低 n 位依次写入。
function createBitWriter() {
  return {
    bytes: [], // 已按字节对齐的部分
    len: 0,    // 已写入的总位数
    push(val, n) {
      for (let i = n - 1; i >= 0; i--) {
        if (this.len % 8 === 0) this.bytes.push(0);
        if ((val >>> i) & 1) this.bytes[this.len >> 3] |= 0x80 >>> (this.len & 7);
        this.len++;
      }
    },
  };
}

// 把 UTF-8 字节按字节模式编码为“数据码字 + 纠错码字”交错后的完整码字序列。
function buildCodewords(bytes, version, level) {
  const { ecLen, groups, dataCW } = blockSpec(version, level);
  const maxBits = dataCW * 8; // 数据区总位数

  // 1) 位流：模式指示符 0100（字节模式）→ 字符计数 → 数据字节
  const bw = createBitWriter();
  bw.push(0b0100, 4);
  bw.push(bytes.length, countBits(version));
  for (const b of bytes) bw.push(b, 8);

  // 2) 终止符 0000（容量正好用完时允许截断为 0 位）
  bw.push(0, Math.min(4, maxBits - bw.len));

  // 3) 补齐到字节边界（补 0）
  if (bw.len % 8) bw.push(0, 8 - (bw.len % 8));

  // 4) 用 0xEC / 0x11 交替填充剩余码字（规范的 padding 字节）
  let pad = 0;
  while (bw.len < maxBits) bw.push((pad++ % 2) ? 0x11 : 0xec, 8);

  // 5) 按 RS 块结构切分数据码字：先切完组 1 的短块，再切组 2 的长块
  const dataBlocks = [];
  let off = 0;
  let maxDataLen = 0;
  for (const [count, per] of groups) {
    for (let i = 0; i < count; i++) {
      dataBlocks.push(bw.bytes.slice(off, off + per));
      off += per;
      if (per > maxDataLen) maxDataLen = per;
    }
  }

  // 6) 逐块计算 Reed-Solomon 纠错码字
  const ecBlocks = dataBlocks.map((blk) => rsEncodeBlock(blk, ecLen));

  // 7) 块间交错：先按“列”轮转输出所有数据码字（短块尾部跳过），
  //    再按“列”轮转输出所有纠错码字。这样局部污损会分散到各块，
  //    每块的纠错能力得以均衡利用。
  const out = new Uint8Array(dataCW + ecLen * dataBlocks.length);
  let p = 0;
  for (let col = 0; col < maxDataLen; col++) {
    for (const blk of dataBlocks) if (col < blk.length) out[p++] = blk[col];
  }
  for (let col = 0; col < ecLen; col++) {
    for (const blk of ecBlocks) out[p++] = blk[col];
  }
  return out;
}

/* ------------------------------- BCH 编码 ------------------------------- */

// 返回 value 最高置位位的下标（约定 0 表示 value=0）。
function topBitIndex(value) {
  return 31 - Math.clz32(value);
}

// 通用 BCH 余数计算：对已左移 polyDeg 位的值做多项式长除法，返回 polyDeg 位以内的余数。
function bchRemainder(value, poly, polyDeg) {
  for (let i = topBitIndex(value); i >= polyDeg; i--) {
    if ((value >>> i) & 1) value ^= poly << (i - polyDeg); // 消去当前最高位的 1
  }
  return value;
}

/* ------------------------------- 矩阵构建 ------------------------------- */

// 创建 size×size 空矩阵。m 存模块颜色（1=深），fn 标记功能模块
// （功能模块不参与码字放置与掩码）。set(r, c, dark) 写入颜色并登记为功能模块。
function newMatrix(version) {
  const size = version * 4 + 17;
  const m = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const set = (r, c, dark) => {
    const i = r * size + c;
    m[i] = dark ? 1 : 0;
    fn[i] = 1;
  };
  return { version, size, m, fn, set };
}

// 三个 7×7 Finder 图案（外环深、中环浅、3×3 深芯）及其四周一圈浅色分隔符。
function drawFinders(st) {
  const { size, set } = st;
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    // 连分隔符一起画：坐标范围 [-1, 7]，越界部分跳过
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inFinder = dr >= 0 && dr < 7 && dc >= 0 && dc < 7;
        const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6; // 外环
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;     // 深芯
        set(r, c, inFinder && (edge || core));
      }
    }
  }
}

// Timing 图案：第 6 行 / 第 6 列上深浅交替的同步线（偶数下标为深色）。
function drawTiming(st) {
  const { size, set } = st;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    set(6, i, dark);
    set(i, 6, dark);
  }
}

// Alignment 图案：5×5 同心方环（中心深、环浅、外圈深）。跳过与 Finder 重叠的三个角组合。
function drawAlignments(st) {
  const { set } = st;
  const centers = ALIGN_CENTERS[st.version - 1];
  const last = centers[centers.length - 1];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          // 切比雪夫距离：0/2 为深（中心与外圈），1 为浅（环）
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
}

/*
 * 格式信息：15 位 = 2 位纠错级别 + 3 位掩码编号，经 BCH(15,5) 纠错编码
 * （生成多项式 0x537）后与 0x5412 异或（保证格式信息本身不含全 0 串）。
 * 绕两个 Finder 各放一份（共 30 个模块 + 1 个固定深色模块），解码端交叉校验。
 */
function drawFormat(st, level, mask) {
  const { size, set } = st;
  const data = (FORMAT_LEVEL_BITS[level] << 3) | mask;
  const bits = ((data << 10) | bchRemainder(data << 10, 0x537, 10)) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1; // 位 0 = LSB

  // 第一份：绕左上 Finder（行 6 被 timing 占用，纵向跳过）
  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));       // 位 0-5：列 8、行 0-5
  set(7, 8, bit(6));                                    // 位 6：行 7、列 8
  set(8, 8, bit(7));                                    // 位 7：行 8、列 8
  set(8, 7, bit(8));                                    // 位 8：行 8、列 7
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));  // 位 9-14：行 8、列 5-0

  // 第二份：右上横条 + 左下竖条
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));   // 位 0-7：行 8、列 size-1 起向左
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i)); // 位 8-14：列 8、行 size-7 起

  set(size - 8, 8, true); // 固定深色模块（解码端用于确定方向）
}

/*
 * 版本信息（仅版本 7+）：18 位 = 6 位版本号 + 12 位 BCH（生成多项式 0x1F25），不加掩码。
 * 放在右上角（6 行 × 3 列）与左下角（3 行 × 6 列）两处，位序均为 LSB 在前。
 */
function drawVersion(st) {
  const { size, set } = st;
  const bits = (st.version << 12) | bchRemainder(st.version << 12, 0x1f25, 12);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3); // 3 列（或行）一组
    const b = (i / 3) | 0;         // 0..5
    set(b, a, dark); // 右上角：行 b、列 a
    set(a, b, dark); // 左下角：行 a、列 b
  }
}

/*
 * 码字放置：从右下角开始，两列一组向左推进，组内蛇形（本组自下而上、下一组自上而下），
 * 越过第 6 列（timing）时整体左移一列。功能模块（fn=1）跳过；
 * 数据位放完后剩下的非功能模块即“剩余位”，保持浅色（0）。
 */
function placeCodewords(st, codewords) {
  const { size, m, fn } = st;
  const totalBits = codewords.length * 8;
  let i = 0; // 已放置的位序号
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;               // 跳过 timing 列
    const upward = ((right + 1) % 4) < 2;     // 每对列交替方向（首对自下而上）
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const r = upward ? size - 1 - step : step;
        const idx = r * size + c;
        if (!fn[idx] && i < totalBits) {
          m[idx] = (codewords[i >> 3] >>> (7 - (i & 7))) & 1; // MSB 先放
          i++;
        }
      }
    }
  }
}

/* ------------------------------- 掩码与罚分 ------------------------------- */

// 8 种标准掩码条件（条件成立时该模块颜色取反）。r = 行，c = 列。
const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,                                        // 000
  (r, c) => r % 2 === 0,                                              // 001
  (r, c) => c % 3 === 0,                                              // 010
  (r, c) => (r + c) % 3 === 0,                                        // 011
  (r, c) => (((r >> 1) + ((c / 3) | 0)) % 2) === 0,                   // 100
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,                      // 101
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,                // 110
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,                // 111
];

// 对所有数据模块（非功能模块）应用第 mask 号掩码（异或翻转）。
function applyMask(st, mask) {
  const { size, m, fn } = st;
  const cond = MASK_FNS[mask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (!fn[i] && cond(r, c)) m[i] ^= 1;
    }
  }
}

/* 规则 1：行/列方向同色连续长度 ≥5 的段，每段罚 3 + (长度 - 5) 分。 */
function penaltyRule1(m, size) {
  let score = 0;
  for (let axis = 0; axis < 2; axis++) { // 0 = 按行扫，1 = 按列扫
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = axis === 0 ? m[a * size + b] : m[b * size + a];
        const prev = axis === 0 ? m[a * size + b - 1] : m[(b - 1) * size + a];
        if (cur === prev) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2; // 收尾段
    }
  }
  return score;
}

/* 规则 2：每个同色 2×2 方块罚 3 分。 */
function penaltyRule2(m, size) {
  let score = 0;
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r * size + c];
      if (v === m[r * size + c + 1] && v === m[(r + 1) * size + c] && v === m[(r + 1) * size + c + 1]) {
        score += 3;
      }
    }
  }
  return score;
}

/*
 * 规则 3：出现 1:1:3:1:1 比例的特征图案（1011101 且一侧带 ≥4 个浅色模块，
 * 即行/列中匹配 10111010000 或其反向 00001011101）每处罚 40 分。
 */
const N3_PAT_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const N3_PAT_B = N3_PAT_A.slice().reverse();

function penaltyRule3(m, size) {
  let score = 0;
  const scan = (get) => {
    for (let start = 0; start + 11 <= size; start++) {
      let matchA = true, matchB = true;
      for (let k = 0; k < 11; k++) {
        const v = get(start + k);
        if (v !== N3_PAT_A[k]) matchA = false;
        if (v !== N3_PAT_B[k]) matchB = false;
        if (!matchA && !matchB) break;
      }
      if (matchA || matchB) score += 40;
    }
  };
  for (let r = 0; r < size; r++) scan((c) => m[r * size + c]); // 行方向
  for (let c = 0; c < size; c++) scan((r) => m[r * size + c]); // 列方向
  return score;
}

/* 规则 4：深色模块占比偏离 50% 时，每偏 5% 罚 10 分。 */
function penaltyRule4(m, size) {
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i];
  const percent = (dark * 100) / (size * size);
  return Math.floor(Math.abs(percent - 50) / 5) * 10;
}

// 四条规则求和，得到候选矩阵的总罚分。
function totalPenalty(st) {
  const { m, size } = st;
  return penaltyRule1(m, size) + penaltyRule2(m, size) + penaltyRule3(m, size) + penaltyRule4(m, size);
}

/* ------------------------------- 对外 API ------------------------------- */

// 文本 → UTF-8 字节。优先用平台 TextEncoder；缺失时用内置的逐步编码兜底。
function toUtf8(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp > 0xffff) i++; // 代理对占两个 code unit，多跳一步
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

// 构建一个版本/级别/掩码下的完整矩阵（功能图案 + 格式/版本信息，数据区留白）。
function buildCandidateMatrix(version, level, mask) {
  const st = newMatrix(version);
  drawFinders(st);
  drawTiming(st);
  drawAlignments(st);
  drawFormat(st, level, mask); // 每个掩码候选举自带对应格式信息
  if (version >= 7) drawVersion(st);
  return st;
}

/**
 * 生成二维码矩阵。
 * @param {string} text 内容文本（UTF-8 字节模式编码）
 * @param {{ecl?: 'L'|'M'}} opts 纠错级别，默认 'M'
 * @returns {{version:number, size:number, modules:Uint8Array}}
 *   modules 为行优先的 size*size 数组，1 = 深色模块；不含静区。
 * @throws {Error} 内容超出容量时抛 '内容太长，生成二维码失败'
 */
export function encodeQR(text, { ecl = 'M' } = {}) {
  const level = ECL_INDEX[ecl];
  if (level === undefined) {
    throw new Error(`不支持的纠错级别: ${ecl}（仅支持 'L' / 'M'）`);
  }
  const bytes = toUtf8(String(text));

  // 选择能装下内容的最小版本（1-25）
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= byteCapacity(v, level)) { version = v; break; }
  }
  if (!version) throw new Error('内容太长，生成二维码失败');

  const codewords = buildCodewords(bytes, version, level);

  // 8 种掩码逐一构建完整候选矩阵，按罚分择优（平分时保留编号更小者）
  let bestSt = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const st = buildCandidateMatrix(version, level, mask);
    placeCodewords(st, codewords);
    applyMask(st, mask);
    const score = totalPenalty(st);
    if (score < bestScore) { bestScore = score; bestSt = st; }
  }

  return { version, size: bestSt.size, modules: bestSt.m };
}

// XML 属性值转义（颜色等字符串可能含 & < > "）。
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 把矩阵渲染成完整 <svg> 字符串（自带 margin 个模块宽的静区与浅色背景）。
 * @param {{version:number, size:number, modules:Uint8Array}} matrix encodeQR 的返回值
 * @param {{moduleSize?:number, margin?:number, dark?:string, light?:string}} opts
 */
export function qrToSvg(matrix, { moduleSize = 8, margin = 4, dark = '#1A1A1A', light = '#FFFFFF' } = {}) {
  const { size, modules } = matrix;
  const dim = size + margin * 2; // 以“模块”为单位的边长（含两侧静区）
  // 所有深色模块合并为一条 path：M{x} {y}h1v1h-1z（模块坐标系，经 viewBox 放大）
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const px = dim * moduleSize;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"` +
    ` viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="${xmlEscape(light)}"/>` +
    (path ? `<path d="${path}" fill="${xmlEscape(dark)}"/>` : '') +
    `</svg>`
  );
}

/**
 * 生成可直接放入 <img src> 的 SVG data URL（encodeURIComponent 形式）。
 * @param {string} text 内容文本
 * @param {object} opts 同时供 encodeQR（如 ecl）与 qrToSvg（如 moduleSize/margin/dark/light）使用
 */
export function qrDataUrl(text, opts = {}) {
  const matrix = encodeQR(text, opts);
  return 'data:image/svg+xml,' + encodeURIComponent(qrToSvg(matrix, opts));
}

/**
 * 给分享链接用的一站式接口：编码 → 选纠错级别 → 直接可放进 <img> 的 data URL，
 * 并把"这个码扫不扫得动"所需的数字一并给出来。
 * 纠错级别先试 M，装不下再退 L（容量更大、容错更低）；两级都超引擎上限才算装不下。
 * @param {string} text 内容（分享链接）
 * @param {{box?:number, moduleSize?:number, margin?:number}} opts box = 页面上的承载边长（px）
 * @returns {{dataUrl:string, version:number, size:number, ecl:string, pxPerModule:number}|null} 装不下返回 null
 */
export function qrInfo(text, { box = 248, moduleSize = 8, margin = 4 } = {}) {
  for (const ecl of ['M', 'L']) {
    try {
      const matrix = encodeQR(text, { ecl });
      return {
        dataUrl: 'data:image/svg+xml,' +
          encodeURIComponent(qrToSvg(matrix, { moduleSize, margin, dark: '#1A1A1A', light: '#FFFFFF' })),
        version: matrix.version,
        size: matrix.size,
        ecl,
        pxPerModule: box / matrix.size,
      };
    } catch {
      // 换下一级（L 容量更大）再试
    }
  }
  return null;
}

/**
 * 用 Canvas 2D 把矩阵绘制到画布上（含 margin 个模块的静区，浅色打底）。
 * @param {HTMLCanvasElement} canvas 目标画布（宽高会被重设为实际像素尺寸）
 * @param {{version:number, size:number, modules:Uint8Array}} matrix encodeQR 的返回值
 * @param {{scale?:number, margin?:number, dark?:string, light?:string}} opts
 */
export function drawToCanvas(canvas, matrix, { scale = 8, margin = 4, dark = '#1A1A1A', light = '#FFFFFF' } = {}) {
  const { size, modules } = matrix;
  const px = (size + margin * 2) * scale;
  canvas.width = px;  // 重设宽高会清空画布
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;                 // 静区与浅色模块统一由背景承担
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) {
        ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
  }
}
