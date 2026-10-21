# 用和旧版一样的童声（edge-tts zh-CN-XiaoyiNeural）补录缺的语音，写回 assets/aud.js。
# 用法：python3 tools/voice.py missing.json   （missing.json 是要录的文字列表）
# 需要网络能访问 speech.platform.bing.com。
import asyncio, base64, json, os, pathlib, subprocess, sys, tempfile
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUD_JS = ROOT / 'assets/aud.js'
ZH, EN = 'zh-CN-XiaoyiNeural', 'en-US-AnaNeural'


def load_aud():
    t = AUD_JS.read_text(encoding='utf-8')
    return json.loads(t[t.index('=') + 1:].rstrip().rstrip(';'))


async def tts(text, path):
    en = all(ord(c) < 128 for c in text)
    core = text.replace('，嗯，', '').strip('，。！？')
    # 和旧版一样：两个字以内念慢一点
    rate = '-15%' if en else ('-20%' if len(core) <= 2 else '-8%')
    kw = dict(voice=EN if en else ZH, rate=rate)
    if not en:
        kw['pitch'] = '+5Hz'
    proxy = os.environ.get('HTTPS_PROXY')
    await edge_tts.Communicate(text, proxy=proxy, **kw).save(path)


def trim(src, dst):
    # 去掉开头结尾的静音，单声道 24kHz 32kbps，和旧版一致
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af',
                    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
                    '-ac', '1', '-ar', '24000', '-b:a', '32k', dst], check=True)


async def main(lst):
    aud = load_aud()
    todo = [t for t in json.loads(pathlib.Path(lst).read_text(encoding='utf-8')) if t not in aud]
    print('要录', len(todo), '条')
    sem = asyncio.Semaphore(4)
    done = 0
    with tempfile.TemporaryDirectory() as d:
        async def one(i, text):
            nonlocal done
            raw, out = f'{d}/{i}.mp3', f'{d}/{i}t.mp3'
            async with sem:
                for attempt in range(4):
                    try:
                        await tts(text, raw)
                        break
                    except Exception as e:
                        if attempt == 3:
                            print('失败', text, e)
                            return
                        await asyncio.sleep(2 ** attempt)
            trim(raw, out)
            aud[text] = 'data:audio/mpeg;base64,' + base64.b64encode(pathlib.Path(out).read_bytes()).decode()
            done += 1
            if done % 50 == 0:
                print(done)
        await asyncio.gather(*(one(i, t) for i, t in enumerate(todo)))
    AUD_JS.write_text('window.AUD=' + json.dumps(aud, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')
    print('完成', done, '条，现在共有', len(aud), '条录音')


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1]))
