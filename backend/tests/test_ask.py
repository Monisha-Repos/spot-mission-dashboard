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
