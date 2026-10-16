# Скачать выбранные кадры, ужать до 1600px и положить в attachments хаба.
# python3 tools/photo-fetch.py <cand_dir> <attachments_dir> <slug>=<номер> [...]
# → <attachments_dir>/asia-<slug>.jpg; печатает название, автора, лицензию и URL для callout'а
import json, sys, urllib.request
from io import BytesIO
from PIL import Image
UA = {'User-Agent': 'asia-2026-dashboard/1.0 (https://github.com/shirgazee/asia-2026)'}
cand, att = sys.argv[1], sys.argv[2]
for arg in sys.argv[3:]:
    slug, idx = arg.rsplit('=', 1)
    it = json.load(open(f'{cand}/{slug}.json'))[int(idx)]
    data = None
    for w in (1920, 1280):
        try:
            data = urllib.request.urlopen(urllib.request.Request(it['thumb'].replace('/330px-', f'/{w}px-'), headers=UA), timeout=60).read(); break
        except Exception as e: print(slug, w, e)
    if data is None: continue
    im = Image.open(BytesIO(data)).convert('RGB'); im.thumbnail((1600, 1600))
    out = f'{att}/asia-{slug}.jpg'; im.save(out, quality=82, optimize=True, progressive=True)
    print(f'asia-{slug}.jpg', im.size, '|', it['title'][5:], '|', it['artist'], '|', it['lic'], '|', it['page'])
