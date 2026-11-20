"""Kiểm luồng ghi chú trên bản dev của dự án sinh từ gói web-api-ts.

Chạy từ gốc dự án sau `xt.py deploy run --env dev`. File bằng chứng chỉ ghi sau khi trình duyệt
thấy dữ liệu đã lưu trong hai phiên tách biệt và bản đang phục vụ khớp artifact đã kiểm.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlparse
from uuid import uuid4

from playwright.sync_api import Page, expect, sync_playwright


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def confirmed_candidate() -> tuple[dict, str]:
    ledger = json.loads(Path("docs/ops/DEPLOYS.json").read_text(encoding="utf-8"))
    state = ledger["envs"]["dev"]
    current = state["current"]
    require(not state["unknown"] and current["result"] == "deployed", "Chưa có bản dev được xác nhận")
    url = urlparse(current["url"])
    require(url.scheme == "http" and url.hostname == "127.0.0.1", "Bài kiểm chỉ đăng nhập vào preview loopback")
    digest = hashlib.sha256(Path("dist/app.tgz").read_bytes()).hexdigest()
    artifacts = {a["path"]: a["sha256"] for a in current["artifacts"]}
    require(artifacts.get("dist/app.tgz") == digest, "Artifact cục bộ khác receipt")
    return current, digest


def login(page: Page, url: str, account: dict[str, str]) -> None:
    page.goto(url)
    page.locator("#email").fill(account["email"])
    page.locator("#password").fill(account["password"])
    with page.expect_response(lambda r: urlparse(r.url).path == "/v1/login" and r.request.method == "POST") as result:
        page.locator("#login-form").get_by_role("button", name="Đăng nhập").click()
    require(result.value.status == 200, "Không đăng nhập được vào API")
    expect(page.locator("#note-form")).to_be_visible()


def browser_flow(url: str, expected_digest: str, account: dict[str, str]) -> str:
    body = "Kiểm thử ghi chú " + uuid4().hex
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get("XT_E2E_CHROMIUM"))
        with browser.new_context() as first:
            health = first.request.get(url.rstrip("/") + "/healthz")
            require(health.ok, "HTTP /healthz không thành công")
            observed = health.json()["digest"]
            require(observed == expected_digest, "Digest HTTP khác ứng viên")
            page = first.new_page()
            login(page, url, account)
            page.locator("#note-body").fill(body)
            with page.expect_response(
                lambda r: urlparse(r.url).path == "/v1/notes" and r.request.method == "POST"
            ) as saved:
                page.locator("#note-form").get_by_role("button", name="Lưu ghi chú").click()
            require(saved.value.status == 201, "API chưa tạo ghi chú")
            note = saved.value.json()
            require(note["body"] == body and bool(note["id"]), "API trả ghi chú khác nội dung đã nhập")
            expect(page.locator("#notes-list")).to_contain_text(body)
        with browser.new_context() as second:
            page = second.new_page()
            with page.expect_response(
                lambda r: urlparse(r.url).path == "/v1/notes" and r.request.method == "GET"
            ) as loaded:
                login(page, url, account)
            require(loaded.value.status == 200, "Không lấy lại được ghi chú từ API")
            matches = [item for item in loaded.value.json()["notes"] if item["id"] == note["id"]]
            require(len(matches) == 1 and matches[0]["body"] == body, "Ghi chú không tồn tại ở phiên mới")
            expect(page.locator("#notes-list")).to_contain_text(body)
        browser.close()
    return observed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        parser.error("Đích bằng chứng đã tồn tại. Hãy chọn tên mới hoặc chạy bash tests_e2e/preview.sh.")
    start = time.monotonic()
    current, artifact = confirmed_candidate()
    result = subprocess.run(
        ["node", "scripts/dev-preview.mjs", "credentials"], capture_output=True, text=True, check=True, timeout=10
    )
    account = json.loads(result.stdout)["owner"]
    observed = browser_flow(current["url"], current["subject"]["digest"], account)
    require(current["served_digest"] == observed, "Digest HTTP không khớp receipt")
    run_url = os.environ.get("GITHUB_RUN_ID")
    if run_url:
        run_url = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{run_url}"
    proof = {
        "schema": 1,
        "result": "passed",
        "subject": current["subject"],
        "served_digest": observed,
        "artifact_sha256": artifact,
        "checks": ["login", "create-note", "reload-note"],
        "elapsed_seconds": round(time.monotonic() - start, 3),
        "run_url": run_url,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=args.output.parent, delete_on_close=False
    ) as draft:
        json.dump(proof, draft, ensure_ascii=False, indent=2)
        draft.write("\n")
        draft.close()
        os.link(draft.name, args.output)
    print(f"Đã xác nhận luồng ghi chú ở bản {observed}.")


if __name__ == "__main__":
    main()
