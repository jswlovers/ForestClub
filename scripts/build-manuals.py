"""docs/*.md 매뉴얼을 PDF로 변환한다. (markdown → HTML → Chrome/Edge headless 인쇄)

사용: python scripts/build-manuals.py
"""
import pathlib
import subprocess
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
]

CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; font-size: 10.5pt; line-height: 1.65; color: #1f2933; }
h1 { font-size: 22pt; color: #1b3328; border-bottom: 3px solid #c9a960; padding-bottom: 8px; margin-top: 0; }
h2 { font-size: 15pt; color: #1b3328; margin-top: 26px; border-bottom: 1px solid #d8d2c2; padding-bottom: 4px; page-break-after: avoid; }
h3 { font-size: 12pt; color: #2f5d46; margin-top: 18px; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; page-break-inside: avoid; }
th { background: #1b3328; color: #fff; text-align: left; padding: 6px 8px; }
td { border: 1px solid #d8d2c2; padding: 5px 8px; vertical-align: top; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #f7f3e8; border-left: 4px solid #c9a960; color: #4a4437; }
code { background: #f0efe9; padding: 1px 4px; border-radius: 3px; font-family: Consolas, 'Malgun Gothic', monospace; font-size: 9.5pt; }
pre { background: #f0efe9; padding: 10px 12px; border-radius: 4px; page-break-inside: avoid; }
pre code { padding: 0; background: none; }
a { color: #2f5d46; text-decoration: none; }
hr { border: 0; border-top: 1px solid #d8d2c2; margin: 20px 0; }
li { margin: 2px 0; }
"""


def find_browser():
    for path in BROWSERS:
        if pathlib.Path(path).exists():
            return path
    sys.exit('Chrome 또는 Edge를 찾을 수 없어요')


def build(md_path, browser):
    text = md_path.read_text(encoding='utf-8')
    body = markdown.markdown(text, extensions=['tables', 'fenced_code', 'toc'])
    html_path = md_path.with_suffix('.html')
    html_path.write_text(
        f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>',
        encoding='utf-8',
    )
    pdf_path = md_path.with_suffix('.pdf')
    subprocess.run(
        [browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
         f'--print-to-pdf={pdf_path}', html_path.as_uri()],
        check=True, capture_output=True,
    )
    html_path.unlink()
    print('생성:', pdf_path)


if __name__ == '__main__':
    browser = find_browser()
    for md in sorted(DOCS.glob('*.md')):
        build(md, browser)
