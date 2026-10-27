"""Email the site owner with the publication result and failure diagnostics."""

import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo


MAILBOX = "gao497868860@163.com"


class GitHubRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        redirected = super().redirect_request(request, response, code, message, headers, url)
        # Job logs redirect to signed storage URLs that use their own credentials.
        if urlsplit(request.full_url).netloc != urlsplit(url).netloc:
            redirected.remove_header("Authorization")
        return redirected


def github_request(env, path):
    request = Request(
        f'{env["GITHUB_API_URL"]}/repos/{env["GITHUB_REPOSITORY"]}{path}',
        headers={
            "Authorization": f'Bearer {env["GITHUB_TOKEN"]}',
            "Accept": "application/vnd.github+json",
        },
    )
    with build_opener(GitHubRedirectHandler()).open(request, timeout=15) as response:
        return response.read(2_000_000).decode("utf-8", errors="replace")


def redact(text, env):
    for key in ("SMTP_PASSWORD", "GITHUB_TOKEN"):
        if env.get(key):
            text = text.replace(env[key], "[redacted]")
    return text


def failure_details(env):
    details = []
    try:
        # Attempt-specific jobs avoid attributing a previous attempt's error.
        jobs = json.loads(github_request(
            env, f'/actions/runs/{env["GITHUB_RUN_ID"]}/attempts/{env["GITHUB_RUN_ATTEMPT"]}/jobs?per_page=100'
        ))["jobs"]
        job = next(job for job in jobs if job["name"] == "update-and-deploy")
        failed_steps = [
            step["name"] for step in job.get("steps", [])
            if step.get("conclusion") in ("failure", "cancelled", "timed_out")
        ]
        details.append("失败环节：" + ("、".join(failed_steps) or job.get("conclusion", "未知")))
        logs = github_request(env, f'/actions/jobs/{job["id"]}/logs')
        lines = [
            re.sub(r"^\d{4}-\d{2}-\d{2}T\S+\s+", "", line)
            for line in re.sub(r"\x1b\[[0-9;]*m", "", logs).splitlines()
        ]
        indices = set()
        for index, line in enumerate(lines):
            if re.search(r"##\[error\]|Error:|error:|✖|not ok |Traceback", line):
                indices.update(range(max(0, index - 6), index + 1))
        excerpt = "\n".join(lines[index] for index in sorted(indices)[-30:])
        if excerpt:
            details.append("错误摘要：\n" + excerpt[:3000])
        else:
            details.append("日志未提供明确错误摘要，请查看发布记录中的完整日志。")
    except Exception as error:
        # Diagnostic API failures must not prevent the failure email itself.
        details.append(f"详细错误暂时无法读取（{type(error).__name__}），请查看发布记录中的失败步骤。")
    return redact("\n\n".join(details), env)


def notify(env):
    password = env.get("SMTP_PASSWORD")
    if not password:
        raise ValueError("SITE_SMTP_PASSWORD is not configured")
    site_url = env["SITE_URL"]
    commit = env["DEPLOYED_COMMIT"]
    repository_url = f'{env["GITHUB_SERVER_URL"]}/{env["GITHUB_REPOSITORY"]}'
    run_url = f'{repository_url}/actions/runs/{env["GITHUB_RUN_ID"]}/attempts/{env["GITHUB_RUN_ATTEMPT"]}'
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    result = env.get("UPDATE_RESULT", "success")
    if result not in ("success", "failure", "cancelled"):
        raise ValueError("Unexpected website update result")
    if result == "success":
        subject = "运动日志网站更新完成"
        summary = "运动日志网站已更新，GitHub Pages 部署成功。"
        version_label = "发布版本"
    else:
        subject = "运动日志网站更新失败" if result == "failure" else "运动日志网站更新已取消"
        summary = "网站更新流程未成功完成。\n\n" + failure_details(env)
        version_label = "运行版本"
    message = EmailMessage()
    message["From"] = MAILBOX
    message["To"] = MAILBOX
    message["Subject"] = subject
    message["Date"] = format_datetime(now)
    message["Message-ID"] = make_msgid(domain="163.com")
    message.set_content(
        f"{summary}\n\n"
        f"网站：{site_url}\n"
        f"通知时间：{now:%Y-%m-%d %H:%M:%S}（北京时间）\n"
        f"{version_label}：{repository_url}/commit/{commit}\n"
        f"发布记录：{run_url}\n"
    )
    # No automatic retries: a lost SMTP acknowledgement may still mean delivery.
    with smtplib.SMTP_SSL(
        "smtp.163.com", 465, timeout=30, context=ssl.create_default_context()
    ) as smtp:
        smtp.login(MAILBOX, password)
        refused = smtp.send_message(message)
        if refused:
            raise RuntimeError("Notification recipient was refused")


if __name__ == "__main__":
    try:
        notify(os.environ)
    except Exception as error:
        # SMTP errors may echo server data; keep credentials out of Actions logs.
        print(f"Website notification failed ({type(error).__name__}).", file=sys.stderr)
        sys.exit(1)
    print("Website update email accepted by SMTP server.")
