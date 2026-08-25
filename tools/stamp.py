#!/usr/bin/env python3
"""Stamp a build id into index.html and version.json.

GitHub Pages caches aggressively, so without this a deploy can leave phones
running the previous build. The same id lands in version.json, which the app
polls to raise the "Out dated!" notification. Run before committing.
"""
import json
import pathlib
import re
import time

VERSION = time.strftime("%Y%m%d%H%M", time.gmtime())
root = pathlib.Path(__file__).resolve().parent.parent

page = root / "index.html"
html = page.read_text()
html = re.sub(r'(href="styles\.css)(\?v=[^"]*)?"', rf'\1?v={VERSION}"', html)
html = re.sub(r'(src="js/(?:config|app)\.js)(\?v=[^"]*)?"', rf'\1?v={VERSION}"', html)
html = re.sub(r'<html lang="en"[^>]*>', f'<html lang="en" data-build="{VERSION}">', html)
page.write_text(html)

(root / "version.json").write_text(json.dumps({"build": VERSION}) + "\n")

# The service worker cache name must change too, or it keeps serving the old shell.
sw = root / "sw.js"
sw.write_text(re.sub(r'const CACHE = "[^"]*"', f'const CACHE = "label-{VERSION}"', sw.read_text()))

print(f"stamped {VERSION}")
