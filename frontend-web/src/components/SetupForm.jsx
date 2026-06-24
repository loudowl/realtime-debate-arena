import { useState } from 'react';

const SAMPLE_URL = 'https://www.youtube.com/watch?v=your-debate';

/**
 * Simple mode: pick a livestream URL, choose which moderator models to run in
 * parallel, and whether they should declare a winner.
 */
export default function SetupForm({ models, starting, onStart }) {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState({});
  const [declareWinner, setDeclareWinner] = useState(true);
  const [identify, setIdentify] = useState('auto');

  // Default-select all models once the catalogue loads.
  const allIds = models.map((m) => m.id);
  const chosen = allIds.filter((id) => selected[id] !== false);

  function toggle(id) {
    setSelected((s) => ({ ...s, [id]: s[id] === false ? true : false }));
  }

  function submit(e) {
    e.preventDefault();
    if (!url.trim() || !chosen.length) return;
    onStart({ url: url.trim(), models: chosen, declareWinner, identify });
  }

  return (
    <form className="setup card" onSubmit={submit}>
      <h2>Start an analysis</h2>
      <p className="muted">
        Point the moderators at a debate livestream (YouTube, Twitch, or any HLS URL).
        With no API keys configured the backend runs a built-in simulated debate so you
        can see the full pipeline immediately.
      </p>

      <label className="field">
        <span>Debate livestream URL</span>
        <input
          type="url"
          placeholder={SAMPLE_URL}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="button" className="link" onClick={() => setUrl(SAMPLE_URL)}>
          use sample URL
        </button>
      </label>

      <div className="field">
        <span>Moderator models (run in parallel)</span>
        <div className="model-picker">
          {models.map((m) => {
            const on = selected[m.id] !== false;
            return (
              <button
                type="button"
                key={m.id}
                className={`model-chip ${on ? 'on' : ''}`}
                onClick={() => toggle(m.id)}
                title={m.persona}
              >
                <span className="model-chip-dot" data-model={m.id} />
                <span className="model-chip-label">{m.label}</span>
                <span className="model-chip-key">{m.hasKey ? 'live key' : 'simulated'}</span>
              </button>
            );
          })}
          {!models.length && <span className="muted">Loading models…</span>}
        </div>
      </div>

      <div className="field">
        <span>Participant identification</span>
        <div className="radio-group">
          <label className={`radio-card ${identify === 'auto' ? 'on' : ''}`}>
            <input type="radio" name="identify" value="auto" checked={identify === 'auto'} onChange={() => setIdentify('auto')} />
            <span className="radio-title">Name when confident</span>
            <span className="radio-desc">Use a real name only with strong evidence (self-introduction or repeated address); otherwise show a role/description.</span>
          </label>
          <label className={`radio-card ${identify === 'descriptor' ? 'on' : ''}`}>
            <input type="radio" name="identify" value="descriptor" checked={identify === 'descriptor'} onChange={() => setIdentify('descriptor')} />
            <span className="radio-title">Describe roles only</span>
            <span className="radio-desc">Never guess a name. Label speakers as Moderator, Proponent/Opponent, or by a spoken title.</span>
          </label>
        </div>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={declareWinner}
          onChange={(e) => setDeclareWinner(e.target.checked)}
        />
        <span>Let each moderator declare a winner</span>
      </label>

      <button className="btn btn-primary" type="submit" disabled={starting || !chosen.length}>
        {starting ? 'Starting…' : `Run ${chosen.length} moderator${chosen.length === 1 ? '' : 's'}`}
      </button>
    </form>
  );
}
