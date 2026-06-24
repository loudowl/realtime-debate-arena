import { useEffect, useMemo, useState } from 'react';
import { fetchModels, createSession, stopSession } from './api.js';
import { useLiveSession } from './useLiveSession.js';
import SetupForm from './components/SetupForm.jsx';
import StreamPlayer from './components/StreamPlayer.jsx';
import TranscriptPanel from './components/TranscriptPanel.jsx';
import ModeratorColumn from './components/ModeratorColumn.jsx';
import ComparisonSummary from './components/ComparisonSummary.jsx';

export default function App() {
  const [models, setModels] = useState([]);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchModels().then(setModels).catch((e) => setError(e.message));
  }, []);

  const live = useLiveSession(session?.id || null);
  const status = live.session?.status || session?.status;
  const activeModels = session?.models || [];

  async function handleStart(config) {
    setError(null);
    setStarting(true);
    try {
      const created = await createSession(config);
      setSession(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!session) return;
    try {
      await stopSession(session.id);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleReset() {
    setSession(null);
    setError(null);
  }

  const modelLabel = useMemo(() => {
    const map = {};
    models.forEach((m) => { map[m.id] = m.label; });
    return map;
  }, [models]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⚖︎</span>
          <div>
            <h1>Debate Arena · Observer Mode</h1>
            <p>Run AI moderators in parallel on a live debate and compare their biases.</p>
          </div>
        </div>
        {session && (
          <div className="session-controls">
            <StatusPill status={status} connected={live.connected} />
            {status === 'live' && (
              <button className="btn btn-ghost" onClick={handleStop}>Stop</button>
            )}
            <button className="btn btn-ghost" onClick={handleReset}>New session</button>
          </div>
        )}
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      {status === 'failed' && (live.session?.error || session?.error) && (
        <div className="banner banner-error">
          <strong>Session failed.</strong> {live.session?.error || session?.error}
        </div>
      )}

      {session && (live.session?.mode || session.mode) === 'simulation' && (
        <div className="banner banner-warn">
          <strong>Simulation mode.</strong> The backend is analyzing a built-in sample debate, not the
          audio from your URL. Names and transcript here come from that sample — not from the linked video.
          To analyze a real video, run the backend with <code>OBSERVER_SIMULATION=false</code> plus
          <code> ffmpeg</code>, <code>yt-dlp</code>, and an <code>OPENAI_API_KEY</code>.
        </div>
      )}

      {!session ? (
        <SetupForm models={models} starting={starting} onStart={handleStart} />
      ) : (
        <main className="live">
          <section className="transcript-col">
            <StreamPlayer
              source={live.session?.sourceUrl || session.sourceUrl}
              platform={live.session?.platform || session.platform}
            />
            <TranscriptPanel
              segments={live.segments}
              names={live.identities}
              source={live.session?.sourceUrl || session.sourceUrl}
              platform={live.session?.platform || session.platform}
              status={status}
            />
          </section>
          <section className="moderators">
            {activeModels.length > 1 && (
              <ComparisonSummary
                models={activeModels}
                modelState={live.models}
                modelLabel={modelLabel}
                names={live.identities}
              />
            )}
            <div className="moderator-grid" style={{ '--cols': Math.min(activeModels.length, 4) }}>
              {activeModels.map((id) => (
                <ModeratorColumn
                  key={id}
                  modelId={id}
                  label={modelLabel[id] || id}
                  state={live.models[id]}
                  session={live.session || session}
                  names={live.identities}
                  status={status}
                />
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function StatusPill({ status, connected }) {
  const label = status || (connected ? 'connecting' : 'idle');
  return <span className={`pill pill-${label}`}>{connected ? '● ' : '○ '}{label}</span>;
}
