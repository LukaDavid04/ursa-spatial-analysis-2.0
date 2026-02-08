from uuid import UUID

import time

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from . import llm, nominatim, pinService, schemas
from .db import Base, engine, get_db

app = FastAPI(title="URSA Spatial API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    # Retry briefly so the API can come up even if Postgres is still booting
    # Not the cleanest or the best approach, but a temporary fix that would be redone to make the project a little beat easier to test
    for attempt in range(1, 11):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except OperationalError:
            if attempt == 10:
                raise
            time.sleep(1.5)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/pins", response_model=list[schemas.PinRead])
def list_pins(db: Session = Depends(get_db)):
    return pinService.get_pins(db)


@app.post("/api/pins", response_model=schemas.PinRead, status_code=201)
def create_pin(pin: schemas.PinCreate, db: Session = Depends(get_db)):
    return pinService.create_pin(db, pin)


@app.delete("/api/pins/{pin_id}", status_code=204)
def remove_pin(pin_id: UUID, db: Session = Depends(get_db)):
    deleted = pinService.delete_pin(db, pin_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Pin not found")
    # Explicit 204 response keeps FastAPI from serializing an empty body
    return Response(status_code=204)


@app.get("/api/geocode")
def geocode(q: str):
    return nominatim.geocode(q)


@app.get("/api/reverse")
def reverse(lat: float, lon: float):
    return nominatim.reverse_geocode(lat, lon)


@app.post("/api/chat", response_model=schemas.ChatResponse)
def chat(request: schemas.ChatRequest, db: Session = Depends(get_db)):
    try:
        # Tool-enabled chat uses both the request and database for pin actions
        return llm.chat_with_tools(
            message=request.message,
            map_state=request.map_state,
            conversation_id=request.conversation_id,
            db=db,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
