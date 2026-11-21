"""Общая страховка для тестов extras: настоящий extras/.env не влияет на тесты.

Переменные выставляются ДО того, как модули вызовут load_dotenv (он не перезаписывает уже
заданные), поэтому даже при SMS_PROVIDER=eskiz в .env ни один тест не отправит настоящее SMS.
Отдельные тесты могут переопределить их через monkeypatch.setenv.
"""
import pytest

SAFE_ENV = {
    "SMS_PROVIDER": "mock",
    "ESKIZ_EMAIL": "",
    "ESKIZ_PASSWORD": "",
    "ESKIZ_TEST_MODE": "0",
    "EXTRAS_ADMIN_TOKEN": "",
    "PUBLIC_BASE_URL": "http://localhost:8001",
}


@pytest.fixture(autouse=True)
def safe_env(monkeypatch):
    for k, v in SAFE_ENV.items():
        monkeypatch.setenv(k, v)
