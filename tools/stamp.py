#!/usr/bin/env python3
"""Stamp the CSS/JS links in index.html with a fresh version string.

GitHub Pages caches assets aggressively, so without this a deploy can leave
phones running the previous build. Run it before committing a change.
"""
import pathlib
import re
import time

VERSION = time.strftime("%Y%m%d%H%M", time.gmtime())

page = pathlib.Path(__file__).resolve().parent.parent / "index.html"
html = page.read_text()
html = re.sub(r'(href="styles\.css)(\?v=[^"]*)?"', rf'\1?v={VERSION}"', html)
html = re.sub(r'(src="js/(?:config|app)\.js)(\?v=[^"]*)?"', rf'\1?v={VERSION}"', html)
page.write_text(html)
print(f"stamped {VERSION}")
