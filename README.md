# SysMap

Maps the organization's systems from team questionnaires.

## Run the core tests (no dependencies needed)
    cd backend && python3 -m unittest discover -s tests -t . -v

## Run locally with Postgres
    docker compose up --build
    curl localhost:8000/api/questionnaires

## Try it
    curl -X POST localhost:8000/api/submissions -H 'Content-Type: application/json' -d @docs/example-submission.json
    curl localhost:8000/api/diagram      # Mermaid text

## Deploy
    helm lint charts/sysmap
    helm upgrade --install sysmap charts/sysmap -f my-values.yaml

## Layout
- backend/app/core: validation, normalization, diagram (pure Python, tested)
- backend/app: FastAPI + SQLAlchemy (JSONB on Postgres)
- backend/questionnaires: versioned questionnaire definitions (JSON)
- charts/sysmap: Helm chart
