import importlib.util
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
        }

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
        self.assertEqual(message["From"], "gao497868860@163.com")
        body = message.get_content()
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


if __name__ == "__main__":
    unittest.main()
