from datetime import datetime
from typing import Any, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class PinBase(BaseModel):
    title: str = Field(..., max_length=255)
    notes: Optional[str] = None
    lat: float
    lon: float

class PinCreate(PinBase):
    pass

class PinRead(PinBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class MapState(BaseModel):
    center: list[float]
    zoom: float
    bbox: Optional[list[float]] = None


class ChatRequest(BaseModel):
    message: str
    map_state: MapState
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    assistant_text: str
    actions: list[dict[str, Any]]
    conversation_id: str
