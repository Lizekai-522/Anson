/**
 * 「安程」自研二维码引擎单元测试。
 *
 * 核心手段：往返解码测试——用独立的第三方解码器 jsQR 做「编码 → RGBA 位图 → 解码」，
 * 绝不自己解码自己。只要 RS 块结构表、格式/版本信息、掩码、交错排布任何一环出错，
 * jsQR 的纠错校验都会失败并返回 null。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, qrToSvg, qrDataUrl, drawToCanvas } from '../../src/core/qr.js';
import jsQR from 'jsqr';

/* ---------------------------------- 工具 ---------------------------------- */

const SCALE = 8; // 每个模块 8×8 像素
const QUIET = 4; // 四周留 4 个模块宽的静区（jsQR 推荐）

// 把 encodeQR 的 modules 栅格化成 RGBA 位图：深色=(0,0,0,255)，浅色/静区=(255,255,255,255)
function toRGBA(matrix) {
  const { size, modules } = matrix;
  const dim = (size + QUIET * 2) * SCALE; // 位图边长（像素）
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mr = Math.floor(y / SCALE) - QUIET; // 对应矩阵行号
      const mc = Math.floor(x / SCALE) - QUIET; // 对应矩阵列号
      const inside = mr >= 0 && mr < size && mc >= 0 && mc < size;
      const dark = inside && modules[mr * size + mc] === 1;
      const v = dark ? 0 : 255;
      const i = (y * dim + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, dim };
}

// 交给 jsQR 解码，返回 { data } 或 null
function decode(matrix) {
  const { data, dim } = toRGBA(matrix);
  return jsQR(data, dim, dim);
}

// 往返断言：编码后必须能被 jsQR 解出原文
function roundTrip(text, ecl) {
  const matrix = encodeQR(text, { ecl });
  const res = decode(matrix);
  assert.ok(res, `jsQR 解码失败: ecl=${ecl} bytes=${Buffer.byteLength(text, 'utf8')} version=${matrix.version}`);
  assert.equal(res.data, text, `解码内容不符: ecl=${ecl} version=${matrix.version}`);
  return matrix;
}

/* --------------------------- 往返解码测试（最重要） --------------------------- */

test('往返："Hi"（ASCII 短文本，v1），L 与 M', () => {
  for (const ecl of ['L', 'M']) {
    const m = roundTrip('Hi', ecl);
    assert.equal(m.version, 1); // 2 字节在两种级别下都应落在最小版本 1
  }
});

test('往返："安程"（中文，UTF-8），L 与 M', () => {
  for (const ecl of ['L', 'M']) roundTrip('安程', ecl);
});

test('往返：URL（含符号 #/.），L 与 M', () => {
  for (const ecl of ['L', 'M']) {
    roundTrip('https://example.com/#/e/abc.123', ecl);
  }
});

test('往返：约 300 字节 JSON（触发多块 + 16 位字符计数），L 与 M', () => {
  const json = JSON.stringify({
    app: '安程', ver: 1, type: 'trip',
    from: '杭州市西湖区文三路 100 号',
    to: '上海市静安区南京西路 2000 号',
    depart: '2026-10-09 13:20', arrive: '2026-10-09 15:05',
    gate: 'B12', seat: '05A', train: 'G7352',
    tips: '记得带身份证和保温杯，检票口在二楼。',
  });
  const bytes = Buffer.byteLength(json, 'utf8');
  assert.ok(bytes >= 260 && bytes <= 340, `JSON 应约 300 字节，实际 ${bytes}`);
  for (const ecl of ['L', 'M']) {
    const m = roundTrip(json, ecl);
    assert.ok(m.version >= 10, `约 300 字节应命中 v10+（16 位计数），实际 v${m.version}`);
  }
});

test('往返：约 700 字节 JSON（高版本，v7+ 版本信息块），L 与 M', () => {
  const json = JSON.stringify({
    app: '安程', ver: 1, type: 'trip-share',
    id: 'TRIP-20261009-G7352-B12-05A',
    from: { name: '杭州东站', addr: '杭州市上城区全福桥路 2 号', time: '2026-10-09 13:20' },
    to: { name: '上海虹桥站', addr: '上海市闵行区申虹路 1500 号', time: '2026-10-09 15:05' },
    steps: [
      { mode: '地铁', line: '1号线', from: '凤起路', to: '火车东站', min: 18 },
      { mode: '高铁', no: 'G7352', seat: '05车12A', min: 62 },
      { mode: '公交', line: '941路', from: '虹桥西交通中心', to: '申虹路', min: 14 },
    ],
    tips: '提前 30 分钟到站；身份证放在背包前袋；出站后跟着「出站」指示牌走，候车时留意大屏车次信息。',
  });
  const bytes = Buffer.byteLength(json, 'utf8');
  assert.ok(bytes >= 620 && bytes <= 710, `JSON 应约 700 字节，实际 ${bytes}`);
  for (const ecl of ['L', 'M']) {
    const m = roundTrip(json, ecl);
    assert.ok(m.version >= 7, `约 700 字节应命中 v7+（含版本信息块），实际 v${m.version}`);
  }
});

/* --------------------------------- 结构测试 --------------------------------- */

test('结构：三个 7×7 finder 图案存在且图案正确', () => {
  const m = encodeQR('finder-pattern-check', { ecl: 'M' });
  const { size, modules } = m;
  const expect = (dr, dc) => {
    const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6; // 外环深色
    const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;     // 3×3 深芯
    return edge || core ? 1 : 0;
  };
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        assert.equal(modules[(r0 + dr) * size + (c0 + dc)], expect(dr, dc),
          `finder@(${r0},${c0}) 模块(${dr},${dc}) 不符`);
      }
    }
  }
  // 左下角的固定深色模块
  assert.equal(modules[(size - 8) * size + 8], 1);
});

test('结构：timing 图案深浅交替（偶数位为深）', () => {
  const m = encodeQR('timing-check-123', { ecl: 'M' });
  const { size, modules } = m;
  for (let i = 8; i < size - 8; i++) {
    const expect = i % 2 === 0 ? 1 : 0;
    assert.equal(modules[6 * size + i], expect, `行 timing @${i}`);
    assert.equal(modules[i * size + 6], expect, `列 timing @${i}`);
  }
});

test('结构：size = 21 + 4 * (version - 1)，modules 为 size² 的 0/1 Uint8Array', () => {
  for (const text of ['Hi', '安程', 'https://example.com/#/e/abc.123', 'x'.repeat(600)]) {
    const m = encodeQR(text, { ecl: 'M' });
    assert.equal(m.size, 21 + 4 * (m.version - 1), `text len=${text.length}`);
    assert.ok(m.modules instanceof Uint8Array);
    assert.equal(m.modules.length, m.size * m.size);
    for (let i = 0; i < m.modules.length; i++) {
      assert.ok(m.modules[i] === 0 || m.modules[i] === 1, `模块值只能是 0/1，出现 ${m.modules[i]}`);
    }
  }
});

test('确定性：同一输入两次生成结果完全一致', () => {
  for (const text of ['deterministic', '安程', 'x'.repeat(600)]) {
    for (const ecl of ['L', 'M']) {
      const a = encodeQR(text, { ecl });
      const b = encodeQR(text, { ecl });
      assert.equal(a.version, b.version);
      assert.equal(a.size, b.size);
      assert.deepEqual(Buffer.from(a.modules).equals(Buffer.from(b.modules)), true);
    }
  }
});

/* --------------------------------- 容量边界 --------------------------------- */

test('容量：超出 v25 容量抛 Error("内容太长，生成二维码失败")', () => {
  assert.throws(() => encodeQR('x'.repeat(2000)), (err) => err instanceof Error && err.message === '内容太长，生成二维码失败');
  // 默认级别为 M：v25-M 数据码字 1000 个，扣除 4 位模式符 + 16 位计数后容量 997 字节
  assert.throws(() => encodeQR('x'.repeat(998)), /内容太长/);
  // 恰好 997 字节（v25-M 满载）不应抛错，且必须落到最大版本 25
  assert.equal(encodeQR('x'.repeat(997)).version, 25);
  // L 级别：v25-L 数据码字 1276 个，容量 1273 字节；1274 应抛错
  assert.throws(() => encodeQR('x'.repeat(1274), { ecl: 'L' }), /内容太长/);
  assert.equal(encodeQR('x'.repeat(1273), { ecl: 'L' }).version, 25);
});

/* ------------------------------- 渲染接口测试 ------------------------------- */

test('qrToSvg：完整 <svg>（xmlns / 宽高 / crispEdges / 静区 / 颜色）', () => {
  const m = encodeQR('svg-render-check', { ecl: 'M' });
  const svg = qrToSvg(m);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  const dim = m.size + 4 * 2; // 默认 margin=4
  assert.ok(svg.includes(`width="${dim * 8}"`), '默认 moduleSize=8');
  assert.ok(svg.includes(`height="${dim * 8}"`));
  assert.ok(svg.includes(`viewBox="0 0 ${dim} ${dim}"`));
  assert.ok(svg.includes('fill="#1A1A1A"'), '默认深色 #1A1A1A');
  assert.ok(svg.includes('fill="#FFFFFF"'), '默认浅色 #FFFFFF');
  // path 中深色模块数 = 矩阵深色模块数
  const darkInMatrix = m.modules.reduce((n, v) => n + v, 0);
  const path = svg.match(/<path d="([^"]*)"/)[1];
  assert.equal((path.match(/M/g) || []).length, darkInMatrix);
  // 自定义参数生效
  const custom = qrToSvg(m, { moduleSize: 5, margin: 2, dark: '#123456', light: '#ABCDEF' });
  assert.ok(custom.includes(`width="${(m.size + 4) * 5}"`));
  assert.ok(custom.includes('viewBox="0 0 ' + (m.size + 4) + ' ' + (m.size + 4) + '"'));
  assert.ok(custom.includes('fill="#123456"') && custom.includes('fill="#ABCDEF"'));
});

test('qrDataUrl：data:image/svg+xml 前缀，解码后与 qrToSvg 输出一致，可直接放入 <img src>', () => {
  const url = qrDataUrl('data-url-check', { ecl: 'M' });
  assert.ok(url.startsWith('data:image/svg+xml,'));
  const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
  assert.equal(svg, qrToSvg(encodeQR('data-url-check', { ecl: 'M' })));
  // encodeURIComponent 后不允许残留裸空格/引号（保证 <img src> 属性安全）
  assert.doesNotMatch(url, /["' ]/);
});

test('drawToCanvas：mock 2D 上下文校验宽高、背景与深色矩形', () => {
  const m = encodeQR('canvas-draw-check', { ecl: 'M' });
  const calls = [];
  const ctx = {
    fillStyle: null,
    fillRect(x, y, w, h) { calls.push({ x, y, w, h, style: this.fillStyle }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  drawToCanvas(canvas, m); // 默认 scale=8, margin=4

  const px = (m.size + 8) * 8;
  assert.equal(canvas.width, px);
  assert.equal(canvas.height, px);
  // 第 1 笔 = 浅色背景铺满
  assert.equal(calls[0].style, '#FFFFFF');
  assert.deepEqual([calls[0].x, calls[0].y, calls[0].w, calls[0].h], [0, 0, px, px]);
  // 其余每笔 = 一个深色模块：fillStyle 为深色，位置含静区偏移，尺寸 = scale
  const darks = calls.slice(1);
  let darkCount = 0;
  let checked = 0;
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.modules[r * m.size + c] === 1) {
        darkCount++;
        if (checked < 5) { // 抽查前 5 个深色模块的位置与样式
          const call = darks[checked];
          assert.equal(call.style, '#1A1A1A');
          assert.deepEqual([call.x, call.y, call.w, call.h], [(c + 4) * 8, (r + 4) * 8, 8, 8]);
          checked++;
        }
      }
    }
  }
  assert.equal(darks.length, darkCount);
  // 自定义 scale/margin/颜色
  const calls2 = [];
  const ctx2 = { fillStyle: null, fillRect(x, y, w, h) { calls2.push({ x, y, w, h, style: this.fillStyle }); } };
  const canvas2 = { width: 0, height: 0, getContext: () => ctx2 };
  drawToCanvas(canvas2, m, { scale: 4, margin: 2, dark: '#111111', light: '#EEEEEE' });
  assert.equal(canvas2.width, (m.size + 4) * 4);
  assert.equal(calls2[0].style, '#EEEEEE');
  assert.equal(calls2[1].style, '#111111');
});
