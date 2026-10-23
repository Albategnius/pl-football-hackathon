"""Each visitor gets an isolated console; one judge's reset never touches another's match."""

from fastapi.testclient import TestClient

from app.main import app


def test_sessions_are_isolated():
    c = TestClient(app)
    c.post("/api/control?sid=judge_alpha", json={"speed": 60, "inject_faults": True})
    a = c.get("/api/state?sid=judge_alpha").json()["status"]
    b = c.get("/api/state?sid=judge_bravo").json()["status"]
    assert a["speed"] == 60 and a["inject_faults"] is True
    assert b["speed"] != 60 and b["inject_faults"] is False


def test_invalid_session_id_rejected_and_health():
    c = TestClient(app)
    assert c.get("/api/state?sid=../etc").status_code == 400
    h = c.get("/api/health").json()
    assert h["status"] == "ok" and h["synthetic_data_only"] is True
