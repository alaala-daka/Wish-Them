"""前后端联调的浏览器验收脚本。

前置：
  1) npm run server      # http://127.0.0.1:8787
  2) npm run dev         # http://127.0.0.1:5173（Vite 代理 /functions 与 /__storage）
  3) pip install playwright，并安装系统 Edge（脚本使用 channel='msedge'）

运行：python tests/browser_smoke.py
"""
from pathlib import Path
import json
import os
import sys
import urllib.request
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
FRONTEND = os.environ.get('YUANTA_BROWSER_FRONTEND', 'http://127.0.0.1:5173').rstrip('/')
BACKEND = os.environ.get('YUANTA_BROWSER_BACKEND', 'http://127.0.0.1:8787').rstrip('/')
OUT = ROOT / 'test-results' / 'postoffice-redesign'
OUT.mkdir(parents=True, exist_ok=True)

for name, url in [('backend', f'{BACKEND}/api/health'), ('frontend', f'{FRONTEND}/')]:
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

    page.goto(f'{FRONTEND}/')
    page.evaluate("indexedDB.deleteDatabase('yuanta-postoffice'); localStorage.clear()")
    page.reload()
    expect(page.get_by_role('button', name='替TA许个愿', exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role('button', name='跟着小愿走一遍')).to_be_visible()
    expect(page.locator('.toast')).to_have_count(0, timeout=8000)
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
    # Q1 自由填写；Q2 选身体不舒服 → Q3 身体分支；Q4 预算；Q5 感受
    page.get_by_label('写一点你愿意说的').fill('最近她总说腰疼，不肯去检查。')
    page.get_by_role('button', name='下一题', exact=True).click()
    page.get_by_role('button', name='总说忍一忍就过去了', exact=True).click()
    page.get_by_role('button', name='下一题', exact=True).click()
    page.get_by_role('button', name='腿脚 / 腰背', exact=True).click()
    page.get_by_role('button', name='下一题', exact=True).click()
    page.get_by_role('button', name='300–599', exact=True).click()
    page.get_by_role('button', name='下一题', exact=True).click()
    page.get_by_role('button', name='陪 TA 去检查', exact=True).click()
    page.get_by_role('button', name='下一步', exact=True).click()
    page.get_by_label('签下你的称呼').fill('小叶')
    page.get_by_role('checkbox').check()
    page.get_by_role('button', name='签下约定', exact=True).click()
    expect(page.get_by_role('heading', name='今天，也替心意走一小步')).to_be_visible(timeout=25000)

    # 今日任务：上传证明 → 打卡 → 刷新后仍在
    page.get_by_role('button', name='去记录', exact=True).first.click()
    page.locator('input[type=file]').set_input_files(str(ROOT / 'public/assets/postoffice.png'))
    page.get_by_label('留一句话（可选）').fill('今天给妈妈打了电话。')
    expect(page.get_by_role('button', name='保存记录')).to_be_enabled(timeout=15000)
    page.get_by_role('button', name='保存记录').click()
    expect(page.get_by_text('已完成 1/2', exact=True)).to_be_visible(timeout=20000)
    expect(page.get_by_role('heading', name='记录小事')).to_be_focused()
    page.reload()
    expect(page.get_by_text('已完成 1/2', exact=True)).to_be_visible(timeout=20000)
    page.get_by_role('button', name='查看记录', exact=True).first.click()
    proof = page.get_by_role('img', name='这次行动的私人记录')
    expect(proof).to_be_visible(timeout=15000)
    assert proof.evaluate('el => el.naturalWidth') > 0
    page.get_by_role('button', name='去记录', exact=True).first.click()
    expect(proof).to_have_count(0)
    expect(page.get_by_role('button', name='保存记录')).to_be_disabled()
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
    expect(page.get_by_label('金额（元，取整）')).to_have_value('', timeout=15000)
    page.reload()
    expense_row = page.locator('.ledger-row').filter(
        has=page.get_by_text('¥32', exact=True)
    )
    expect(expense_row.locator('span')).to_have_text('非必要支出', timeout=15000)
    expect(page.locator('.ledger-summary .total strong')).to_have_text('¥0', timeout=15000)
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

    # 流程速览：纯前端教程演示，无图片、无后端写入
    page.get_by_role('link', name='邮局首页', exact=True).click()
    page.get_by_role('button', name='跟着小愿走一遍').click()
    expect(page.get_by_role('heading', name='三分钟，看完整段心意')).to_be_visible(timeout=15000)
    assert '评委' not in page.locator('body').inner_text()
    page.get_by_role('button', name='下一步').click()
    expect(page.get_by_role('heading', name='替姥姥，许一个小小的愿')).to_be_visible()
    page.get_by_role('button', name='下一步').click()
    expect(page.get_by_role('heading', name='问题会跟着你的回答变')).to_be_visible()
    page.get_by_role('button', name='下一步').click()
    expect(page.get_by_role('heading', name='十天，每天两件小事')).to_be_visible()
    page.get_by_role('button', name='下一步').click()
    for day in range(3):
        expect(page.get_by_role('heading', name=f'第 {day + 1} 天的小事')).to_be_visible()
        while page.get_by_role('button', name='完成', exact=True).count():
            page.get_by_role('button', name='完成', exact=True).first.click()
        if day < 2:
            page.get_by_role('button', name='下一天').click()
    page.get_by_role('button', name='看看十天后').click()
    expect(page.get_by_role('heading', name='十天的小事，攒成了一件真的事')).to_be_visible(timeout=5000)
    page.screenshot(path=str(OUT / '05-tour-summary.png'), full_page=True)
    page.get_by_role('button', name='下一步').click()
    expect(page.get_by_role('heading', name='一张回家的往返车票')).to_be_visible()
    expect(page.locator('.tour-egg')).to_be_visible()
    page.screenshot(path=str(OUT / '05-tour-egg.png'), full_page=True)
    page.get_by_role('button', name='回邮局').click()
    expect(page.get_by_role('button', name='继续今天的小事', exact=True)).to_be_visible(timeout=20000)

    # 窄屏重排与响应式路由不溢出
    for width in [1920, 1440, 1280, 768, 375]:
        page.set_viewport_size({'width': width, 'height': 900})
        for route in ['/', '/start', '/today', '/ledger', '/pool', '/me', '/tour']:
            page.goto(f'{FRONTEND}/#{route}')
            page.wait_for_timeout(150)
            overflow = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')
            assert not overflow, f'{route} 在 {width}px 出现横向溢出'
    assert not errors, errors
    print(json.dumps({'ok': True, 'screenshots': str(OUT)}, ensure_ascii=False))
    browser.close()
