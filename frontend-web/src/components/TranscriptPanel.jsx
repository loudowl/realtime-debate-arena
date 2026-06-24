import { useEffect, useRef } from 'react';

export default function TranscriptPanel({ segments, names = {}, source, platform, status }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [segments.length]);

  return (
    <div className="card transcript">
      <div className="card-head">
        <h2>Live transcript</h2>
        {platform && <span className="tag">{platform}</span>}
      </div>
      {source && <a className="source-link" href={source} target="_blank" rel="noreferrer">{source}</a>}

      <div className="transcript-body">
        {segments.length === 0 && (
          <p className="muted">
            {status === 'live' ? 'Waiting for the first transcript segment…' : 'No transcript yet.'}
          </p>
        )}
        {segments.map((s) => {
          const name = names[s.speaker];
          return (
            <div className="seg" key={s.id || `${s.startTs}-${s.text.slice(0, 12)}`}>
              <div className="seg-meta">
                <span className={`seg-speaker speaker-${slug(s.speaker)}`}>
                  {name || s.speaker}
                  {name && <span className="seg-label">{s.speaker}</span>}
                </span>
                <span className="seg-time">{fmtTime(s.startTs)}</span>
              </div>
              <p className="seg-text">{s.text}</p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function slug(name) {
  return String(name || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function fmtTime(ts) {
  if (typeof ts !== 'number') return '';
  const m = Math.floor(ts / 60);
  const s = Math.floor(ts % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
