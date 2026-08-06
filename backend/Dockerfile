FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MPLBACKEND=Agg \
    PIP_NO_CACHE_DIR=1 \
    GRB_LICENSE_FILE=/run/secrets/gurobi.lic

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/hydrogen
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --upgrade pip \
 && pip install --requirement backend/requirements.txt

COPY backend /srv/hydrogen/backend
# The backend contract suite intentionally reads the frontend RunStatus union
# to catch API drift. Keep that source file in the backend image used by setup
# verification; the original image copied only backend/ and made the test fail.
COPY src/lib/solver/types.ts /srv/hydrogen/src/lib/solver/types.ts
RUN chmod -R a-w /srv/hydrogen/backend/solver \
 && useradd --create-home --uid 10001 hydrogen \
 && mkdir -p /data/runs /data/results /data/logs /run/secrets \
 && chown -R hydrogen:hydrogen /data /run/secrets

USER hydrogen
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=3).status==200 else 1)"

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
