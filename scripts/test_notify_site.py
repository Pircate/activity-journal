import importlib.util
import json
from pathlib import Path
import smtplib
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "notify_site", Path(__file__).with_name("notify-site.py")
)
notification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notification)


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "SMTP_PASSWORD": "test-private-password",
            "SITE_URL": "https://pircate.github.io/activity-journal/",
            "DEPLOYED_COMMIT": "a" * 40,
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_REPOSITORY": "Pircate/activity-journal",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_API_URL": "https://api.github.com",
            "GITHUB_TOKEN": "test-private-token",
        }

    def test_signed_log_redirect_does_not_forward_github_token(self):
        request = notification.Request(
            "https://api.github.com/repos/Pircate/activity-journal/actions/jobs/456/logs",
            headers={"Authorization": "Bearer test-private-token"},
        )
        redirected = notification.GitHubRedirectHandler().redirect_request(
            request, None, 302, "Found", {}, "https://logs.example.test/job.txt?signature=test"
        )
        self.assertFalse(redirected.has_header("Authorization"))
        self.assertEqual(redirected.full_url, "https://logs.example.test/job.txt?signature=test")

    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_success_sends_expected_recipient_and_deployed_version(self, connect):
        smtp = connect.return_value.__enter__.return_value
        smtp.send_message.return_value = {}
        notification.notify(self.env)
        smtp.login.assert_called_once_with(
            "gao497868860@163.com", self.env["SMTP_PASSWORD"]
        )
        smtp.send_message.assert_called_once()
        message = smtp.send_message.call_args.args[0]
        self.assertEqual(message["To"], "gao497868860@163.com")
        self.assertEqual(message["From"].addresses[0].addr_spec, "gao497868860@163.com")
        body = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn(self.env["SITE_URL"], body)
        self.assertIn("/commit/" + self.env["DEPLOYED_COMMIT"], body)
        self.assertIn("/actions/runs/123/attempts/2", body)
        self.assertIn("北京时间", body)
        self.assertNotIn(self.env["SMTP_PASSWORD"], message.as_string())
        self.assertIsNotNone(connect.call_args.kwargs["context"])

    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_missing_configuration_never_opens_connection(self, connect):
        for field in ["SMTP_PASSWORD", "SITE_URL", "DEPLOYED_COMMIT"]:
            env = dict(self.env)
            del env[field]
            with self.assertRaises((ValueError, KeyError)):
                notification.notify(env)
        connect.assert_not_called()

    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_smtp_error_is_not_retried(self, connect):
        smtp = connect.return_value.__enter__.return_value
        smtp.send_message.side_effect = smtplib.SMTPServerDisconnected("lost reply")
        with self.assertRaises(smtplib.SMTPServerDisconnected):
            notification.notify(self.env)
        smtp.send_message.assert_called_once()
        connect.assert_called_once()

    @patch.object(notification, "github_request")
    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_failure_includes_current_attempt_stage_and_redacted_error(self, connect, api):
        self.env["UPDATE_RESULT"] = "failure"
        api.side_effect = [
            json.dumps({"jobs": [{
                "id": 456, "name": "update-and-deploy", "conclusion": "failure",
                "steps": [{"name": "Update and build snapshot", "conclusion": "failure"}],
            }]}),
            "2026-10-27T10:00:00Z Error: Intervals.icu request failed: HTTP 503\n"
            "2026-10-27T10:00:01Z ##[error]test-private-token test-private-password\n",
        ]
        smtp = connect.return_value.__enter__.return_value
        smtp.send_message.return_value = {}
        notification.notify(self.env)
        message = smtp.send_message.call_args.args[0]
        self.assertEqual(message["Subject"], "运动日志网站更新失败")
        body = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("Update and build snapshot", body)
        self.assertIn("Intervals.icu request failed: HTTP 503", body)
        self.assertIn("/actions/runs/123/attempts/2", body)
        self.assertNotIn("部署成功", body)
        self.assertNotIn("test-private-token", body)
        self.assertNotIn("test-private-password", body)
        self.assertEqual(api.call_args_list[0].args[1], "/actions/runs/123/attempts/2/jobs?per_page=100")
        self.assertEqual(api.call_args_list[1].args[1], "/actions/jobs/456/logs")

    @patch.object(notification, "github_request", side_effect=TimeoutError)
    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_diagnostic_outage_still_sends_failure_or_cancellation(self, connect, api):
        smtp = connect.return_value.__enter__.return_value
        smtp.send_message.return_value = {}
        for result in ("failure", "cancelled"):
            self.env["UPDATE_RESULT"] = result
            notification.notify(self.env)
            message = smtp.send_message.call_args.args[0]
            body = message.get_body(preferencelist=("plain",)).get_content()
            self.assertIn("详细错误暂时无法读取", body)
            self.assertIn("/actions/runs/123/attempts/2", body)
            self.assertNotEqual(message["Subject"], "运动日志网站更新完成")
        self.assertEqual(smtp.send_message.call_count, 2)

    @patch.object(notification, "github_request")
    def test_log_outage_preserves_failed_stage(self, api):
        api.side_effect = [json.dumps({"jobs": [{
            "id": 456, "name": "update-and-deploy", "conclusion": "timed_out", "steps": [],
        }]}), TimeoutError()]
        details = notification.failure_details(self.env)
        self.assertIn("timed_out", details)
        self.assertIn("详细错误暂时无法读取", details)

    @patch.object(notification, "github_request")
    def test_log_without_error_is_not_invented(self, api):
        api.side_effect = [json.dumps({"jobs": [{
            "id": 456, "name": "update-and-deploy", "conclusion": "failure",
            "steps": [{"name": "Deploy website", "conclusion": "failure"}],
        }]}), "2026-10-27T10:00:00Z Waiting for deployment\n"]
        details = notification.failure_details(self.env)
        self.assertIn("Deploy website", details)
        self.assertIn("日志未提供明确错误摘要", details)

    @patch.object(notification, "github_request")
    @patch.object(notification.smtplib, "SMTP_SSL")
    def test_success_never_reads_failure_logs(self, connect, api):
        connect.return_value.__enter__.return_value.send_message.return_value = {}
        notification.notify(self.env)
        api.assert_not_called()

    def test_html_email_keeps_plain_fallback_and_short_links(self):
        message = notification.build_message(self.env, test=True)
        self.assertEqual(message.get_content_type(), "multipart/alternative")
        plain = message.get_body(preferencelist=("plain",)).get_content()
        html = message.get_body(preferencelist=("html",)).get_content()
        self.assertIn("样式测试邮件", plain)
        self.assertIn("【测试】", message["Subject"])
        self.assertIn("打开运动日志", html)
        self.assertIn('href="' + self.env["SITE_URL"] + '"', html)
        self.assertNotIn('>' + self.env["SITE_URL"] + '<', html)
        self.assertIn("aaaaaaa &nbsp;↗", html)
        self.assertIn("样式测试 · 不代表实际更新结果", html)

    @patch.object(notification, "failure_details", return_value='失败环节：Build\n错误摘要：<script>alert("x")</script> & unexpected')
    def test_failure_html_escapes_diagnostics_and_links_to_run(self, details):
        self.env["UPDATE_RESULT"] = "failure"
        message = notification.build_message(self.env)
        html = message.get_body(preferencelist=("html",)).get_content()
        plain = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("本次更新未完成", html)
        self.assertIn("查看失败原因", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>", html)
        self.assertIn('<script>alert("x")</script>', plain)
        self.assertIn('href="https://github.com/Pircate/activity-journal/actions/runs/123/attempts/2"', html)


if __name__ == "__main__":
    unittest.main()
