"""md -> html (팀 공통 스타일, 지해나:공실 서브에이전트 html과 같은 색). pandoc 필요.
사용 (중간발표_1119 폴더에서): python3 _변환/md2html.py 05_MVP_가설판정.md ...  → 같은 위치에 .html"""
import sys, re, subprocess, html, pathlib
STYLE = (pathlib.Path(__file__).parent / 'style.html').read_text(encoding='utf8')
for src in sys.argv[1:]:
    p = pathlib.Path(src); md = p.read_text(encoding='utf8')
    m = re.search(r'^# (.+)$', md, re.M); title = m.group(1).strip() if m else p.stem
    body = subprocess.run(['pandoc', '-f', 'gfm+hard_line_breaks', '-t', 'html5', '--wrap=none'], input=md, capture_output=True, text=True, check=True).stdout
    body = re.sub(r'<hr />\s*', '', body)
    body = re.sub(r'<table>', '<div class="tw"><table>', body).replace('</table>', '</table></div>')
    body = re.sub(r'\s(style="text-align: (left|right|center);")', lambda x: f' class="al-{x.group(2)}"', body)
    mer = ''
    if 'class="mermaid"' in body or '<pre class="mermaid">' in body or 'language-mermaid' in body:
        body = re.sub(r'<pre class="mermaid"><code>(.*?)</code></pre>', lambda x: f'<pre class="mermaid">{x.group(1)}</pre>', body, flags=re.S)
        mer = ('<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>'
               '<script>mermaid.initialize({startOnLoad:true,theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"default"});</script>')
    extra = '<style>.al-right{text-align:right}.al-center{text-align:center}pre.mermaid{background:var(--surface)}</style>'
    out = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
{STYLE}
{extra}
</head>
<body>
<div class="wrap">
<!-- 원본: {p.name} (이 html은 md에서 변환한 것. 내용은 md를 고친 뒤 다시 변환) -->
{body}
</div>
{mer}
</body>
</html>
'''
    p.with_suffix('.html').write_text(out, encoding='utf8'); print('ok', p.with_suffix('.html'))
