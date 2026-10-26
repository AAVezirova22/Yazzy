"""Durable simulator store. Accepted batches are removed only after API acknowledgement."""

import json
import os
import sqlite3


class Queue:
    def __init__(self, path, max_batches=10000):
        self.db = sqlite3.connect(path)
        if os.name != "nt":
            os.chmod(path, 0o600)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, payload TEXT NOT NULL, token TEXT NOT NULL)"
        )
        self.max_batches = max_batches

    def put(self, payload, token):
        previous = self.db.execute(
            "SELECT payload FROM queue WHERE id=?", (payload["batchId"],)
        ).fetchone()
        encoded = json.dumps(payload, sort_keys=True)
        if previous:
            if json.loads(previous[0]) != payload:
                raise ValueError("Idempotency conflict in local queue")
            return
        if (
            self.db.execute("SELECT COUNT(*) FROM queue").fetchone()[0]
            >= self.max_batches
        ):
            raise BufferError("Queue full: recording paused; no silent data loss")
        self.db.execute(
            "INSERT OR IGNORE INTO queue VALUES(?,?,?)",
            (payload["batchId"], encoded, token),
        )
        self.db.commit()

    def flush(self, client):
        count = 0
        for batch_id, payload, token in self.db.execute(
            "SELECT id,payload,token FROM queue ORDER BY rowid"
        ).fetchall():
            response = client.post(
                "/api/v1/telemetry/batches",
                json=json.loads(payload),
                headers={"Authorization": "Device " + token},
            )
            response.raise_for_status()
            if response.json().get("accepted"):
                self.db.execute("DELETE FROM queue WHERE id=?", (batch_id,))
                self.db.commit()
                count += 1
        return count
