# SysMap

Maps the organization's systems from team questionnaires: teams answer questions in the web app,
and SysMap draws the architecture.

## Layout

- `frontend/`: the web app. Plain HTML + JavaScript modules, **no dependencies and no build step**
  (nothing to download inside the air-gap). The backend serves it.
- `backend/app/core`: validation, normalization, diagram text (pure Python, tested)
- `backend/app`: FastAPI + SQLAlchemy (JSONB on Postgres)
- `backend/questionnaires`: the questions, as versioned JSON files. See `docs/questionnaire-format.md`
- `charts/sysmap`: Helm chart

## Tests (no installs needed)

    cd backend && python3 -m unittest discover -s tests -t . -v
    cd frontend && node --test                 # Node 20+, built-in runner

## Check your questions

    cd backend && python3 -m app.core.schema_check

## Run locally with Postgres

    docker compose up --build

Open http://localhost:8000. Questions and the web app are mounted into the container, so after editing
them you only refresh the browser.

## Build the image (from the repository root)

    docker build -f backend/Dockerfile -t sysmap/backend:0.1.0 .

## Deploy

    helm lint charts/sysmap
    helm upgrade --install sysmap charts/sysmap -f my-values.yaml

The chart creates a Service only. To look at the app without an ingress:

    kubectl port-forward svc/sysmap-backend 8080:80

## API (for scripts)

    curl localhost:8000/api/questionnaires
    curl -X POST localhost:8000/api/submissions -H 'Content-Type: application/json' -d @docs/example-submission.json
    curl localhost:8000/api/model        # what the diagram is drawn from
    curl localhost:8000/api/diagram      # the same as Mermaid text
