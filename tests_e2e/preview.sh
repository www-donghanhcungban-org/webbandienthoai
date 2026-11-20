#!/usr/bin/env bash
# Chạy từ gốc dự án. Mỗi lần chạy dùng venv tạm riêng, pip và Playwright dùng lại bộ nhớ đệm.
set -euo pipefail
if [[ $# == 0 ]]; then
  output=dist/preview-browser.json
elif [[ $# == 2 && $1 == --output && -n $2 ]]; then
  output=$2
else
  echo 'Cách dùng: bash tests_e2e/preview.sh [--output FILE]' >&2
  exit 2
fi

mkdir -p -- "$(dirname -- "$output")"
if [[ -e $output || -L $output ]]; then
  if [[ ! -f $output || -L $output ]]; then
    echo "Đích bằng chứng phải là file thường: $output" >&2
    exit 2
  fi
  previous=$(mktemp -- "$output.previous.XXXXXXXX")
  mv -T -- "$output" "$previous"
  echo "Giữ kết quả lần trước ở $previous"
fi

framework_python=${XT_FRAMEWORK_PYTHON:-python3}
venv=$(mktemp -d)
trap 'rm -rf -- "$venv"' EXIT
"$framework_python" -m venv "$venv"
python="$venv/bin/python"
"$python" -m pip install --quiet --require-hashes -r tests_e2e/requirements.txt
bash tests_e2e/prepare-chromium.sh "$python"

node scripts/build.ts
"$framework_python" .xtemplates/scripts/xt.py deploy run --env dev
"$python" tests_e2e/pack_preview.py --output "$output"
echo "Kết quả trình duyệt: $output"
