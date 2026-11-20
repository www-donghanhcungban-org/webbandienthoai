#!/usr/bin/env bash
# Dùng cùng Python đã cài Playwright theo requirements.txt và cùng executable như bài kiểm UI.
set -euo pipefail
python=${1:?Thiếu đường dẫn Python}
probe() {
  "$python" - <<'PY'
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get("XT_E2E_CHROMIUM") or None)
    browser.close()
PY
}

if [[ -z ${XT_E2E_CHROMIUM:-} ]]; then
  "$python" -m playwright install --only-shell chromium
fi
if diagnostic=$(probe 2>&1); then
  echo 'Đã khởi chạy Chromium.'
  exit 0
fi
printf '%s\n' "$diagnostic" >&2
if [[ ${GITHUB_ACTIONS:-} != true || -n ${XT_E2E_CHROMIUM:-} ]]; then exit 1; fi
case "$diagnostic" in
  *"Host system is missing dependencies"*|*"error while loading shared libraries"*)
    "$python" -m playwright install-deps chromium
    probe
    ;;
  *) exit 1 ;;
esac
