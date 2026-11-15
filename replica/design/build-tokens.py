"""Write tokens-<theme>-<mode>.json from themes.json and run the replica-design WCAG check on each.

    python replica/design/build-tokens.py <path-to-contrast.py>
"""
import json, pathlib, subprocess, sys

here = pathlib.Path(__file__).parent
themes = json.loads((here / "themes.json").read_text())
pairs = [["text", "bg"], ["text", "surface"], ["text", "bubble"], ["text-muted", "bg"], ["text-muted", "surface"],
         ["on-accent", "accent"], ["accent", "bg"], ["accent", "surface"], ["danger", "bg"], ["success", "bg"],
         ["border-input", "bg", "ui"], ["border-input", "surface", "ui"]]
failed = 0
for key, t in themes.items():
    if key.startswith("_"):
        continue
    for mode in ("light", "dark"):
        out = here / f"tokens-{key}-{mode}.json"
        out.write_text(json.dumps({"color": t[mode], "pairs": pairs, "font": t["font"], "radius": t["radius"]}, indent=2))
        print(f"== {t['label']} {mode}")
        failed |= subprocess.run([sys.executable, sys.argv[1], str(out)]).returncode
sys.exit(failed)
