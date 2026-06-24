const { WebSocketServer } = require('ws');
const store = require('../services/sessionStore');

const LIVE_PATH = /^\/api\/streams\/([^/]+)\/live$/;

/**
 * Attach the Observer Mode live WebSocket to an existing HTTP server.
 *
 * Clients connect to /api/streams/:id/live and receive a replay of any
 * existing state followed by live { type, data } events from the session bus.
 */
function attachLiveTranscript(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const match = pathname.match(LIVE_PATH);
    if (!match) {
      socket.destroy();
      return;
    }
    const sessionId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, sessionId);
    });
  });

  wss.on('connection', (ws, req, sessionId) => {
    const session = store.getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Session not found.' } }));
      ws.close();
      return;
    }

    const send = (event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };

    // Replay current state so a late subscriber is caught up.
    send({ type: 'session', data: session });
    store.getSegments(sessionId).forEach((segment) => {
      send({ type: 'transcript', data: segment });
    });
    // Replay model-tagged events (fact_check / commentary / score_update / report).
    store.getModelEvents(sessionId).forEach((event) => send(event));

    const unsubscribe = store.subscribe(sessionId, send);
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });

  return wss;
}

module.exports = { attachLiveTranscript };
