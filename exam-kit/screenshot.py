#!/usr/bin/env python3
"""可选截图：先运行 analysis.py，再执行同一环境的 python screenshot.py。"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    source = ROOT / 'index.html'
    output = ROOT / 'preview.png'
    output.unlink(missing_ok=True)
    if not source.is_file():
        raise SystemExit('没有 index.html，请先成功运行 bash run.sh。')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit('截图需要可选依赖：python -m pip install -r requirements-preview.txt，然后 python -m playwright install chromium。')
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(source.as_uri(), wait_until='load')
            page.wait_for_function("document.querySelector('#kpis').children.length > 0")
            page.evaluate('document.fonts.ready')
            if errors:
                raise RuntimeError('页面脚本错误：' + '; '.join(errors))
            page.screenshot(path=str(output), full_page=True)
        finally:
            browser.close()
    print('已生成 preview.png；对应 index.html SHA-256：' + hashlib.sha256(source.read_bytes()).hexdigest())

if __name__ == '__main__':
    main()
