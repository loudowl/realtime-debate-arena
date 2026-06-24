/**
 * Embed the source livestream so it can be watched while the moderators analyze.
 * Supports YouTube, Twitch, and direct/HLS media URLs; otherwise falls back to
 * an external link.
 */
export default function StreamPlayer({ source, platform }) {
  if (!source) return null;
  const embed = resolveEmbed(source, platform);

  return (
    <div className="card player">
      <div className="card-head">
        <h2>Live stream</h2>
        {platform && <span className="tag">{platform}</span>}
      </div>

      {embed.kind === 'iframe' && (
        <div className="player-frame">
          <iframe
            src={embed.url}
            title="Debate livestream"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {embed.kind === 'video' && (
        <div className="player-frame">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={embed.url} controls autoPlay muted playsInline />
        </div>
      )}

      {embed.kind === 'link' && (
        <div className="player-fallback">
          <p className="muted small">This source can’t be embedded directly.</p>
          <a className="btn btn-ghost btn-sm" href={source} target="_blank" rel="noreferrer">
            Open stream in a new tab ↗
          </a>
        </div>
      )}
    </div>
  );
}

function resolveEmbed(source, platform) {
  try {
    const url = new URL(source);
    const host = url.hostname.replace(/^www\./, '');

    // YouTube
    if (/youtu\.?be/.test(host) || platform === 'youtube') {
      const id = youtubeId(url);
      if (id) {
        return {
          kind: 'iframe',
          url: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0`,
        };
      }
    }

    // Twitch (channel or VOD)
    if (/twitch\.tv/.test(host) || platform === 'twitch') {
      const parent = window.location.hostname;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'videos' && parts[1]) {
        return { kind: 'iframe', url: `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=true&muted=true` };
      }
      if (parts[0]) {
        return { kind: 'iframe', url: `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=true&muted=true` };
      }
    }

    // Direct media / HLS
    if (/\.(m3u8|mp4|webm|ogg)($|\?)/i.test(url.pathname + url.search) || platform === 'hls') {
      return { kind: 'video', url: source };
    }
  } catch (_) {
    /* fall through to link */
  }
  return { kind: 'link' };
}

function youtubeId(url) {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return url.pathname.slice(1) || null;
  if (url.searchParams.get('v')) return url.searchParams.get('v');
  const m = url.pathname.match(/\/(?:live|embed|shorts)\/([^/?]+)/);
  return m ? m[1] : null;
}
