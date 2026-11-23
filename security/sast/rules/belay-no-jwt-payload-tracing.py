# Test fixture for belay-no-jwt-payload-tracing (Python surface, semgrep --test).
# Intentionally-insecure sample — excluded from the product scan via .semgrepignore. Do not import.

import logging
import jwt

logger = logging.getLogger(__name__)


def handler(token):
    payload = jwt.decode(token, options={"verify_signature": False})
    # ruleid: belay-no-jwt-payload-tracing
    logger.info("decoded token", payload)
    # ruleid: belay-no-jwt-payload-tracing
    logger.debug("raw decode", jwt.decode(token, options={"verify_signature": False}))

    # ok: belay-no-jwt-payload-tracing
    logger.info("token subject", extra={"user_id": payload["sub"]})
