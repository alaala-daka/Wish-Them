"""前后端联调的浏览器验收脚本。

前置：
  1) npm run server      # http://127.0.0.1:8787
  2) npm run dev         # http://127.0.0.1:5173（Vite 代理 /functions 与 /__storage）
  3) pip install playwright，并安装系统 Edge（脚本使用 channel='msedge'）

运行：python tests/browser_smoke.py
"""
from pathlib import Path
import json
import sys
import urllib.request
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)

for name, url in [('backend', 'http://127.0.0.1:8787/api/health'), ('frontend', 'http://127.0.0.1:5173/')]:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            assert response.status == 200
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f'{name} 未启动：{error}') from error

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page = context.new_page()
    errors: list[str] = []
    page.on('pageerror', lambda err: errors.append(str(err)))

    page.goto('http://127.0.0.1:5173/')
    page.evaluate("indexedDB.deleteDatabase('yuanta-postoffice'); localStorage.clear()")
    page.reload()
    expect(page.get_by_role('button', name='替TA许个愿', exact=True)).to_be_visible(timeout=15000)
    expect(page.locator('.recovery-banner')).to_be_visible()
    page.screenshot(path=str(OUT / '01-home.png'), full_page=True)

    # 四步许愿：关系 → 愿望（含 AI 建议）→ 五问 → 签名立契
    page.get_by_role('button', name='替TA许个愿', exact=True).click()
    page.get_by_label('你平时怎么称呼TA？').fill('妈妈')
    page.get_by_role('button', name='下一步', exact=True).click()
    page.get_by_label('写下你的愿望').fill('希望妈妈每天都能睡个好觉，不再被小毛病打扰。')
    page.get_by_role('button', name='帮我找找表达').click()
    expect(page.locator('.suggestions')).to_be_visible(timeout=15000)
    expect(page.locator('.suggestions .tag').first).to_have_text('AI辅助')
    page.locator('.suggestions button', has_text='选用').first.click()
    page.get_by_role('button', name='下一步', exact=True).click()
    for answer in ['最近她总说腰疼', '会有一点', '上周日', '500元', '想陪她散步']:
        page.get_by_label('写一点你愿意说的（1–200 字）').fill(answer)
        next_question = page.get_by_role('button', name='下一题', exact=True)
        if next_question.count():
            next_question.click()
    page.get_by_label('签下你的称呼').fill('小叶')
    page.get_by_role('checkbox').check()
    page.get_by_role('button', name='签下约定', exact=True).click()
    expect(page.get_by_role('heading', name='今天，也替心意走一小步')).to_be_visible(timeout=25000)

    # 今日任务：上传证明 → 打卡 → 刷新后仍在
    page.get_by_role('button', name='去记录', exact=True).first.click()
    page.locator('input[type=file]').set_input_files(str(ROOT / 'public/assets/postoffice.png'))
    page.get_by_label('留一句话（可选）').fill('今天给妈妈打了电话。')
    expect(page.get_by_role('button', name='收好今天的记录')).to_be_enabled(timeout=15000)
    page.get_by_role('button', name='收好今天的记录').click()
    expect(page.get_by_text('已完成 1/2', exact=True)).to_be_visible(timeout=20000)
    page.reload()
    expect(page.get_by_text('已完成 1/2', exact=True)).to_be_visible(timeout=20000)
    page.get_by_role('button', name='查看记录', exact=True).first.click()
    expect(page.locator('img.proof')).to_be_visible(timeout=15000)
    assert page.locator('img.proof').evaluate('el => el.naturalWidth') > 0
    page.screenshot(path=str(OUT / '02-today.png'), full_page=True)

    # 账本：周预算 + 支出，汇总来自服务端
    page.get_by_role('link', name='账本', exact=True).click()
    page.get_by_label('记账类型').select_option('budget')
    page.get_by_label('金额（元，取整）').fill('80')
    page.get_by_role('button', name='记到账本', exact=True).click()
    expect(page.get_by_label('金额（元，取整）')).to_have_value('', timeout=15000)
    page.get_by_label('记账类型').select_option('expense')
    page.get_by_label('金额（元，取整）').fill('32')
    page.get_by_role('button', name='记到账本', exact=True).click()
    expect(page.locator('.ledger-summary .total strong')).to_have_text('¥48', timeout=15000)
    page.screenshot(path=str(OUT / '03-ledger.png'), full_page=True)

    # 愿签池：没有真实公开帖时回退为明确标注的示例；回信保存在本机
    page.get_by_role('link', name='愿签池', exact=True).click()
    expect(page.locator('.pool-grid>.paper')).to_have_count(6, timeout=15000)
    page.get_by_role('button', name='读一读这份心意').first.click()
    page.get_by_label('留一句温柔的话').fill('愿你和妈妈都睡得好。')
    page.get_by_role('button', name='收好这句话').click()
    expect(page.locator('.reply')).to_have_count(1)
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    page.screenshot(path=str(OUT / '04-pool.png'), full_page=True)

    # 我的：恢复码来自服务端注册响应
    page.get_by_role('link', name='我的', exact=True).click()
    expect(page.locator('.recovery-code code')).to_be_visible()

    # 独立演示：后端真实任务/账本/结算引擎，三种结局可切换
    page.goto('http://127.0.0.1:5173/#/demo')
    expect(page.get_by_text('独立演示 · 不影响你的愿签')).to_be_visible(timeout=15000)
    expect(page.get_by_role('heading', name='今天，也替心意走一小步')).to_be_visible(timeout=25000)
    page.get_by_role('button', name='查看两幕结算').click()
    expect(page.locator('.stamp')).to_be_visible(timeout=25000)
    page.get_by_role('button', name='继续，打开问号抽屉').click()
    expect(page.locator('.settle-sum strong')).to_be_visible()
    page.screenshot(path=str(OUT / '05-settlement.png'), full_page=True)
    page.get_by_label('演示结局').select_option('unfinished')
    expect(page.locator('.stamp')).to_have_text('待续的心意', timeout=15000)
    page.get_by_label('演示结局').select_option('cyber')
    expect(page.locator('.stamp')).to_have_text('已还愿', timeout=15000)
    page.get_by_role('button', name='退出演示').click()

    # 窄屏重排与响应式路由不溢出
    for width in [1920, 1440, 1280, 768, 375]:
        page.set_viewport_size({'width': width, 'height': 900})
        for route in ['/', '/start', '/today', '/ledger', '/pool', '/me']:
            page.goto(f'http://127.0.0.1:5173/#{route}')
            page.wait_for_timeout(150)
            overflow = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')
            assert not overflow, f'{route} 在 {width}px 出现横向溢出'
    assert not errors, errors
    print(json.dumps({'ok': True, 'screenshots': str(OUT)}, ensure_ascii=False))
    browser.close()
