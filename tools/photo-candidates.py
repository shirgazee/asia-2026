# Контакт-лист кандидатов с Wikimedia Commons (горизонтальные, ≥1800px, CC/PD).
# python3 tools/photo-candidates.py <out_dir> <slug> "<запрос 1>" ["<запрос 2>" ...]
# → <out_dir>/<slug>.jpg (пронумерованные превью) и <out_dir>/<slug>.json
import json, sys, re, urllib.request, urllib.parse, os
from io import BytesIO
from PIL import Image, ImageDraw
UA = {'User-Agent': 'asia-2026-dashboard/1.0 (https://github.com/shirgazee/asia-2026)'}
OUT = sys.argv[1]; city = sys.argv[2]; queries = sys.argv[3:]
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
seen, items = set(), []
for q in queries:
    p = dict(action='query', generator='search', gsrsearch=q + ' filetype:bitmap', gsrnamespace=6, gsrlimit=12,
             prop='imageinfo', iiprop='url|size|extmetadata', iiurlwidth=330, format='json')
    d = json.loads(get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(p)))
    for pg in sorted(d.get('query', {}).get('pages', {}).values(), key=lambda x: x.get('index', 0)):
        ii = pg['imageinfo'][0]; m = ii.get('extmetadata', {})
        lic = m.get('LicenseShortName', {}).get('value', '')
        if pg['title'] in seen or ii['width'] < 1800 or ii['width'] < ii['height']: continue
        if not re.search(r'CC|Public domain|PD', lic, re.I): continue
        seen.add(pg['title'])
        items.append(dict(title=pg['title'], w=ii['width'], h=ii['height'], thumb=ii['thumburl'], page=ii['descriptionurl'],
                          lic=lic, artist=re.sub('<[^>]+>', '', m.get('Artist', {}).get('value', '')).strip()))
items = items[:16]
tiles = []
for it in items:
    try: tiles.append(Image.open(BytesIO(get(it['thumb']))).convert('RGB'))
    except Exception as e: tiles.append(Image.new('RGB', (330, 220), 'gray'))
W, H = 330, 220
sheet = Image.new('RGB', (W * 4, H * ((len(tiles) + 3) // 4)), 'white')
dr = ImageDraw.Draw(sheet)
for i, t in enumerate(tiles):
    t.thumbnail((W, H)); x, y = (i % 4) * W, (i // 4) * H
    sheet.paste(t, (x, y)); dr.rectangle([x, y, x + 34, y + 26], fill='black'); dr.text((x + 6, y + 4), str(i), fill='white', font_size=20)
sheet.save(f'{OUT}/{city}.jpg', quality=80)
json.dump(items, open(f'{OUT}/{city}.json', 'w'), ensure_ascii=False, indent=1)
for i, it in enumerate(items): print(i, it['title'][5:80], it['lic'], '|', it['artist'][:40])
