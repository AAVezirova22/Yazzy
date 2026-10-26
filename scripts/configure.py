"""Create untracked local credentials; never overwrites an existing environment file."""

import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    raise SystemExit(
        ".env exists; edit it explicitly rather than replacing credentials"
    )
text = (root / ".env.example").read_text()
for label in [
    "replace-with-random-local-admin-password",
    "replace-with-random-local-runtime-password",
    "replace-with-at-least-32-random-characters",
]:
    text = text.replace(label, secrets.token_urlsafe(36))
path.write_text(text)
path.chmod(0o600)
print("Local environment created. Run docker compose up --build.")
