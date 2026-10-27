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
from html import escape
from pathlib import Path
from string import Template
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


def build_message(env, *, now=None, test=False):
    site_url = env["SITE_URL"]
    commit = env["DEPLOYED_COMMIT"]
    repository_url = f'{env["GITHUB_SERVER_URL"]}/{env["GITHUB_REPOSITORY"]}'
    run_url = f'{repository_url}/actions/runs/{env["GITHUB_RUN_ID"]}/attempts/{env["GITHUB_RUN_ATTEMPT"]}'
    now = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    result = env.get("UPDATE_RESULT", "success")
    if result not in ("success", "failure", "cancelled"):
        raise ValueError("Unexpected website update result")
    if result == "success":
        subject = "运动日志网站更新完成"
        summary = "运动日志网站已更新，GitHub Pages 部署成功。"
        title, description, status = "运动日志已更新", "最新内容已上线，打开日志即可查看。", "更新成功"
        status_color, status_background = "#98d6af", "#263c2f"
        details = ""
        version_label = "发布版本"
    else:
        subject = "运动日志网站更新失败" if result == "failure" else "运动日志网站更新已取消"
        details = failure_details(env)
        summary = "网站更新流程未成功完成。\n\n" + details
        if result == "failure":
            title, description, status = "本次更新未完成", "更新遇到了一点问题，具体原因见下方。", "更新失败"
            status_color, status_background = "#ffb1a0", "#452c28"
        else:
            title, description, status = "本次更新已取消", "这次更新已停止，具体情况可查看运行记录。", "已取消"
            status_color, status_background = "#e8ce93", "#3d3625"
        version_label = "运行版本"
    message = EmailMessage()
    message["From"] = f"波咖茶的运动日志 <{MAILBOX}>"
    message["To"] = MAILBOX
    message["Subject"] = ("【测试】" if test else "") + subject
    message["Date"] = format_datetime(now)
    message["Message-ID"] = make_msgid(domain="163.com")
    message.set_content(
        ("这是一封样式测试邮件，不代表网站发生新的更新或故障。\n\n" if test else "") +
        f"{summary}\n\n"
        f"网站：{site_url}\n"
        f"通知时间：{now:%Y-%m-%d %H:%M:%S}（北京时间）\n"
        f"{version_label}：{repository_url}/commit/{commit}\n"
        f"发布记录：{run_url}\n"
    )
    diagnostic_block = ""
    if details:
        excerpt = details[:1200] + ("\n…完整错误请查看运行记录。" if len(details) > 1200 else "")
        diagnostic_block = (
            '<tr><td style="padding:0 0 24px;">'
            '<div style="padding:18px;background-color:#181b18;border:1px solid #3c4038;border-radius:12px;">'
            '<p style="margin:0 0 10px;color:#f3f2ec;font-size:13px;font-weight:600;">失败详情</p>'
            '<div style="color:#c4c8bf;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.8;'
            'word-break:break-word;overflow-wrap:anywhere;">'
            + escape(excerpt).replace("\n", "<br>") + '</div></div></td></tr>'
        )
    template = Template(Path(__file__).with_name("notification-email.html").read_text(encoding="utf-8"))
    values = {
        "subject": str(message["Subject"]), "title": title, "description": description,
        "status": status, "status_color": status_color, "status_background": status_background,
        "site_url": site_url, "run_url": run_url, "commit_url": f"{repository_url}/commit/{commit}",
        "version_label": version_label, "short_commit": commit[:7],
        "date": f"{now.year} 年 {now.month} 月 {now.day} 日", "time": now.strftime("%H:%M:%S"),
        "button_url": site_url if result == "success" else run_url,
        "button_label": "打开运动日志" if result == "success" else "查看失败原因" if result == "failure" else "查看运行记录",
        "secondary_url": run_url if result == "success" else site_url,
        "secondary_label": "查看发布详情" if result == "success" else "打开运动日志",
        "preheader": ("样式测试 · " if test else "") + description,
        "notice": "样式测试 · 不代表实际更新结果" if test else "自动通知 · 无需回复",
    }
    html = template.substitute({key: escape(value, quote=True) for key, value in values.items()}, diagnostic_block=diagnostic_block)
    message.add_alternative(html, subtype="html")
    return message


def notify(env):
    password = env.get("SMTP_PASSWORD")
    if not password:
        raise ValueError("SITE_SMTP_PASSWORD is not configured")
    message = build_message(env)
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
