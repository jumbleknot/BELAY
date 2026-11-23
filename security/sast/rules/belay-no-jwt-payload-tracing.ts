// Test fixture for belay-no-jwt-payload-tracing (TS surface, semgrep --test). Intentionally-insecure
// sample — excluded from the product scan via .semgrepignore. Do not import.

import { logger } from './logger';
import { jwtDecode } from 'jwt-decode';

function handler(token: string) {
  const jwtPayload = jwtDecode(token);
  // ruleid: belay-no-jwt-payload-tracing
  logger.info('decoded token', jwtPayload);
  // ruleid: belay-no-jwt-payload-tracing
  logger.debug('raw decode', jwtDecode(token));

  // ok: belay-no-jwt-payload-tracing
  logger.info('token subject', { userId: jwtPayload.sub });
}
