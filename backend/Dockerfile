# Build from the repository root:
#   docker build -f backend/Dockerfile -t sysmap/backend:0.1.0 .
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/questionnaires ./questionnaires
COPY frontend ./frontend
RUN useradd --uid 10001 --no-create-home sysmap
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
