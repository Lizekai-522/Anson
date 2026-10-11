#!/usr/bin/env python3
# 生成闽南语（Min Nan / 台湾闽南语）离线音频包。
#
# 用现成的开源模型批量合成，不需要任何在线 TTS 服务：
#   模型：facebook/mms-tts-nan（Meta MMS 项目，VITS 架构，CC-BY-NC-4.0，非商用）
#   文本：scripts/minnan-templates.json（每类卡片 5 句 + 4 句通用）
#   输出：public/audio/nan/<id>.mp3（单声道 24kbps）+ manifest.json + NOTICE.md
#
# 依赖（Python 3.12 建议）：
#   pip install torch --index-url https://download.pytorch.org/whl/cpu
#   pip install transformers scipy
# 还需要系统里的 ffmpeg（用于 wav → mp3）。
#
# 跑法：  python3 scripts/make-minnan-audio.py
# 判断标准（脚本会自动检查）：音频总体积 < 300KB。超了就报错，不会偷偷写进仓库。
#
# 网络说明：如果连不上 huggingface.co（部分网络会挡），用镜像即可：
#   HF_ENDPOINT=https://hf-mirror.com python3 scripts/make-minnan-audio.py
#
# 换音色：模型换成别的开源闽南语 TTS（如 OpenBMB/VoxCPM2，Apache-2.0 可商用，但需要 GPU）时，
# 只要保持「id → 同一句话」的对应关系，运行时不需要改动。

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(ROOT, 'scripts', 'minnan-templates.json')
OUT_DIR = os.path.join(ROOT, 'public', 'audio', 'nan')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')
MAX_TOTAL_BYTES = 300 * 1024
MODEL_ID = 'facebook/mms-tts-nan'
BITRATE = '24k'
SAMPLE_RATE = 16000


def die(msg):
    print('[minnan] ' + msg, file=sys.stderr)
    print('[minnan] 音频包未生成；运行时会自动降级（设备台语声音 → 无则提示），其它功能不受影响。', file=sys.stderr)
    sys.exit(1)


def to_mp3(wav_path, mp3_path):
    """单声道 + 24kbps：整套 29 句控制在 300KB 以内的关键"""
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
           '-ac', '1', '-ar', str(SAMPLE_RATE), '-b:a', BITRATE, mp3_path]
    subprocess.run(cmd, check=True)


def main():
    try:
        import torch
        import scipy.io.wavfile as wavfile
        from transformers import VitsModel, AutoTokenizer, set_seed
    except Exception as e:  # noqa: BLE001
        die('缺少依赖（%s）。先装 torch/transformers/scipy，见脚本头部说明。' % e)

    try:
        subprocess.run(['ffmpeg', '-version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001
        die('找不到 ffmpeg（wav → mp3 需要它）')

    with open(TEMPLATES, encoding='utf-8') as f:
        spec = json.load(f)
    items = spec.get('items') or []
    if not items:
        die('模板为空：scripts/minnan-templates.json')

    print('[minnan] 加载模型 %s …（首次会下载权重，约 145MB）' % MODEL_ID)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = VitsModel.from_pretrained(MODEL_ID)
    model.eval()
    if getattr(tokenizer, 'is_uroman', False):
        die('该模型的 tokenizer 需要 uroman 预处理（pip install uroman 后按官方文档处理），当前脚本未启用')

    os.makedirs(OUT_DIR, exist_ok=True)
    out_items = {}
    total = 0

    with tempfile.TemporaryDirectory() as tmp:
        for it in items:
            iid = it['id']
            text = it['text']
            inputs = tokenizer(text, return_tensors='pt')
            ids = inputs['input_ids'][0]
            # 这个模型的词表只有 48 个罗马字字符：喂汉字会 tokenize 成 0，VITS 内部会崩。
            # 与其产出坏音频，不如在这里就停下来（模板里必须写台罗/白话字罗马字）。
            if len(ids) < 5:
                die('%s 的文本只 tokenize 出 %d 个字符 —— 该模型要罗马字输入（台罗/白话字），'
                    '别写汉字。当前文本：%s' % (iid, len(ids), text))
            set_seed(555)
            with torch.no_grad():
                waveform = model(**inputs).waveform[0]
            wav_path = os.path.join(tmp, iid + '.wav')
            wavfile.write(wav_path, rate=model.config.sampling_rate, data=waveform.numpy())
            mp3_path = os.path.join(OUT_DIR, iid + '.mp3')
            to_mp3(wav_path, mp3_path)
            size = os.path.getsize(mp3_path)
            secs = len(waveform) / float(model.config.sampling_rate)
            total += size
            out_items[iid] = {
                'file': iid + '.mp3',
                'bytes': size,
                'seconds': round(secs, 2),
                'text': text,
                'hanzi': it.get('hanzi', ''),
            }
            print('  · %s  %5dB  %4.1fs  %s' % (iid, size, secs, it.get('hanzi') or text))

    if total >= MAX_TOTAL_BYTES:
        die('音频总体积 %d 字节 ≥ %d 字节上限：请减少句数或调低码率' % (total, MAX_TOTAL_BYTES))

    manifest = {
        'version': spec.get('version', 1),
        'model': MODEL_ID,
        'license': spec.get('license', 'CC-BY-NC-4.0'),
        'totalBytes': total,
        'items': out_items,
    }
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('[minnan] OK → %d 句，共 %d 字节（上限 %d），manifest 已写入 %s'
          % (len(out_items), total, MAX_TOTAL_BYTES, os.path.relpath(MANIFEST, ROOT)))


if __name__ == '__main__':
    main()