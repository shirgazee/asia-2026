#!/usr/bin/env bash
# Пересобрать дашборд из хаба в Obsidian, зашифровать и выложить на GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")"
ob sync >/dev/null 2>&1 || echo "ob sync не прошёл — собираю из локальной копии хаба" >&2
node build.mjs
STATICRYPT_PASSWORD="$(cat .password)" npx --no-install staticrypt build/index.html -d docs --short --remember 0 \
  --template-title "Азия 2026" --template-instructions "Дашборд поездки Дани и Миры. Пароль — у Дани." \
  --template-button "Открыть" --template-placeholder "Пароль" --template-remember "Запомнить на этом устройстве" \
  --template-error "Неверный пароль" --template-color-primary "#c2410c" --template-color-secondary "#f6f3ee" >/dev/null
touch docs/.nojekyll
git add -A
git commit -qm "Обновить дашборд $(date '+%F %H:%M')" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
echo "Опубликовано: https://shirgazee.github.io/asia-2026/"
