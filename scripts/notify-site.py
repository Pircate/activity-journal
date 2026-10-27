"""Email the site owner after a successful GitHub Pages publication."""

import os
import smtplib
import ssl
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from zoneinfo import ZoneInfo


MAILBOX = "gao497868860@163.com"


def notify(env):
    password = env.get("SMTP_PASSWORD")
    if not password:
        raise ValueError("SITE_SMTP_PASSWORD is not configured")
    site_url = env["SITE_URL"]
    commit = env["DEPLOYED_COMMIT"]
    repository_url = f'{env["GITHUB_SERVER_URL"]}/{env["GITHUB_REPOSITORY"]}'
    run_url = f'{repository_url}/actions/runs/{env["GITHUB_RUN_ID"]}/attempts/{env["GITHUB_RUN_ATTEMPT"]}'
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    message = EmailMessage()
    message["From"] = MAILBOX
    message["To"] = MAILBOX
    message["Subject"] = "运动日志网站更新完成"
    message["Date"] = format_datetime(now)
    message["Message-ID"] = make_msgid(domain="163.com")
    message.set_content(
        "运动日志网站已更新，GitHub Pages 部署成功。\n\n"
        f"网站：{site_url}\n"
        f"通知时间：{now:%Y-%m-%d %H:%M:%S}（北京时间）\n"
        f"发布版本：{repository_url}/commit/{commit}\n"
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
