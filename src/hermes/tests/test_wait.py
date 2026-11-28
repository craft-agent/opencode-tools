"""Tests of the limit the plugin puts on one call, which follows the ``wait_seconds`` setting."""

from __future__ import annotations

import unittest
from typing import Any
from unittest import mock

from support import StubContext, settings, tools

VARIABLE = "OPENCODE_TOOLS_WAIT_SECONDS"
DEFAULT_TIMEOUT = 80


def timeout_of(config: dict[str, Any], environ: dict[str, str] | None = None) -> float:
    return tools.call_timeout(settings.wait_seconds_setting(StubContext(config), environ or {}))


class CallTimeoutTest(unittest.TestCase):
    def test_a_call_may_run_a_margin_beyond_its_wait(self) -> None:
        self.assertEqual(tools.CALL_MARGIN_SECONDS, 30)
        self.assertEqual(tools.call_timeout(50), 80)
        self.assertEqual(tools.call_timeout(1.5), 31.5)


class WaitSecondsSettingTest(unittest.TestCase):
    def test_unset_it_is_the_default(self) -> None:
        self.assertEqual(timeout_of({}), DEFAULT_TIMEOUT)

    def test_a_configured_number_sets_the_timeout(self) -> None:
        self.assertEqual(timeout_of({"wait_seconds": 120}), 150)

    def test_the_variable_counts_when_the_configuration_has_none(self) -> None:
        self.assertEqual(timeout_of({}, {VARIABLE: "200"}), 230)
        self.assertEqual(timeout_of({}, {VARIABLE: " 60 "}), 90)

    def test_the_configuration_wins_over_the_variable(self) -> None:
        self.assertEqual(timeout_of({"wait_seconds": 120}, {VARIABLE: "200"}), 150)

    def test_a_configuration_that_is_no_number_falls_back_to_the_default(self) -> None:
        for value in (True, "120", [120], float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertEqual(timeout_of({"wait_seconds": value}), DEFAULT_TIMEOUT)

    def test_a_variable_that_is_no_number_falls_back_to_the_default(self) -> None:
        for text in ("abc", "", "nan", "inf"):
            with self.subTest(text=text):
                self.assertEqual(timeout_of({}, {VARIABLE: text}), DEFAULT_TIMEOUT)

    def test_the_process_environment_is_the_default_source(self) -> None:
        with mock.patch.dict("os.environ", {VARIABLE: "10"}):
            self.assertEqual(settings.wait_seconds_setting(StubContext({})), 10)
