"""Test fonctionnel de L'Essentiel — pilote la page comme un utilisateur."""
import asyncio, json, os, sys

BIN = "/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
URL = "file:///root/projets/lessentiel/index.html"

PASS = []
FAIL = []

def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS  " if cond else "FAIL  ") + name + (("  — " + str(detail)[:90]) if detail else ""))

async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=BIN, headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context()
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(URL)
        await page.wait_for_timeout(2500)  # météo + rendu

        check("chargement sans erreur JS", not errors, errors[:2])

        # 1. Événement (heure future = dans 1h, pour tester "prochain")
        from datetime import datetime, timedelta
        future = (datetime.now() + timedelta(hours=1)).strftime("%H:%M")
        await page.fill("#evTime", future)
        await page.fill("#evLabel", "RDV dentiste")
        await page.click("#eventForm button[type=submit]")
        txt = await page.inner_text("#eventsList")
        check("ajout événement", "RDV dentiste" in txt, txt[:60])
        nxt = await page.inner_text("#nextEventBox")
        check("prochain événement affiché", "RDV dentiste" in nxt, nxt[:60])

        # 2. Dépense (virgule française)
        await page.fill("#expLabel", "Courses")
        await page.fill("#expAmount", "42,50")
        await page.click("#budgetForm button[type=submit]")
        bw = await page.inner_text("#budgetWeek")
        check("dépense 42.50 acceptée", "42.50" in bw, bw)
        bar = await page.get_attribute("#budgetBar", "style")
        check("barre de budget réagit", bar and "0%" not in (bar or ""), bar)

        # 3. Eau
        for _ in range(3):
            await page.click("#waterPlus")
        wc = await page.inner_text("#waterCount")
        check("compteur d'eau = 3", wc.strip() == "3", wc)

        # 4. Sommeil
        await page.click("#sleepPlus")
        sc = await page.inner_text("#sleepCount")
        check("sommeil = 0.5", sc.strip() == "0.5", sc)

        # 5. Profil enfant
        await page.fill("#profName", "Léa")
        await page.click("#profileForm button[type=submit]")
        chips = await page.inner_text("#profilesChips")
        check("profil Léa créé et actif", "Léa" in chips, chips[:60])
        wc2 = await page.inner_text("#waterCount")
        check("compteur d'eau indépendant pour Léa", wc2.strip() == "0", wc2)

        # 6. Tâche ménagère + rotation
        await page.fill("#choreLabel", "Poubelles")
        await page.click("#choreForm button[type=submit]")
        ch = await page.inner_text("#choresList")
        check("tâche créée", "Poubelles" in ch, ch[:60])
        cd = await page.inner_text("#choreDay")
        check("responsable du jour affiché", "→ Poubelles" in cd, cd[:60])

        # 7. Repas + inspiration
        await page.click("#mealInspire")
        midi = await page.input_value("#mealMidi")
        soir = await page.input_value("#mealSoir")
        check("idée de repas injectée", bool(midi or soir), (midi or soir)[:40])

        # 8. Coche tâche
        await page.click("#choresList .check")
        cls = await page.get_attribute("#choresList li", "class")
        check("tâche cochable", cls == "done", cls)

        # 9. Persistance après rechargement
        await page.reload()
        await page.wait_for_timeout(2000)
        txt2 = await page.inner_text("#eventsList")
        check("persistance événement après reload", "RDV dentiste" in txt2, txt2[:40])
        chips2 = await page.inner_text("#profilesChips")
        check("persistance profils après reload", "Léa" in chips2, chips2[:40])
        bw2 = await page.inner_text("#budgetWeek")
        check("persistance budget après reload", "42.50" in bw2, bw2)

        # 10. Export JSON
        async with page.expect_download(timeout=8000) as dl_info:
            await page.click("#exportBtn")
        dl = await dl_info.value
        check("export JSON déclenché", dl.suggested_filename.startswith("lessentiel-"), dl.suggested_filename)

        # 11. Remise à zéro
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page.click("#resetBtn")
        await page.wait_for_timeout(800)
        ev_after = await page.inner_text("#eventsList")
        check("reset efface les événements", "RDV dentiste" not in ev_after, ev_after[:40])

        await browser.close()

    print("\n=== " + str(len(PASS)) + " PASS / " + str(len(FAIL)) + " FAIL ===")
    if FAIL:
        print("Échecs :", FAIL)
        sys.exit(1)

asyncio.run(main())
