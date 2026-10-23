FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8000
WORKDIR /app

RUN pip install "agent-framework-core>=1.22.0" "agent-framework-openai>=1.17.0" "faker>=40.43.0" \
    "fastapi>=0.150.0" "python-dotenv>=1.2.4" "uvicorn>=0.54.0"

COPY app ./app
COPY web ./web
COPY data ./data

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app/data
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
