"""Browser test of the web interface (40 checks across all four roles).

Optional. It needs Python, Playwright and Chromium:
    pip install playwright
    playwright install chromium
Start the server first (npm run db:load, then PORT=3060 npm start), then run:
    python server/tests/ui_smoke_test.py
It changes demo data, so run npm run db:load afterwards to reset.
"""
import os, sys, re
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3060")
errors = []
results = []
def ok(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra and not cond else ""))

def toast(page, text, timeout=8000):
    try:
        page.wait_for_function("t => document.getElementById('toasts').innerText.toLowerCase().includes(t)", arg=text.lower(), timeout=timeout)
        return True
    except Exception:
        return False

def nav(page, view, heading):
    page.click(f".nav a[data-view={view}]")
    page.wait_for_function("h => document.querySelector('.page h1') && document.querySelector('.page h1').innerText === h", arg=heading)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(300)

def login(page, email):
    page.goto(BASE + "/")
    page.evaluate("sessionStorage.clear()")
    page.goto(BASE + "/")
    page.fill("input[type=email]", email)
    page.fill("input[type=password]", "Demo@12345")
    page.click("button[type=submit]")

os.makedirs("ui-screenshots", exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 800}, accept_downloads=True)
    page = ctx.new_page()
    page.route("**/tile.openstreetmap.org/**", lambda r: r.abort())
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e) + " | " + (e.stack or "")[:700].replace("\n"," <- ")))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "tile.openstreetmap" not in m.text and "ERR_FAILED" not in m.text else None)

    # ---- login page
    page.goto(BASE + "/")
    ok("login form shows", page.locator("input[type=email]").count() == 1)
    page.wait_for_selector(".demo-box button")
    ok("demo buttons show", page.locator(".demo-box button").count() == 5)
    page.fill("input[type=email]", "tunde.bakare@lagoon-telecom.example"); page.fill("input[type=password]", "wrong")
    page.click("button[type=submit]")
    page.wait_for_selector(".form-error:not(:empty)")
    ok("wrong password shows error", "incorrect" in page.inner_text(".form-error"))

    # ---- asset manager on the map
    login(page, "tunde.bakare@lagoon-telecom.example")
    page.wait_for_selector(".leaflet-container")
    page.wait_for_selector(".marker")
    n_dev = page.locator(".leaflet-marker-icon .marker:not(.other)").count()
    ok("map shows the 40 Lagoon devices", n_dev == 40, n_dev)
    ok("summary text shown", "40 of your devices" in page.inner_text("#map-summary"), page.inner_text("#map-summary"))
    ok("nav has manager pages", all(page.locator(f".nav a[data-view={v}]").count() == 1 for v in ["map", "alerts", "maintenance", "free-routes", "dashboard", "reports"]))
    ok("nav hides admin pages", page.locator(".nav a[data-view=users]").count() == 0)
    page.screenshot(path="ui-screenshots/shot_map.png")

    # filter by status
    page.select_option("select[aria-label=Status]", "faulty")
    page.wait_for_timeout(200)
    ok("status filter narrows devices", page.locator(".leaflet-marker-icon .marker:not(.other)").count() == 1, page.inner_text("#map-summary"))
    page.select_option("select[aria-label=Status]", "")

    # open a device popup and update status
    page.locator(".leaflet-marker-icon .marker.tower").first.click(force=True)
    page.wait_for_selector(".leaflet-popup .popup")
    ok("device popup has actions", page.get_by_role("button", name="Update status").count() == 1 and page.get_by_role("button", name="Log maintenance").count() == 1)
    page.get_by_role("button", name="Update status").click()
    page.wait_for_selector(".modal")
    page.select_option(".modal select", "under_repair")
    page.fill(".modal textarea", "Checked by UI test")
    page.get_by_role("button", name="Save").click()
    ok("status update confirmed", toast(page, "Status updated"))

    # add a device by clicking the map
    page.click("#add-device")
    ok("add device mode shows hint", "Click the map" in page.inner_text(".modebar"))
    box = page.locator(".leaflet-container").bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.wait_for_selector(".modal")
    inputs = page.locator(".modal input[type=text]")
    inputs.nth(0).fill("LAG-UI-01"); inputs.nth(1).fill("UI test enclosure")
    page.get_by_role("button", name="Register").click()
    toast(page, "Device registered")
    page.wait_for_timeout(500)
    ok("new device appears on the map", page.locator(".leaflet-marker-icon .marker:not(.other)").count() == 41, page.inner_text("#map-summary"))

    # draw a route
    page.click("#add-route")
    ok("draw route mode, finish disabled", page.locator("#finish-route").is_disabled())
    for fx, fy in [(0.3, 0.3), (0.35, 0.4), (0.4, 0.35)]:
        page.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)
    ok("finish enabled after 3 points", page.locator("#finish-route").is_enabled())
    page.click("#finish-route")
    page.wait_for_selector(".modal")
    t = page.locator(".modal input[type=text]")
    t.nth(0).fill("LAG-UI-R1"); t.nth(1).fill("UI test route")
    page.get_by_role("button", name="Register").click()
    ok("route registered", toast(page, "Route registered"))
    page.wait_for_timeout(500)
    page.screenshot(path="ui-screenshots/shot_map2.png")

    # report a cut via a route popup (click without a location)
    idx = page.evaluate("""() => { const ps=[...document.querySelectorAll('path.leaflet-interactive')]; return ps.findIndex(p => p.getAttribute('stroke')==='#2e7d32' && p.getAttribute('stroke-opacity')==='0.95'); }""")
    page.locator("path.leaflet-interactive").nth(idx).dispatch_event("click")
    page.wait_for_selector(".leaflet-popup .popup")
    if page.get_by_role("button", name="Report cut").count():
        page.get_by_role("button", name="Report cut").click()
        page.wait_for_selector(".modal")
        if page.locator("#use-spot").count():
            page.locator("#use-spot").uncheck()
        page.locator(".modal").get_by_role("button", name="Report cut").click()
        ok("cut reported", toast(page, "raised"), page.inner_text("#toasts"))
    else:
        ok("route popup had report cut button", False, page.inner_text(".leaflet-popup"))

    # alerts page
    nav(page, "alerts", "Fibre cut alerts")
    rows = page.locator("tbody tr").count()
    ok("alerts table has rows", rows >= 2, rows)
    ok("resolve button for owner alerts", page.get_by_role("button", name="Resolve").count() >= 1)
    page.get_by_role("button", name="Acknowledge").first.click()
    ok("acknowledge works", toast(page, "Alert acknowledged"))
    page.get_by_role("button", name="Resolve").first.click()
    page.wait_for_selector(".modal")
    page.fill(".modal textarea", "Fixed in UI test")
    page.locator(".modal").get_by_role("button", name="Resolve").click()
    ok("resolve works", toast(page, "Alert resolved"))

    # bell
    page.wait_for_timeout(300)
    page.click("#bell")
    page.wait_for_selector(".bell-panel")
    ok("notification panel opens", page.locator(".bell-item").count() >= 1)
    page.keyboard.press("Escape")

    # maintenance
    nav(page, "maintenance", "Maintenance records")
    ok("maintenance list loads", page.locator("tbody tr").count() > 3, page.locator("tbody tr").count())
    page.click("#new-record")
    page.wait_for_selector(".modal")
    page.wait_for_timeout(300)
    page.fill(".modal textarea", "UI test record")
    page.get_by_role("button", name="Save").click()
    ok("maintenance record saved", toast(page, "Record saved"))

    # free routes
    nav(page, "free-routes", "Free routes")
    ok("free routes list loads", page.locator("tbody tr").count() > 0, page.locator("tbody tr").count())
    # dashboard
    nav(page, "dashboard", "Dashboard")
    page.wait_for_selector("canvas")
    page.wait_for_timeout(600)
    ok("dashboard has 4 charts and cards", page.locator("canvas").count() == 4 and page.locator(".stat").count() == 7)
    page.screenshot(path="ui-screenshots/shot_dash.png")
    # reports
    nav(page, "reports", "Reports and export")
    ok("report shows rows", page.locator("tbody tr").count() > 5)
    with page.expect_download() as dl:
        page.get_by_role("button", name="Download CSV").click()
    ok("csv downloads", dl.value.suggested_filename == "maintenance-report.csv", dl.value.suggested_filename)
    with page.expect_download() as dl2:
        page.get_by_role("button", name="Devices (GeoJSON)").click()
    ok("geojson downloads", dl2.value.suggested_filename == "devices.geojson")

    # sign out
    page.get_by_role("button", name="Sign out").click()
    page.wait_for_selector("input[type=email]")
    ok("sign out returns to login", True)

    # ---- field technician
    login(page, "chinedu.eze@lagoon-telecom.example")
    page.wait_for_selector(".marker")
    ok("technician nav is limited", page.locator(".nav a[data-view=dashboard]").count() == 0 and page.locator(".nav a[data-view=free-routes]").count() == 0)
    ok("technician can add devices", page.locator("#add-device").count() == 1)
    page.goto(BASE + "/#/dashboard"); page.wait_for_timeout(500)
    ok("technician sent away from dashboard", "#/map" in page.url, page.url)

    # ---- decision maker
    login(page, "femi.adeyemi@lagoon-telecom.example")
    page.wait_for_selector(".marker")
    ok("decision maker cannot add", page.locator("#add-device").count() == 0)
    page.locator(".leaflet-marker-icon .marker").first.click(force=True)
    page.wait_for_selector(".leaflet-popup .popup")
    ok("decision maker popup is read only", page.get_by_role("button", name="Update status").count() == 0 and page.get_by_role("button", name="History").count() == 1)

    # ---- other operator sees only generic warning
    login(page, "ibrahim.danjuma@harmattan-networks.example")
    page.wait_for_selector(".marker")
    nav(page, "alerts", "Fibre cut alerts")
    txt = page.inner_text("table")
    ok("neighbour alert shows generic text", "Near your routes" in txt and "Not shown" in txt)

    # ---- administrator
    login(page, "adaeze.okafor@lagoon-telecom.example")
    page.wait_for_selector(".nav")
    ok("admin nav", page.locator(".nav a[data-view=users]").count() == 1 and page.locator(".nav a[data-view=audit]").count() == 1 and page.locator(".nav a[data-view=dashboard]").count() == 0)
    nav(page, "users", "Users")
    ok("users listed", page.locator("tbody tr").count() == 5, page.locator("tbody tr").count())
    page.click("#add-user"); page.wait_for_selector(".modal")
    page.locator(".modal input[type=text]").fill("UI Test User")
    page.locator(".modal input[type=email]").fill("ui.test@lagoon-telecom.example")
    page.locator(".modal input[type=password]").fill("LongEnough1")
    page.locator(".modal").get_by_role("button", name="Add user").click()
    toast(page, "User added"); page.wait_for_timeout(400)
    ok("user added", page.locator("tbody tr").count() == 6)
    nav(page, "audit", "Audit log")
    ok("audit log shows changes", page.locator("tbody tr").count() > 3 and "Created" in page.inner_text("table"))

    # ---- mobile layout
    m = b.new_context(viewport={"width": 390, "height": 800}).new_page()
    m.route("**/tile.openstreetmap.org/**", lambda r: r.abort())
    login(m, "tunde.bakare@lagoon-telecom.example")
    m.wait_for_selector(".leaflet-container")
    ok("mobile: map visible", m.locator(".leaflet-container").bounding_box()["height"] > 200)
    m.screenshot(path="ui-screenshots/shot_mobile.png")
    b.close()

bad = [r for r in results if not r[1]]
print("\nResults:", len(results) - len(bad), "passed,", len(bad), "failed")
print("Browser errors:", errors[:10] if errors else "none")
