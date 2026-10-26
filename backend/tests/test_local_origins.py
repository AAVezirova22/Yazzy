import pytest
from fastapi.testclient import TestClient

from yazzy.api.main import app


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
@pytest.mark.parametrize("mode", ["fleet", "personal"])
def test_documented_local_login_and_mutation(origin, mode):
    with TestClient(app) as client:
        login = client.post("/api/v1/auth/demo", params={"mode": mode}, headers={"Origin": origin})
        assert login.status_code == 200, login.text
        client.headers.update({"Origin": origin, "X-CSRF-Token": login.json()["csrfToken"]})
        result = client.post("/api/v1/vehicles", json={"name": "Origin regression"})
        assert result.status_code == 201, result.text


@pytest.mark.parametrize(
    "origin",
    [
        "https://attacker.invalid",
        "http://localhost.attacker.invalid:5173",
        "http://127.0.0.1:5174",
        "null",
    ],
)
def test_other_origins_stay_rejected(client, origin):
    login = client.post("/api/v1/auth/demo?mode=fleet", headers={"Origin": origin})
    assert login.status_code == 403
    assert login.json()["detail"]["code"] == "ORIGIN_DENIED"
    result = client.post("/api/v1/vehicles", json={"name": "Forbidden"}, headers={"Origin": origin})
    assert result.status_code == 403
    assert result.json()["detail"]["code"] == "ORIGIN_DENIED"


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_cors_uses_the_same_loopback_policy(origin):
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/vehicles",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-csrf-token",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert response.headers["access-control-allow-credentials"] == "true"


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_loopback_alias_is_never_implicit_outside_development(environment):
    from yazzy.config import Settings

    config = Settings(environment=environment, web_origin="http://localhost:5173")
    assert config.allowed_web_origins == ("http://localhost:5173",)


def test_custom_development_origin_does_not_trust_localhost():
    from yazzy.config import Settings

    config = Settings(environment="development", web_origin="https://preview.example:8443")
    assert config.allowed_web_origins == ("https://preview.example:8443",)


def test_loopback_alias_preserves_configured_scheme_and_port():
    from yazzy.config import Settings

    config = Settings(environment="development", web_origin="https://127.0.0.1:8443")
    assert set(config.allowed_web_origins) == {"https://localhost:8443", "https://127.0.0.1:8443"}


def test_production_csrf_keeps_exact_origin(client, monkeypatch):
    from dataclasses import replace

    from yazzy.modules.identity import policy

    monkeypatch.setattr(
        policy,
        "settings",
        replace(policy.settings, environment="production", web_origin="http://localhost:5173"),
    )
    response = client.post(
        "/api/v1/vehicles",
        json={"name": "Not allowed"},
        headers={"Origin": "http://127.0.0.1:5173"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ORIGIN_DENIED"
