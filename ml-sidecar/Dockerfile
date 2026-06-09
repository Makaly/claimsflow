FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV MODEL_PATH=/data/fraud_model.pkl
VOLUME ["/data"]

# Drop root: run as a non-privileged user. /app and /data are owned by it so the
# model can be persisted. NOTE: a mounted /data volume must also be writable by
# uid 10001 (set ownership on the host/volume, or run with that uid).
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
