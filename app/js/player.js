// Unsichtbarer YouTube-IFrame-Player (Prinzip wie im SongSeeker)

// Wartezeit je Versuch: normale Videos starten in unter 3 s, danach neu laden, nach 12 s Hinweis
const RETRY_STEPS_MS = [3000, 4000, 5000];
let retries = 0;
let player = null;
let ready = false;
let handlers = {};
let current = null; // { videoId, start }
let pending = null; // Laden, bevor der Player bereit war
let timer = null;
let userRequested = false;

export const State = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export function initPlayer(h) {
  handlers = h;
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt-player', {
      height: '1',
      width: '1',
      playerVars: { controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1 },
      events: {
        onReady: (e) => {
          ready = true;
          e.target.setVolume(100);
          e.target.unMute();
          if (pending) { const p = pending; pending = null; load(p.videoId, p.start, p.autoplay); }
          handlers.onReady && handlers.onReady();
        },
        onStateChange: (e) => {
          if (e.data === State.PLAYING) clearTimer();
          handlers.onState && handlers.onState(e.data);
        },
        onError: (e) => {
          clearTimer();
          handlers.onError && handlers.onError(e.data, current);
        },
      },
    });
  };
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = () => handlers.onApiFail && handlers.onApiFail();
  document.head.appendChild(tag);
}

function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

function armTimer(resetRetries = true) {
  clearTimer();
  if (resetRetries) retries = 0;
  timer = setTimeout(() => {
    timer = null;
    // Im Hintergrund lädt der Browser oft nicht weiter, das ist kein Fehler
    if (document.hidden) { armTimer(false); return; }
    const st = state();
    if (st === State.PLAYING || st === State.PAUSED || st === State.ENDED) return;
    // Nicht gestartet: Autoplay blockiert oder Werbung. Neu laden würde nur die nächste Werbung holen.
    if (st !== State.BUFFERING) { handlers.onBlocked && handlers.onBlocked(current); return; }
    // YouTube bleibt beim ersten Laden manchmal dauerhaft hängen, erneutes Laden löst das oft
    if (retries < RETRY_STEPS_MS.length - 1) {
      retries += 1;
      handlers.onRetry && handlers.onRetry(retries + 1);
      const at = Math.max(current.start, (player.getCurrentTime && player.getCurrentTime()) || 0);
      player.loadVideoById({ videoId: current.videoId, startSeconds: at });
      armTimer(false);
      return;
    }
    handlers.onStalled && handlers.onStalled(st, current);
  }, RETRY_STEPS_MS[retries]);
}

export const isReady = () => ready;
export const state = () => (player && player.getPlayerState ? player.getPlayerState() : State.UNSTARTED);
export const isPlaying = () => state() === State.PLAYING || state() === State.BUFFERING;

/** Lädt ein Video; autoplay nur, wenn der Nutzer bereits mit der Seite interagiert hat. */
export function load(videoId, start = 0, autoplay = true) {
  current = { videoId, start };
  userRequested = false;
  if (!ready) { pending = { videoId, start, autoplay }; return; }
  if (autoplay) {
    player.loadVideoById({ videoId, startSeconds: start });
    armTimer();
  } else {
    player.cueVideoById({ videoId, startSeconds: start });
  }
}

export function toggle() {
  if (!ready || !current) return false;
  if (isPlaying()) { player.pauseVideo(); return true; }
  userRequested = true;
  const st = state();
  if (st === State.ENDED) player.seekTo(current.start, true);
  else if (st === State.CUED) player.loadVideoById({ videoId: current.videoId, startSeconds: current.start });
  player.playVideo();
  armTimer();
  return true;
}

export function pause() {
  clearTimer();
  if (ready && player.pauseVideo) player.pauseVideo();
}

export function restart() {
  if (!ready || !current) return false;
  userRequested = true;
  player.seekTo(current.start, true);
  player.playVideo();
  armTimer();
  return true;
}

export function stop() {
  clearTimer();
  pending = null;
  if (ready && player.stopVideo) player.stopVideo();
}

export const currentVideo = () => current;

export const position = () => (ready && player.getCurrentTime ? player.getCurrentTime() || 0 : 0);
export const duration = () => (ready && player.getDuration ? player.getDuration() || 0 : 0);

export function seek(sec) {
  if (ready && player.seekTo) player.seekTo(sec, true);
}
