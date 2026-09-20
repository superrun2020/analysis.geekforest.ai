#!/tmp/oa-preview-browser-runtime/bin/python
import json
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_server(port):
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.2):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError("Vite preview did not start")


def install_fixture(context, state):
    def handler(route):
        parsed = urlparse(route.request.url)
        if parsed.path == "/api/auth/me":
            return route.fulfill(status=200, content_type="application/json", body=json.dumps({"user": {"email": "admin@example.test", "employee": {"name": "Admin"}}}))
        if parsed.path == "/operations/session":
            state["session_reads"] += 1
            if state.get("slow_failure"):
                time.sleep(2.8)
                state["slow_failure"] = False
                return route.fulfill(status=503, content_type="application/json", body='{"error":"AUTH_UNAVAILABLE"}')
            return route.fulfill(status=204, body="")
        if parsed.path in ("/operations", "/operations/"):
            return route.fulfill(status=200, content_type="text/html", body="""<!doctype html><main id='view'></main><script>
window.fixtureDocumentId = crypto.randomUUID(); window.fixtureBootstrapReads = 0;
fetch('/operations/api/bootstrap').then(() => { window.fixtureBootstrapReads += 1; });
function render(){ document.querySelector('#view').textContent=location.hash; }
addEventListener('hashchange', render); render();
</script>""")
        if parsed.path == "/operations/api/bootstrap":
            state["iframe_bootstrap_reads"] += 1
            return route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
        return route.continue_()
    context.route("**/*", handler)
    context.add_init_script("""localStorage.setItem('jkcl_funnel_oa_token','browser-admin'); localStorage.setItem('jkcl_funnel_oa_expires_at',new Date(Date.now()+3600000).toISOString());""")


def frame_values(page):
    frame = page.frame_locator('iframe[title="运营管理"]')
    return frame.locator("body").evaluate("() => ({id:window.fixtureDocumentId, reads:window.fixtureBootstrapReads, hash:location.hash})")


def main():
    port = free_port()
    scratch = Path(tempfile.mkdtemp(prefix="analysis-operations-browser-", dir=os.environ.get("TMPDIR", tempfile.gettempdir())))
    log = open(scratch / "vite.log", "w")
    process = subprocess.Popen(["npx", "vite", "preview", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    checks = []
    try:
        wait_server(port)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=["--no-first-run", "--disable-background-networking"])
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            state = {"session_reads": 0, "iframe_bootstrap_reads": 0}
            install_fixture(context, state)
            page = context.new_page(); page.goto(f"http://127.0.0.1:{port}/?operations=overview&operationsPage=team", wait_until="networkidle")
            page.locator('iframe[title="运营管理"]').wait_for(); initial = frame_values(page)
            assert initial["hash"] == "#/team", initial
            for menu, expected in [("项目管理", "#/projects"), ("问题跟进", "#/issues"), ("自动监控", "#/rules"), ("运营总览", "#/overview")]:
                page.get_by_role("button", name=menu, exact=True).click(); page.wait_for_timeout(80); current = frame_values(page)
                assert current["id"] == initial["id"] and current["reads"] == 1 and current["hash"] == expected, current
            for menu, tab, expected in [("运营总览", "团队", "#/team"), ("问题跟进", "告警", "#/alerts"), ("问题跟进", "验收", "#/acceptance"), ("自动监控", "运行", "#/runs"), ("自动监控", "状态", "#/status")]:
                page.get_by_role("button", name=menu, exact=True).click(); subnav = page.locator(".operations-subnav"); subnav.get_by_role("button", name=re.compile(r"\s*".join(tab))).click(); page.wait_for_timeout(80); current = frame_values(page)
                assert current["id"] == initial["id"] and current["reads"] == 1 and current["hash"] == expected, current
            page.get_by_role("button", name="广告漏斗分析中心", exact=True).click(); page.get_by_role("button", name="运营总览", exact=True).click(); page.wait_for_timeout(80)
            returned = frame_values(page); assert returned["id"] == initial["id"] and returned["reads"] == 1
            assert state == {"session_reads": 1, "iframe_bootstrap_reads": 1}, state
            checks.append("four menus, all subpages, and leave/re-enter retain one iframe document/bootstrap")
            context.close()

            retry_context = browser.new_context(viewport={"width": 1440, "height": 1000})
            retry_state = {"session_reads": 0, "iframe_bootstrap_reads": 0, "slow_failure": True}
            install_fixture(retry_context, retry_state)
            retry_page = retry_context.new_page(); retry_page.goto(f"http://127.0.0.1:{port}/?operations=overview")
            retry_page.get_by_text("运营服务连接较慢").wait_for(timeout=5000)
            retry_page.get_by_text("运营服务暂不可用").wait_for(timeout=5000)
            retry_page.get_by_role("button", name=re.compile(r"重\s*试")).click(); retry_page.locator('iframe[title="运营管理"]').wait_for(timeout=5000); retry_page.wait_for_timeout(300)
            assert retry_state["session_reads"] == 2 and retry_state["iframe_bootstrap_reads"] == 1, retry_state
            checks.append("slow state and error are visible; retry performs a second session request and succeeds")
            retry_context.close(); browser.close()
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill()
        log.close()
    print(json.dumps({"passed": len(checks), "checks": checks, "scratch": str(scratch)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
