"""AI assistant retrieval and guardrail (no LLM: ASK_PROVIDER=none)."""


def ask(client, question, **kw):
    return client.post("/ask", json={"question": question, **kw}).json()


def test_finds_records_by_id(client):
    r = ask(client, "What happened with AN014?")
    assert r["provider"] == "none" and r["sources"][0]["id"] == "AN014"


def test_uses_screen_context(client):
    r = ask(client, "Is anything wrong here?", context={"waypoint": "WP05"})
    assert any(s["id"] == "WP05" for s in r["sources"])
    r = ask(client, "What did this part find?", context={"part": "thermal_camera"})
    assert r["sources"][0]["id"] == "thermal_camera"


def test_topic_questions_retrieve_relevant_docs(client):
    ids = [s["id"] for s in ask(client, "Did the improved configuration V2 perform better than V1?")["sources"]]
    assert "compare-V1-V2" in ids or "insight-v1-vs-v2" in ids
    ids = [s["id"] for s in ask(client, "Which waypoint has the most navigation failures?")["sources"]]
    assert any(i.startswith("WP") or i.startswith("insight-failure") or i.startswith("kpis") for i in ids)


def test_guardrail_on_off_topic_questions(client):
    for q in ("What is the best pizza topping?", "Who won the world cup?", "Tell me a joke", "What is the capital of France?"):
        r = ask(client, q)
        assert r["answer"] == "I don't have data on that." and r["provider"] == "guardrail", q
    for q in ("How hot did the pumps get?", "How do I charge Spot?", "What needs attention today?"):
        assert ask(client, q)["provider"] == "none", q


def test_modes(client):
    assert ask(client, "Summarize mission M020", mode="technical")["mode"] == "technical"
    assert client.post("/ask", json={"question": "x", "mode": "other"}).status_code == 422


def test_follow_up_uses_the_conversation(client):
    history = [{"role": "user", "content": "What happened with AN014?"},
               {"role": "assistant", "content": "Heat Exchanger 04 ran critically hot at WP07 [AN014]."}]
    alone = ask(client, "Why did it happen?")
    follow_up = ask(client, "Why did it happen?", history=history)
    assert alone["provider"] == "guardrail"  # on its own the question names nothing
    assert follow_up["provider"] == "none" and follow_up["sources"][0]["id"] == "AN014"


def test_history_reaches_the_model_cleaned(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.assistant import Assistant
    from app.main import create_app
    from conftest import make_settings
    seen = {}

    def fake(self, mode, prompt, history=None):
        seen.update(history=history, prompt=prompt)
        return "Answer [AN014]", "test-model"

    monkeypatch.setattr(Assistant, "_call_huggingface", fake)
    settings = make_settings(tmp_path, ASK_PROVIDER="huggingface", ASK_SPEND_FILE=str(tmp_path / "spend.json"))
    with TestClient(create_app(settings)) as c:
        history = [{"role": "assistant", "content": "Hi! Ask me about Spot."},  # a greeting first: dropped
                   {"role": "user", "content": "What happened with AN014?"},
                   {"role": "assistant", "content": "It ran hot [AN014]."},
                   {"role": "user", "content": "   "}]  # empty: dropped
        r = c.post("/ask", json={"question": "What should we do next?", "history": history}).json()
    assert r["provider"] == "huggingface"
    assert seen["history"] == [{"role": "user", "content": "What happened with AN014?"},
                               {"role": "assistant", "content": "It ran hot [AN014]."}]
    assert "follow-up" in seen["prompt"] and "[AN014]" in seen["prompt"]


def test_follow_up_finds_what_the_last_answer_named(client):
    history = [{"role": "user", "content": "Which waypoint fails most often?"},
               {"role": "assistant", "content": "Failures concentrate at WP02 (Electrical Room), then WP09."}]
    r = ask(client, "Why does it fail there?", history=history)
    assert r["sources"][0]["id"] == "WP02"
