from uuid import UUID
from sqlalchemy.orm import Session
from . import models, schemas

def get_pins(db: Session):
    # Default ordering shows the newest pins first
    return db.query(models.Pin).order_by(models.Pin.created_at.desc()).all()


def get_pins_in_bbox(db: Session, bbox: list[float]):
    min_lon, min_lat, max_lon, max_lat = bbox
    # Bounding box is expected as [min_lon, min_lat, max_lon, max_lat]
    return (
        db.query(models.Pin)
        .filter(models.Pin.lon >= min_lon)
        .filter(models.Pin.lon <= max_lon)
        .filter(models.Pin.lat >= min_lat)
        .filter(models.Pin.lat <= max_lat)
        .order_by(models.Pin.created_at.desc())
        .all()
    )


def create_pin(db: Session, pin_in: schemas.PinCreate):
    # Persist a new pin and return the stored record
    pin = models.Pin(**pin_in.model_dump())
    db.add(pin)
    db.commit()
    db.refresh(pin)
    return pin


def delete_pin(db: Session, pin_id: UUID):
    pin = db.get(models.Pin, pin_id)
    if not pin:
        return False
    db.delete(pin)
    db.commit()
    return True


def delete_pins(db: Session, pin_ids: list[UUID]):
    if not pin_ids:
        return []
    removed_ids = [
        row[0]
        for row in db.query(models.Pin.id).filter(models.Pin.id.in_(pin_ids)).all()
    ]
    if not removed_ids:
        return []
    db.query(models.Pin).filter(models.Pin.id.in_(removed_ids)).delete(
        synchronize_session=False
    )
    db.commit()
    return removed_ids


def delete_all_pins(db: Session):
    removed_count = db.query(models.Pin).delete()
    db.commit()
    return removed_count
