"""Operator sign-in: name + role + shared PIN, exchanged for a signed token (hackathon-grade; use SSO in production)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

ROLES = {"operator", "supervisor"}
TOKEN_HOURS = 12


class AuthError(Exception):
    pass


def issue_token(name: str, role: str, pin: str, *, expected_pin: str, secret: str) -> str:
    if not expected_pin:
        raise AuthError("sign-in is disabled until OPS_PIN is set on the server")
    if not hmac.compare_digest(pin.encode(), expected_pin.encode()):
        raise AuthError("wrong PIN")
    name = name.strip()
    if not name or len(name) > 60:
        raise AuthError("name must be 1-60 characters")
    if role not in ROLES:
        raise AuthError(f"role must be one of {sorted(ROLES)}")
    payload = base64.urlsafe_b64encode(json.dumps(
        {"name": name, "role": role, "exp": int(time.time()) + TOKEN_HOURS * 3600}).encode()).decode()
    return f"{payload}.{_sign(payload, secret)}"


def read_token(token: str, *, secret: str) -> dict:
    try:
        payload, signature = token.split(".", 1)
    except ValueError:
        raise AuthError("malformed token") from None
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        raise AuthError("invalid token; sign in again")
    user = json.loads(base64.urlsafe_b64decode(payload))
    if user["exp"] < time.time():
        raise AuthError("session expired; sign in again")
    return user


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
