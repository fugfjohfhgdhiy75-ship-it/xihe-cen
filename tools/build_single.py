# 打包成一个可以直接打开的 HTML：代码、图片、录音、字体全部内嵌。
# 用法：python3 tools/build_single.py  → 生成 dist/恐龙认字大冒险.html
import base64, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')

imgs = {p.stem: 'data:image/webp;base64,' + base64.b64encode(p.read_bytes()).decode()
        for p in sorted((ROOT / 'assets/img').glob('*.webp'))}
font = 'data:font/ttf;base64,' + base64.b64encode((ROOT / 'assets/andika.ttf').read_bytes()).decode()


def patch_js(src):
    # 单引号字符串里的固定路径：'url(assets/img/bg_grass.webp)'
    src = re.sub(r"'([^'\n]*?)assets/img/([A-Za-z0-9_]+)\.webp([^'\n]*?)'",
                 r"'\1'+IMG('\2')+'\3'", src)
    # 模板字符串里的路径：`assets/img/dino_${id}.webp`
    src = re.sub(r"assets/img/([^`'\"\s]*?)\.webp", r"${IMG(`\1`)}", src)
    assert 'assets/img/' not in src
    return src.replace('</script', '<\\/script')


head = '<script>window.IMGS=' + json.dumps(imgs) + ';window.IMG=n=>window.IMGS[n]||"";</script>\n'
aud = (ROOT / 'assets/aud.js').read_text(encoding='utf-8').replace('</script', '<\\/script')


def inline(m):
    path = m.group(1)
    if path == 'assets/aud.js':
        return '<script>' + aud + '</script>'
    return '<script>' + patch_js((ROOT / path).read_text(encoding='utf-8')) + '</script>'


html = html.replace('url(assets/andika.ttf)', 'url(' + font + ')')
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
html = html.replace('<div id="app"></div>', head + '<div id="app"></div>', 1)
assert 'src="js/' not in html and 'assets/' not in html.replace('assets/img/', '')

out = ROOT / 'dist' / '恐龙认字大冒险.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, round(out.stat().st_size / 1e6, 2), 'MB')
