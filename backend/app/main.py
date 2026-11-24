import json
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import PlainTextResponse

from app.core.diagram import build_mermaid
from app.core.normalize import normalize
from app.core.validation import validate_answers
from app.db import SessionLocal, Submission, init_db

QUESTIONNAIRE_DIR = Path(__file__).resolve().parent.parent / "questionnaires"

app = FastAPI(title="SysMap")


def load_questionnaires():
    """Latest version of each questionnaire definition found on disk."""
    latest = {}
    for f in sorted(QUESTIONNAIRE_DIR.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        cur = latest.get(d["id"])
        if cur is None or d["version"] > cur["version"]:
            latest[d["id"]] = d
    return latest


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/questionnaires")
def list_questionnaires():
    return [
        {"id": d["id"], "version": d["version"], "title": d["title"]}
        for d in load_questionnaires().values()
    ]


@app.get("/api/questionnaires/{qid}")
def get_questionnaire(qid: str):
    d = load_questionnaires().get(qid)
    if d is None:
        raise HTTPException(404, "Unknown questionnaire")
    return d


@app.post("/api/submissions", status_code=201)
def create_submission(payload: dict = Body(...)):
    definition = load_questionnaires().get(payload.get("questionnaire_id"))
    if definition is None:
        raise HTTPException(404, "Unknown questionnaire")
    answers = payload.get("answers") or {}
    errors = validate_answers(definition, answers)
    if errors:
        raise HTTPException(422, {"errors": errors})
    model = normalize(answers)
    with SessionLocal() as db:
        row = Submission(
            questionnaire_id=definition["id"],
            questionnaire_version=definition["version"],
            system_name=model["system"],
            answers=answers,
            normalized=model,
        )
        db.add(row)
        db.commit()
        return {"id": row.id, "system": row.system_name}


@app.get("/api/submissions")
def list_submissions():
    with SessionLocal() as db:
        rows = db.query(Submission).order_by(Submission.created_at.desc()).all()
        return [
            {"id": r.id, "system": r.system_name, "questionnaire": r.questionnaire_id,
             "version": r.questionnaire_version, "created_at": r.created_at.isoformat()}
            for r in rows
        ]


def _latest_models():
    """Newest submission per system."""
    with SessionLocal() as db:
        rows = db.query(Submission).order_by(Submission.created_at.asc()).all()
        return list({r.system_name: r.normalized for r in rows}.values())


@app.get("/api/model")
def get_model():
    return _latest_models()


@app.get("/api/diagram", response_class=PlainTextResponse)
def get_diagram():
    return build_mermaid(_latest_models())
