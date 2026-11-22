FROM python:3.12.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" PYTHONPATH=/app:/app/backend/src
WORKDIR /app
RUN pip install --no-cache-dir uv==0.13.4
COPY backend/pyproject.toml backend/uv.lock /app/backend/
RUN cd /app/backend && uv sync --frozen --no-dev --no-install-project
COPY backend /app/backend
COPY simulator /app/simulator
COPY scripts /app/scripts
# The app runs as an ordinary user: files copied from a machine that keeps them owner-only must stay readable.
RUN chmod -R a+rX /app/backend /app/simulator /app/scripts
RUN cd /app/backend && uv sync --frozen --no-dev && useradd --create-home --uid 10001 yazzy && mkdir /state && chown yazzy /state
USER yazzy
EXPOSE 8000
CMD ["uvicorn", "yazzy.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
