"""
Anthropic-to-OpenAI Proxy Server

A TCP/HTTP proxy server that transforms Anthropic API calls to OpenAI format and back,
using LiteLLM as the underlying proxy engine. This server allows Anthropic-compatible
clients to interface with OpenAI-compatible endpoints and vice versa.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Union

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from litellm import acompletion
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# Configure logging (testing defaults)
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Anthropic-to-OpenAI Proxy Server",
    description="A proxy server that transforms Anthropic API calls to OpenAI format and back",
    version="1.0.0",
)

# Plugin defaults from src/config/constants.ts
PLUGIN_DEFAULT_MODELS = [
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
]

# LMStudio / OpenAI-compatible backend settings (aligned with .env.example)
DEFAULT_LMSTUDIO_BASE = "http://localhost:1234"
DEFAULT_LMSTUDIO_MODEL = "google/gemma-3-4b"
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", DEFAULT_LMSTUDIO_BASE)
LMSTUDIO_API_KEY = os.getenv("LMSTUDIO_API_KEY", "")
LMSTUDIO_MODEL = os.getenv("LMSTUDIO_MODEL", DEFAULT_LMSTUDIO_MODEL)

MODEL_MAPPING = {
    "claude-3-opus-20240229": LMSTUDIO_MODEL,
    "claude-3-sonnet-20240229": LMSTUDIO_MODEL,
    "claude-3-haiku-20240307": LMSTUDIO_MODEL,
    **{model_name: LMSTUDIO_MODEL for model_name in PLUGIN_DEFAULT_MODELS},
}

# Reverse mapping for response transformation
REVERSE_MODEL_MAPPING = {v: k for k, v in MODEL_MAPPING.items()}


def normalize_openai_base(url: str) -> str:
    base = url.rstrip("/")
    # Check if the URL already contains a specific API endpoint like /chat/completions
    # or already ends with /v1, return as is
    if "/v1/" in base or base.endswith("/v1"):
        return base
    # Otherwise, append /v1 for the standard OpenAI API endpoint
    return f"{base}/v1"


def ensure_openai_model(model_name: str) -> str:
    if model_name.startswith("openai/"):
        return model_name
    return f"openai/{model_name}"


class AnthropicMessage(BaseModel):
    role: str
    content: Union[str, list]


class AnthropicRequest(BaseModel):
    model: str
    messages: list[AnthropicMessage]
    max_tokens: int = Field(default=1024, ge=1)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    top_k: Optional[int] = None
    stop_sequences: Optional[list[str]] = None
    stream: bool = False
    system: Optional[Union[str, list]] = None
    metadata: Optional[Dict[str, Any]] = None


def extract_text_blocks(content: Union[str, list, Dict[str, Any], None]) -> str:
    if not content:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "".join(parts)
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        return content["text"]
    return ""


def anthropic_to_openai_format(anthropic_request: AnthropicRequest) -> Dict[str, Any]:
    """
    Convert Anthropic API request format to OpenAI format
    """
    # Map the model
    default_model = LMSTUDIO_MODEL or os.getenv("DEFAULT_OPENAI_MODEL", "gpt-4")
    openai_model = MODEL_MAPPING.get(anthropic_request.model, default_model)
    openai_model = ensure_openai_model(openai_model)

    # Prepare messages - Anthropic uses user/assistant roles, OpenAI uses user/assistant/system
    openai_messages = []

    # Add system message if present in anthropic request
    system_text = extract_text_blocks(anthropic_request.system)
    if system_text:
        openai_messages.append({"role": "system", "content": system_text})

    # Convert each message
    for msg in anthropic_request.messages:
        content = extract_text_blocks(msg.content)

        openai_messages.append({"role": msg.role, "content": content})

    # Prepare OpenAI request
    openai_request = {
        "model": openai_model,
        "messages": openai_messages,
        "temperature": anthropic_request.temperature,
        "top_p": anthropic_request.top_p,
        "max_tokens": anthropic_request.max_tokens,
    }

    # Remove None values
    openai_request = {k: v for k, v in openai_request.items() if v is not None}

    return openai_request


def openai_to_anthropic_format(
    openai_response: Dict[str, Any], original_model: str
) -> Dict[str, Any]:
    """
    Convert OpenAI API response format back to Anthropic format
    """
    # Map the model back
    anthropic_model = REVERSE_MODEL_MAPPING.get(
        openai_response.get("model", ""), original_model
    )

    # Extract choices from OpenAI response
    choices = openai_response.get("choices", [])

    if not choices:
        # Handle case where there are no choices
        return {
            "id": openai_response.get("id", ""),
            "model": anthropic_model,
            "created": openai_response.get("created", 0),
            "usage": openai_response.get("usage", {}),
            "content": [{"type": "text", "text": ""}],
            "role": "assistant",
        }

    # Get the first choice
    choice = choices[0]
    message = choice.get("message", {})

    # Create Anthropic response
    anthropic_response = {
        "id": openai_response.get("id", ""),
        "model": anthropic_model,
        "created": openai_response.get("created", 0),
        "content": [{"type": "text", "text": message.get("content", "")}],
        "role": message.get("role", "assistant"),
        "stop_reason": choice.get("finish_reason", "stop"),
        "stop_sequence": None,
        "usage": openai_response.get("usage", {}),
    }

    return anthropic_response


def dump_openai_response(response: Any) -> Dict[str, Any]:
    if hasattr(response, "model_dump"):
        return response.model_dump()
    if hasattr(response, "dict"):
        return response.dict()
    return response


def openai_stream_to_anthropic_chunks(openai_chunks, original_model: str):
    """
    Convert OpenAI streaming chunks to Anthropic format
    """
    for chunk in openai_chunks:
        if not chunk.choices:
            continue

        choice = chunk.choices[0]

        # Create Anthropic-style chunk
        if choice.delta and hasattr(choice.delta, "content") and choice.delta.content:
            payload = {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": choice.delta.content},
            }
            yield f"data: {json.dumps(payload)}\n\n"
        elif choice.finish_reason:
            payload = {
                "type": "message_delta",
                "delta": {
                    "stop_reason": choice.finish_reason,
                    "stop_sequence": None,
                },
            }
            yield f"data: {json.dumps(payload)}\n\n"
            # Send the final message
            yield f"data: {json.dumps({'type': 'message_stop'})}\n\n"


@app.post("/v1/messages")
async def proxy_anthropic_request(request: Request):
    """
    Proxy Anthropic API requests to OpenAI-compatible endpoints
    """
    try:
        # Get the raw request body
        body = await request.json()

        # Validate the request using Pydantic
        anthropic_req = AnthropicRequest(**body)

        # Convert to OpenAI format
        openai_request = anthropic_to_openai_format(anthropic_req)

        logger.info(f"Converted Anthropic request to OpenAI format: {openai_request}")

        openai_base = normalize_openai_base(LMSTUDIO_BASE_URL)
        logger.info(f"Using OpenAI base URL: {openai_base}")

        llm_kwargs = {"api_base": openai_base}
        if LMSTUDIO_API_KEY:
            llm_kwargs["api_key"] = LMSTUDIO_API_KEY

        if anthropic_req.stream:
            # Handle streaming response
            async def generate():
                try:
                    logger.info(f"Making streaming request to backend with kwargs: {llm_kwargs}")
                    response = await acompletion(
                        model=openai_request["model"],
                        messages=openai_request["messages"],
                        temperature=openai_request.get("temperature"),
                        max_tokens=openai_request.get("max_tokens"),
                        stream=True,
                        **llm_kwargs,
                    )

                    # Convert streaming response to Anthropic format
                    async for chunk in response:
                        if chunk.choices and chunk.choices[0].delta.content:
                            # Yield in Server-Sent Events format
                            content_chunk = {
                                "type": "content_block_delta",
                                "index": 0,
                                "delta": {
                                    "type": "text_delta",
                                    "text": chunk.choices[0].delta.content,
                                },
                            }
                            yield f"data: {json.dumps(content_chunk)}\n\n"

                        if chunk.choices and chunk.choices[0].finish_reason:
                            # Send the final delta
                            final_chunk = {
                                "type": "message_delta",
                                "delta": {
                                    "stop_reason": chunk.choices[0].finish_reason,
                                    "stop_sequence": None,
                                },
                            }
                            yield f"data: {json.dumps(final_chunk)}\n\n"

                            # Send the stop message
                            stop_chunk = {"type": "message_stop"}
                            yield f"data: {json.dumps(stop_chunk)}\n\n"

                except Exception as e:
                    logger.error(f"Error in streaming response: {str(e)}")
                    error_chunk = {
                        "type": "error",
                        "error": {"type": "api_error", "message": str(e)},
                    }
                    yield f"data: {json.dumps(error_chunk)}\n\n"

            return StreamingResponse(generate(), media_type="text/event-stream")
        else:
            # Handle non-streaming response
            logger.info(f"Making non-streaming request to backend with kwargs: {llm_kwargs}")
            response = await acompletion(
                model=openai_request["model"],
                messages=openai_request["messages"],
                temperature=openai_request.get("temperature"),
                max_tokens=openai_request.get("max_tokens"),
                **llm_kwargs,
            )

            # Convert response back to Anthropic format
            anthropic_response = openai_to_anthropic_format(
                dump_openai_response(response), anthropic_req.model
            )

            logger.info(
                f"Converted OpenAI response to Anthropic format: {anthropic_response}"
            )

            return anthropic_response

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        logger.error(f"LMSTUDIO_BASE_URL was: {LMSTUDIO_BASE_URL}")
        logger.error(f"Normalized base URL was: {normalize_openai_base(LMSTUDIO_BASE_URL)}")
        raise HTTPException(status_code=500, detail=f"Proxy error: {str(e)}. Check that your backend service is running at {normalize_openai_base(LMSTUDIO_BASE_URL)}")


@app.get("/")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "anthropic-openai-proxy"}

@app.post("/api/event_logging/batch")
async def event_logging_batch():
    """Dummy endpoint for event logging (no-op)"""
    return {"status": "ok"}

@app.get("/v1/models")
async def list_models():
    """Return available models (mapped from OpenAI models)"""
    # This could be enhanced to fetch actual models from the backend
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": 1677610602,
                "owned_by": "user",
            }
            for model_id in MODEL_MAPPING.keys()
        ],
    }


def main():
    """Run the proxy server"""
    host = os.getenv("PROXY_HOST", "0.0.0.0")
    port = int(os.getenv("PROXY_PORT", "3456"))
    reload_enabled = os.getenv("PROXY_RELOAD", "1") == "1"

    # Log configuration info at startup
    logger.info(f"LMSTUDIO_BASE_URL configured as: {LMSTUDIO_BASE_URL}")
    logger.info(f"Normalized OpenAI base URL: {normalize_openai_base(LMSTUDIO_BASE_URL)}")
    logger.info(f"LMSTUDIO_MODEL configured as: {LMSTUDIO_MODEL}")

    logger.info(f"Starting Anthropic-to-OpenAI Proxy Server on {host}:{port}")
    uvicorn.run(
        app="main:app",
        host=host,
        port=port,
        reload=reload_enabled,
        reload_dirs=[str(Path(__file__).resolve().parent)],
        log_level="debug",
        access_log=True,
    )


if __name__ == "__main__":
    main()
