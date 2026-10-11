# 闽南语音频包 · 来源与许可

本目录放的是长辈端「闽南话播报」用的**离线音频包**：29 句（每类卡片 5 句 + 4 句通用），
单声道 24kbps mp3，**总计约 285KB（上限 300KB）**。

## 生成方式

```bash
python3 scripts/make-minnan-audio.py
# 连不上 huggingface.co 时用镜像：
HF_ENDPOINT=https://hf-mirror.com python3 scripts/make-minnan-audio.py
```

- 脚本：`scripts/make-minnan-audio.py`
- 模板：`scripts/minnan-templates.json`（id 与 `src/core/elderVoice.js` 的 `nan_<kind>_<n>` 一一对应）
- 输出：`<id>.mp3` + `manifest.json`（id → 文件名 / 字节数 / 时长 / 合成文本）
- 自检：音频总体积必须 < 300KB；**若模板写成汉字会直接报错退出**（见下）

## 一个必须知道的技术细节

`facebook/mms-tts-nan` 的**词表只有 48 个罗马字字符**（含 `ê ̍ â ó ō` 这类声调符号）。
喂汉字进去会 tokenize 成 0 个字符、VITS 内部直接崩。
所以模板里 **`text` 必须是台罗/白话字罗马字**（`hanzi` 字段只是给人看的汉字对照）。
脚本会在 tokenize 出 <5 个字符时立刻停下并说明原因 —— 宁可不生成，也不产出坏音频。

## 模型与许可（重要）

| 项 | 值 |
|---|---|
| 模型 | `facebook/mms-tts-nan`（Meta「Massively Multilingual Speech」项目，VITS 架构） |
| 许可 | **CC-BY-NC-4.0（非商用）** |
| 含义 | 本目录的音频**只能用于非商业用途**。若要商用，请换掉音频包 |

**商用替换路径**：`OpenBMB/VoxCPM2`（Apache-2.0，明确支持闽南话等 9 种中文方言，但需要 ~8GB 显存）；
或直接换成真人录制的闽南语语音——只要保持 `id → 同一句话` 的对应关系，前端代码无需改动。

## 可信度声明（别跳过）

- **文本**：罗马字与汉字写法按通用台罗/白话字惯例整理，**未经闽南语母语者逐句校对**。
- **音频**：机器合成音，**未经母语者试听**。可懂度请人工抽听确认；若发现难懂，
  最省事的做法是把 `manifest.json` 的 `items` 清空（或删掉 mp3），
  运行时会自动走「设备台语声音」或「如实提示」的降级链，其它功能不受影响。

## 没有音频包会怎样

运行时按 `src/core/elderVoice.js` 的降级链走：
1. 设备自带台语/闽南语声音 → 直接念**动态完整句**（带车次、站点、时刻）
2. 没有这种声音但有音频包 → 播**骨架句**音频（离网可播）
3. 都没有 → 如实提示「这台设备没有闽南语声音」，普通话照常可用

## 单文件版说明

`npm run build:single` 产出的单文件 HTML 只内联 JS/CSS，音频仍走 `audio/nan/*.mp3`。
以 `file://` 直接打开时音频取不到，会走上面的降级链（不影响行程本身）。