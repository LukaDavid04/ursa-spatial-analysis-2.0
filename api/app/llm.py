import json
import logging
import os
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4
from openai import OpenAI
from sqlalchemy.orm import Session
from . import nominatim, pinService, schemas

logger = logging.getLogger(__name__)
_CONVERSATIONS: dict[str, list[dict[str, Any]]] = {}
_MAX_HISTORY_ITEMS = 30
_MAX_GEOCODE_CANDIDATES = 5

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
DEFAULT_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))


SYSTEM_PROMPT = (
    "You are a helpful assistant named Ursa for a map-based AI Chat application. "
    "Use tools to search for places and manage map pins. "
    "Return clear user-facing text plus structured actions for the client. "
    "Do not include JSON, map_state payloads, or tool output in the user-facing text. "
    "Ask a clarifying question when a request is ambiguous."
    "If a geocode tool response includes status=ambiguous, ask the user to choose "
    "one of the provided candidates before proceeding. Present the candidates as "
    "a numbered list and ask the user to reply with the choice."
    "If you cannot answer, respond with 'I don't know.'"
    "Never fabricate information."
    "URSA stands for 'Urban Reasoning & Spatial Analysis'. Your goal is to help users analyze and interact with spatial data effectively."
)


def _client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(api_key=api_key)


def _responses_client(client: OpenAI):
    try:
        return client.responses
    except AttributeError:
        pass

    beta = getattr(client, "beta", None)
    if beta:
        try:
            return beta.responses
        except AttributeError:
            pass

    return None


def _get_conversation(conversation_id: Optional[str]) -> tuple[str, list[dict[str, Any]]]:
    if conversation_id and conversation_id in _CONVERSATIONS:
        return conversation_id, _CONVERSATIONS[conversation_id]

    # Start a new in-memory history when the ID is unknown
    new_id = conversation_id or str(uuid4())
    history: list[dict[str, Any]] = []
    _CONVERSATIONS[new_id] = history
    return new_id, history


def _trim_history(history: list[dict[str, Any]]) -> None:
    # Keep the conversation bounded to avoid runaway memory growth
    if len(history) <= _MAX_HISTORY_ITEMS:
        return
    del history[:-_MAX_HISTORY_ITEMS]


def _tool_definitions() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "geocode",
                "description": (
                    "Search for a place by name. If one clear result is found, "
                    "return status=resolved with lat/lon. If multiple results are "
                    "possible, return status=ambiguous with a short list of candidates."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "reverse_geocode",
                "description": "Look up the address for a latitude/longitude pair.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number"},
                        "lon": {"type": "number"},
                    },
                    "required": ["lat", "lon"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_pin",
                "description": "Create a new pin with a title and optional notes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number"},
                        "lon": {"type": "number"},
                        "title": {"type": "string"},
                        "notes": {"type": "string"},
                    },
                    "required": ["lat", "lon", "title"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_pins",
                "description": "List pins within an optional bounding box.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "bbox": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 4,
                            "maxItems": 4,
                        }
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remove_pin",
                "description": "Remove a single pin by ID.",
                "parameters": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                    "required": ["id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remove_pins",
                "description": (
                    "Remove multiple pins by ID, or remove all pins when no IDs are"
                    " provided."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ids": {"type": "array", "items": {"type": "string"}}
                    },
                },
            },
        },
    ]


def _serialize_pin(pin: schemas.PinRead) -> Dict[str, Any]:
    return {
        "id": str(pin.id),
        "title": pin.title,
        "notes": pin.notes,
        "lat": pin.lat,
        "lon": pin.lon,
        "created_at": pin.created_at.isoformat(),
    }


def _execute_tool(name: str, arguments: Dict[str, Any], db: Session) -> Any:
    if name == "geocode":
        # Geocoding can return multiple candidates, ambiguity is surfaced explicitly
        results = nominatim.geocode(arguments["query"])
        if not results:
            raise ValueError("No geocoding results found.")
        if len(results) == 1:
            best = results[0]
            return {
                "status": "resolved",
                "lat": float(best["lat"]),
                "lon": float(best["lon"]),
                "display_name": best.get("display_name"),
            }
        candidates = []
        for entry in results[:_MAX_GEOCODE_CANDIDATES]:
            candidates.append(
                {
                    "label": entry.get("display_name"),
                    "lat": float(entry["lat"]),
                    "lon": float(entry["lon"]),
                }
            )
        return {"status": "ambiguous", "candidates": candidates}
    
    if name == "reverse_geocode":
        data = nominatim.reverse_geocode(arguments["lat"], arguments["lon"])
        return {"display_name": data.get("display_name"), "address": data.get("address")}
    
    if name == "create_pin":
        pin_in = schemas.PinCreate(
            lat=arguments["lat"],
            lon=arguments["lon"],
            title=arguments["title"],
            notes=arguments.get("notes"),
        )
        pin = pinService.create_pin(db, pin_in)
        return _serialize_pin(schemas.PinRead.model_validate(pin))
    
    if name == "list_pins":
        bbox = arguments.get("bbox")
        # Optional bbox filters help keep the pin list map-aware
        pins = (
            pinService.get_pins_in_bbox(db, bbox)
            if bbox
            else pinService.get_pins(db)
        )
        return [_serialize_pin(schemas.PinRead.model_validate(pin)) for pin in pins]
    
    if name == "remove_pin":
        pin_id = arguments.get("id")
        if not isinstance(pin_id, str):
            raise ValueError("Pin id is required.")
        removed = pinService.delete_pin(db, UUID(pin_id))
        return {"id": pin_id, "removed": removed}
    
    if name == "remove_pins":
        ids = arguments.get("ids")
        if ids is None:
            removed_count = pinService.delete_all_pins(db)
            return {"removed_all": True, "count": removed_count}
        if not isinstance(ids, list):
            raise ValueError("Pin ids must be a list.")
        pin_ids = [UUID(pin_id) for pin_id in ids if isinstance(pin_id, str)]
        removed_ids = pinService.delete_pins(db, pin_ids)
        return {
            "removed_all": False,
            "ids": [str(pin_id) for pin_id in removed_ids],
            "count": len(removed_ids),
        }
    raise ValueError(f"Unknown tool: {name}")


def _extract_tool_calls(response: Any) -> List[Dict[str, Any]]:
    tool_calls = []
    for item in getattr(response, "output", []):
        if getattr(item, "type", None) == "function_call":
            raw_args = getattr(item, "arguments", {}) or {}
            if isinstance(raw_args, str):
                raw_args = json.loads(raw_args) if raw_args else {}
            tool_calls.append(
                {
                    "id": getattr(item, "id", None),
                    "name": getattr(item, "name", None),
                    "arguments": raw_args,
                }
            )
    return tool_calls


def _extract_assistant_text(response: Any) -> str:
    text = getattr(response, "output_text", None)
    if text:
        return text
    for item in getattr(response, "output", []):
        if getattr(item, "type", None) == "message":
            for part in getattr(item, "content", []):
                if getattr(part, "type", None) in {"output_text", "text"}:
                    return getattr(part, "text", "")
    return ""


def _strip_structured_payload(text: str) -> str:
    if not text:
        return text
    candidate = text.rstrip()
    last_brace = candidate.rfind("{")
    if last_brace == -1:
        return text
    potential_json = candidate[last_brace:]
    try:
        payload = json.loads(potential_json)
    except json.JSONDecodeError:
        return text
    if isinstance(payload, dict) and ("map_state" in payload or "message" in payload):
        return candidate[:last_brace].rstrip()
    return text


def _should_add_action(name: str, result: Any) -> bool:
    if name != "geocode":
        return True
    if isinstance(result, dict) and result.get("status") == "resolved":
        return True
    return False


def _execute_tool_calls(
    tool_calls: list[dict[str, Any]],
    db: Session,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    actions: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for call in tool_calls:
        result = _execute_tool(call["name"], call["arguments"], db)
        if _should_add_action(call["name"], result):
            actions.append({"type": call["name"], "result": result})
        results.append({"id": call["id"], "result": result})
    return actions, results


def chat_with_tools(
    message: str,
    map_state: Optional[schemas.MapState],
    conversation_id: Optional[str],
    db: Session,
) -> schemas.ChatResponse:
    client = _client()
    tools = _tool_definitions()
    actions: List[Dict[str, Any]] = []

    user_payload = {
        "message": message,
        "map_state": map_state.model_dump() if map_state else None,
    }
    user_text = json.dumps(user_payload, ensure_ascii=False)

    responses = _responses_client(client)
    if responses:
        input_messages = []
        if not conversation_id:
            input_messages.append(
                {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]}
            )
        input_messages.append(
            {"role": "user", "content": [{"type": "text", "text": user_text}]}
        )

        response = responses.create(
            model=DEFAULT_MODEL,
            temperature=DEFAULT_TEMPERATURE,
            input=input_messages,
            tools=tools,
            previous_response_id=conversation_id,
        )

        for _ in range(3):
            tool_calls = _extract_tool_calls(response)
            if not tool_calls:
                break
            tool_outputs = []
            try:
                new_actions, results = _execute_tool_calls(tool_calls, db)
                actions.extend(new_actions)
                tool_outputs = [
                    {
                        "role": "tool",
                        "tool_call_id": item["id"],
                        "content": [
                            {"type": "output_text", "text": json.dumps(item["result"])}
                        ],
                    }
                    for item in results
                ]
            except Exception:
                logger.exception("Tool execution failed")
                return schemas.ChatResponse(
                    assistant_text=(
                        "I ran into an error while trying to perform that action. "
                        "Please try again or adjust your request."
                    ),
                    actions=[],
                    conversation_id=response.id,
                )

            response = responses.create(
                model=DEFAULT_MODEL,
                temperature=DEFAULT_TEMPERATURE,
                input=tool_outputs,
                tools=tools,
                previous_response_id=response.id,
            )

        assistant_text = _strip_structured_payload(_extract_assistant_text(response))
        return schemas.ChatResponse(
            assistant_text=assistant_text,
            actions=actions,
            conversation_id=response.id,
        )

    conversation_id, history = _get_conversation(conversation_id)
    if not history:
        history.append({"role": "system", "content": SYSTEM_PROMPT})

    history.append({"role": "user", "content": user_text})

    assistant_text = ""
    for _ in range(3):
        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            temperature=DEFAULT_TEMPERATURE,
            messages=history,
            tools=tools,
        )

        message = response.choices[0].message
        assistant_text = _strip_structured_payload(message.content or "")
        history.append(message.model_dump())
        _trim_history(history)

        tool_calls = message.tool_calls or []
        if not tool_calls:
            break

        normalized_calls = []
        for call in tool_calls:
            arguments = call.function.arguments
            parsed_args = json.loads(arguments) if arguments else {}
            normalized_calls.append(
                {"id": call.id, "name": call.function.name, "arguments": parsed_args}
            )

        try:
            new_actions, results = _execute_tool_calls(normalized_calls, db)
            actions.extend(new_actions)
            for item in results:
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": item["id"],
                        "content": json.dumps(item["result"]),
                    }
                )
                _trim_history(history)
        except Exception:
            logger.exception("Tool execution failed")
            return schemas.ChatResponse(
                assistant_text=(
                    "I ran into an error while trying to perform that action. "
                    "Please try again or adjust your request."
                ),
                actions=[],
                conversation_id=conversation_id,
            )

    return schemas.ChatResponse(
        assistant_text=assistant_text,
        actions=actions,
        conversation_id=conversation_id,
    )
