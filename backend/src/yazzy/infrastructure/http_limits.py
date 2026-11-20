"""Bound chunked bodies before parsing; per-IP rate limits are shared through Redis in production."""

import hashlib
import time
from collections import OrderedDict

from starlette.responses import JSONResponse

from yazzy.config import settings


class RequestLimits:
    def __init__(self, app, max_bytes=1_000_000):
        self.app, self.max_bytes = app, max_bytes
        self.windows = OrderedDict()
        self.redis = None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/health":
            return await self.app(scope, receive, send)
        host = (scope.get("client") or ("unknown",))[0]
        key = hashlib.sha256(host.encode()).hexdigest()[:24]
        minute = int(time.time() // 60)
        if settings.environment == "production":
            from redis.asyncio import Redis

            if self.redis is None:
                self.redis = Redis.from_url(settings.redis_url, socket_timeout=2)
            try:
                count = await self.redis.eval(
                    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],65) end; return n",
                    1,
                    f"rate:{key}:{minute}",
                )
            except Exception:
                return await JSONResponse(
                    {"detail": {"code": "RATE_LIMIT_SERVICE_UNAVAILABLE"}}, 503
                )(scope, receive, send)
        else:
            window, count = self.windows.get(key, (minute, 0))
            count = count + 1 if window == minute else 1
            self.windows[key] = minute, count
            self.windows.move_to_end(key)
            if len(self.windows) > 10000:
                self.windows.popitem(last=False)
        if count > 2400:
            return await JSONResponse(
                {"detail": {"code": "RATE_LIMITED"}}, 429, headers={"Retry-After": "60"}
            )(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                return await JSONResponse({"detail": {"code": "PAYLOAD_TOO_LARGE"}}, 413)(
                    scope, receive, send
                )
            if not message.get("more_body", False):
                break
        delivered = False

        async def limited_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, limited_receive, send)
