// Test fixture for belay-no-token-logging (semgrep --test). Intentionally-insecure sample —
// excluded from the product scan via .semgrepignore. Do not import.

import { logger } from './logger';

function handler(user: any, session: any) {
  // ruleid: belay-no-token-logging
  logger.info('login', { accessToken: user.accessToken });
  // ruleid: belay-no-token-logging
  logger.error('auth failure', user.email);
  // ruleid: belay-no-token-logging
  console.log('session', { sessionId: session.id, note: 'x' });
  // ruleid: belay-no-token-logging
  logger.debug('token', user.refreshToken);

  // ok: belay-no-token-logging
  logger.info('login', { userId: user.id });
  // ok: belay-no-token-logging
  logger.info('session started', { requestId: session.requestId });
}
