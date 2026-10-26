import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite:///" + tempfile.mktemp(prefix="yazzy-tests-", suffix=".db")
os.environ["YAZZY_DEMO_ENABLED"] = "true"

import pytest
from fastapi.testclient import TestClient

from yazzy.api.main import app
from yazzy.bootstrap import seed
from yazzy.infrastructure.db import engine
from yazzy.infrastructure.models import Base


@pytest.fixture(autouse=True)
def database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        r = c.post("/api/v1/auth/demo?mode=personal")
        assert r.status_code == 200, r.text
        c.headers["X-CSRF-Token"] = r.json()["csrfToken"]
        yield c


@pytest.fixture
def fleet_client():
    with TestClient(app) as c:
        r = c.post("/api/v1/auth/demo?mode=fleet")
        c.headers["X-CSRF-Token"] = r.json()["csrfToken"]
        yield c


@pytest.fixture
def enrolled(client):
    vehicle = client.get("/api/v1/vehicles").json()[0]
    response = client.post("/api/v1/devices/enrolments", json={"vehicleId": vehicle["id"]})
    assert response.status_code == 201, response.text
    return vehicle, response.json()
