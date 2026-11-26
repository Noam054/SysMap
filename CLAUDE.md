# SysMap: notes for Claude Code

SysMap is an internal web app. Each system's team answers questions (how many servers, where, which site,
what it connects to), and SysMap draws the organization's architecture. Later it will also show live
status from the monitoring systems.

## Hard constraints

- The app runs in an **air-gapped network** that already has **Kubernetes and Helm**. It is developed outside
  and transferred in as container images + a Helm chart.
- So: **no CDNs, no external fonts or APIs**, and keep dependencies few and **pinned**. The frontend has
  no dependencies and no build step on purpose. Do not add npm packages or a bundler without asking.
- Never commit real hostnames, passwords or database URLs. Real values go in `my-values.yaml` (git-ignored).

## Layout

- `frontend/`: plain HTML + JS modules, served by the backend. `diagram.js` draws the SVG itself.
- `backend/app/core/`: pure Python (validation, normalization, Mermaid text, questionnaire checker).
- `backend/app/`: FastAPI + SQLAlchemy. Answers are stored raw as JSONB, next to the normalized model.
- `backend/questionnaires/`: the questions, as versioned JSON. Format: `docs/questionnaire-format.md`.
- `charts/sysmap/`: Helm chart (a Service only, no ingress yet).

## Commands

    cd backend && python3 -m unittest discover -s tests -t . -v     # Python tests
    cd backend && python3 -m app.core.schema_check                  # check the questionnaire files
    cd frontend && node --test                                      # frontend tests (Node 20+)
    docker compose up --build                                       # run locally at http://localhost:8000
    docker build -f backend/Dockerfile -t sysmap/backend:0.1.0 .    # build from the repo root

## Decisions already made

- Modular monolith, not microservices. Postgres (JSONB for flexible answers), not MongoDB. No Kafka for now.
  Split services or add streaming only when a concrete need appears (for example monitoring ingestion).
- The owner writes the questions himself. Do not invent questionnaires. Never edit a published questionnaire
  file: copy it to the next version (`name.v2.json`).
- The server's validation is the authority; the browser repeats it only for instant feedback. Keep
  `backend/app/core/validation.py` and `frontend/js/form-logic.js` in step.
- The same goes for the model: `frontend/js/model.js` copies `backend/app/core/normalize.py` for the
  live diagram beside the form. Keep the two in step (`frontend/tests/model.test.mjs` mirrors the Python tests).
- The diagram only understands the question ids listed in `docs/questionnaire-format.md`.

## Status

- Tested: core Python logic, frontend logic, and the UI in a headless browser against a stand-in server.
- **Never run yet:** the real FastAPI app, the Docker image, the Helm chart and Postgres. These were written
  without being able to install or run them, so expect small fixes on the first real run. Start there.
- Known shortcuts: tables are created at startup (`init_db`), so add Alembic migrations before real use.
  There is no authentication and no audit history yet.

## Likely next steps

1. Run it for real (compose), fix what breaks, run `helm lint` and `helm template`.
2. Make the mapping from questions to the diagram configurable in the questionnaire file.
3. Authentication (the internal network probably has LDAP/OIDC), audit history, Alembic.
4. Test a transfer of images + chart into the air-gapped network early.
5. Monitoring integration as a separate module, later.
