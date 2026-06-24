import { useEffect, useReducer, useRef } from 'react';
import { liveSocketUrl } from './api.js';

const emptyModel = () => ({ factChecks: [], commentary: [], scores: null, report: null });

const initialState = {
  connected: false,
  session: null,
  segments: [],
  models: {}, // modelId -> { factChecks, commentary, scores, report }
  identities: {}, // speakerLabel -> resolved name
};

function ensureModel(models, id) {
  return models[id] ? models : { ...models, [id]: emptyModel() };
}

function reducer(state, event) {
  switch (event.type) {
    case '_open':
      return { ...state, connected: true };
    case '_close':
      return { ...state, connected: false };
    case 'session':
      return { ...state, session: event.data };
    case 'transcript':
      return { ...state, segments: [...state.segments, event.data] };
    case 'fact_check': {
      const id = event.data.model;
      const models = ensureModel(state.models, id);
      return {
        ...state,
        models: {
          ...models,
          [id]: { ...models[id], factChecks: [...models[id].factChecks, event.data] },
        },
      };
    }
    case 'commentary': {
      const id = event.data.model;
      const models = ensureModel(state.models, id);
      return {
        ...state,
        models: {
          ...models,
          [id]: { ...models[id], commentary: [...models[id].commentary, event.data] },
        },
      };
    }
    case 'score_update': {
      const id = event.data.model;
      const models = ensureModel(state.models, id);
      return {
        ...state,
        models: { ...models, [id]: { ...models[id], scores: event.data.scores } },
      };
    }
    case 'report': {
      const id = event.data.model;
      const models = ensureModel(state.models, id);
      return {
        ...state,
        models: { ...models, [id]: { ...models[id], report: event.data } },
      };
    }
    case 'identity':
      return {
        ...state,
        identities: {
          ...state.identities,
          [event.data.label]: event.data.display || event.data.name,
        },
      };
    default:
      return state;
  }
}

/**
 * Subscribe to a session's live event stream. Pass null to stay idle.
 * The backend replays existing state on connect, so this also works for a
 * session that is already in progress or finished.
 */
export function useLiveSession(sessionId) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    const ws = new WebSocket(liveSocketUrl(sessionId));
    wsRef.current = ws;
    ws.onopen = () => dispatch({ type: '_open' });
    ws.onclose = () => dispatch({ type: '_close' });
    ws.onmessage = (msg) => {
      try {
        dispatch(JSON.parse(msg.data));
      } catch (_) {
        /* ignore malformed frames */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  return state;
}
