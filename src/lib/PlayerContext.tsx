import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode, Dispatch, SetStateAction } from 'react';
import { api } from './api';
import type { Track } from '../types';

// Monotonic token for the audio element. Each applyTrackToAudio stamps the
// element with the current token; stale loadedmetadata listeners (added when a
// previous track's metadata hadn't loaded yet) check the token and bail, so a
// slow load can never seek/play the wrong track.
let audioLoadToken = 0;

interface PlayerContextValue {
  queue: Track[];
  current: Track | null;
  isPlaying: boolean;
  direction: 1 | -1;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  audioElement: HTMLAudioElement | null;
  notice: { id: number; message: string; variant: 'default' | 'success' } | null;
  showNotice: (message: string, variant?: 'default' | 'success') => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  playTrackAt: (track: Track, time: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

type Notice = { id: number; message: string; variant: 'default' | 'success' };
type RepeatMode = 'off' | 'all' | 'one';

const isPlayable = (track: Track) => track.status !== 'suspended';

// ---------------------------------------------------------------------------
// Pure queue decision logic (no side effects)
// ---------------------------------------------------------------------------

type MoveDecision =
  | { kind: 'empty' }
  | { kind: 'unplayable' }
  | { kind: 'replay' }
  | { kind: 'end' }
  | { kind: 'play'; track: Track };

// Where the queue should go next given the current track and playback settings.
function decideNextTrack(
  q: Track[],
  cur: Track,
  offset: 1 | -1,
  shuffle: boolean,
  repeat: RepeatMode,
): MoveDecision {
  const playable = q.filter((t) => t.status !== 'suspended');
  if (playable.length === 0) return { kind: 'empty' };

  if (shuffle) {
    let pick = playable[Math.floor(Math.random() * playable.length)];
    if (playable.length > 1 && pick.id === cur.id) {
      const others = playable.filter((t) => t.id !== cur.id);
      pick = others[Math.floor(Math.random() * others.length)];
    }
    return { kind: 'play', track: pick };
  }

  if (playable.length <= 1) {
    return isPlayable(cur) ? { kind: 'replay' } : { kind: 'unplayable' };
  }

  const idx = q.findIndex((t) => t.id === cur.id);
  let nextIdx = (idx + offset + q.length) % q.length;
  let guard = 0;
  while (q[nextIdx]?.status === 'suspended' && guard < q.length) {
    nextIdx = (nextIdx + offset + q.length) % q.length;
    guard++;
  }
  const nextTrack = q[nextIdx];
  if (!nextTrack || nextTrack.status === 'suspended') return { kind: 'unplayable' };
  if (repeat === 'off' && offset === 1 && nextIdx <= idx) return { kind: 'end' };
  if (repeat === 'off' && offset === -1 && nextIdx >= idx) return { kind: 'replay' };
  return { kind: 'play', track: nextTrack };
}

// ---------------------------------------------------------------------------
// Audio element helpers
// ---------------------------------------------------------------------------

// Loads a track into the audio element. seekTo > 0 seeks to that position once
// metadata is ready; autoplay=false only loads (does not start playback).
function applyTrackToAudio(
  audio: HTMLAudioElement,
  track: Track,
  seekTo: number,
  autoplay: boolean,
  onPlayFail: () => void,
): void {
  const token = ++audioLoadToken;
  audio.dataset.loadToken = String(token);
  audio.src = track.audioUrl;
  audio.load();
  if (!autoplay) return;
  const playGuarded = () => {
    audio.play().catch(() => {
      if (audio.paused) onPlayFail();
    });
  };
  if (seekTo > 0) {
    const apply = () => {
      if (audio.dataset.loadToken !== String(token)) return;
      audio.currentTime = Math.min(Math.max(seekTo, 0), audio.duration || track.duration || 0);
      playGuarded();
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
  } else {
    playGuarded();
  }
}

function useAudio(current: Track | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioElement, setAudioElementState] = useState<HTMLAudioElement | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const setAudioElement = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    if (audioElementRef.current !== el) {
      audioElementRef.current = el;
      setAudioElementState(el);
    }
  }, []);

  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // keep volume in sync with audio element (the Web Audio graph taps the
  // element's output, so the element volume is the single source of truth)
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted, current]);

  return { audioRef, audioElement, setAudioElement, volume, setVolume, muted, toggleMute };
}

// ---------------------------------------------------------------------------
// Playback state (values + mirrored refs for stable callbacks)
// ---------------------------------------------------------------------------

function usePlaybackState() {
  const [queue, setQueue] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  const queueRef = useRef<Track[]>([]);
  const currentRef = useRef<Track | null>(null);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  return {
    queue,
    setQueue,
    current,
    setCurrent,
    isPlaying,
    setIsPlaying,
    direction,
    setDirection,
    progress,
    setProgress,
    duration,
    setDuration,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    shuffleRef,
    repeatRef,
    queueRef,
    currentRef,
  };
}

// ---------------------------------------------------------------------------
// Playback actions
// ---------------------------------------------------------------------------

interface ActionsDeps {
  audioRef: { current: HTMLAudioElement | null };
  current: Track | null;
  currentRef: { current: Track | null };
  queueRef: { current: Track[] };
  shuffleRef: { current: boolean };
  repeatRef: { current: RepeatMode };
  setCurrent: Dispatch<SetStateAction<Track | null>>;
  setQueue: Dispatch<SetStateAction<Track[]>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setDirection: Dispatch<SetStateAction<1 | -1>>;
  setShuffle: Dispatch<SetStateAction<boolean>>;
  setRepeat: Dispatch<SetStateAction<RepeatMode>>;
  showNotice: (message: string, variant?: 'default' | 'success') => void;
}

function usePlayerActions(deps: ActionsDeps) {
  const {
    audioRef,
    current,
    currentRef,
    queueRef,
    shuffleRef,
    repeatRef,
    setCurrent,
    setQueue,
    setProgress,
    setDuration,
    setIsPlaying,
    setDirection,
    setShuffle,
    setRepeat,
    showNotice,
  } = deps;

  const attachTrack = useCallback(
    (track: Track, seekTo: number, autoplay: boolean) => {
      setCurrent(track);
      setProgress(Math.max(0, seekTo));
      setDuration(track.duration || 0);
      const audio = audioRef.current;
      if (!audio) return;
      applyTrackToAudio(audio, track, seekTo, autoplay, () => setIsPlaying(false));
    },
    [audioRef, setCurrent, setProgress, setDuration, setIsPlaying],
  );

  const loadTrack = useCallback(
    (track: Track, shouldPlay: boolean) => attachTrack(track, 0, shouldPlay),
    [attachTrack],
  );

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(time)) {
        audio.currentTime = time;
        setProgress(time);
      }
    },
    [audioRef, setProgress],
  );

  const playTrack = useCallback(
    (track: Track, nextQueue?: Track[]) => {
      if (!isPlayable(track)) {
        showNotice('This track is suspended and cannot be played');
        return;
      }
      if (nextQueue && nextQueue.length > 0) {
        setQueue(nextQueue);
        setDirection(1);
      } else if (current && current.id === track.id) {
        const audio = audioRef.current;
        if (audio?.paused) {
          audio.play().catch(() => {
            if (audio.paused) setIsPlaying(false);
          });
          setIsPlaying(true);
        } else {
          audio?.pause();
          setIsPlaying(false);
        }
        return;
      }
      loadTrack(track, true);
      setIsPlaying(true);
      api.recordPlay(track.id).catch(() => {});
    },
    [current, audioRef, loadTrack, setQueue, setDirection, setIsPlaying, showNotice],
  );

  const playTrackAt = useCallback(
    (track: Track, time: number) => {
      if (!isPlayable(track)) {
        showNotice('This track is suspended and cannot be played');
        return;
      }
      if (current && current.id === track.id) {
        seek(time);
        const audio = audioRef.current;
        if (audio?.paused) {
          audio.play().catch(() => {
            if (audio.paused) setIsPlaying(false);
          });
          setIsPlaying(true);
        }
        return;
      }
      attachTrack(track, time, true);
      setIsPlaying(true);
      api.recordPlay(track.id).catch(() => {});
    },
    [attachTrack, current, seek, audioRef, setIsPlaying, showNotice],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!current || !audio) return;
    if (!isPlayable(current)) {
      showNotice('This track is suspended and cannot be played');
      return;
    }
    if (audio.paused) {
      audio.play().catch(() => {
        if (audio.paused) setIsPlaying(false);
      });
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [current, audioRef, setIsPlaying, showNotice]);

  const move = useCallback(
    (offset: 1 | -1) => {
      const cur = currentRef.current;
      if (!cur) return;
      if (repeatRef.current === 'one') {
        if (!isPlayable(cur)) {
          showNotice('This track is suspended and cannot be played');
          return;
        }
        loadTrack(cur, true);
        setIsPlaying(true);
        return;
      }
      setDirection(offset);
      const decision = decideNextTrack(queueRef.current, cur, offset, shuffleRef.current, repeatRef.current);
      switch (decision.kind) {
        case 'empty':
          showNotice('No playable tracks in the queue');
          break;
        case 'unplayable':
          showNotice('This track is suspended and cannot be played');
          break;
        case 'end':
          audioRef.current?.pause();
          setIsPlaying(false);
          showNotice('End of queue');
          break;
        case 'replay':
          loadTrack(cur, true);
          setIsPlaying(true);
          break;
        case 'play':
          loadTrack(decision.track, true);
          setIsPlaying(true);
          api.recordPlay(decision.track.id).catch(() => {});
          break;
      }
    },
    [audioRef, currentRef, queueRef, shuffleRef, repeatRef, loadTrack, setIsPlaying, setDirection, showNotice],
  );

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), [setShuffle]);
  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), [setRepeat]);

  return { attachTrack, loadTrack, seek, playTrack, playTrackAt, togglePlay, next, prev, toggleShuffle, cycleRepeat };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function useNoticeState(): {
  notice: Notice | null;
  showNotice: (message: string, variant?: 'default' | 'success') => void;
} {
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeCounter = useRef(0);

  const showNotice = useCallback((message: string, variant: 'default' | 'success' = 'default') => {
    noticeCounter.current += 1;
    setNotice({ id: noticeCounter.current, message, variant });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  }, []);

  return { notice, showNotice };
}

// ---------------------------------------------------------------------------

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { notice, showNotice } = useNoticeState();
  const playback = usePlaybackState();
  const audio = useAudio(playback.current);
  const actions = usePlayerActions({
    audioRef: audio.audioRef,
    current: playback.current,
    currentRef: playback.currentRef,
    queueRef: playback.queueRef,
    shuffleRef: playback.shuffleRef,
    repeatRef: playback.repeatRef,
    setCurrent: playback.setCurrent,
    setQueue: playback.setQueue,
    setProgress: playback.setProgress,
    setDuration: playback.setDuration,
    setIsPlaying: playback.setIsPlaying,
    setDirection: playback.setDirection,
    setShuffle: playback.setShuffle,
    setRepeat: playback.setRepeat,
    showNotice,
  });

  const value = useMemo(
    () => ({
      queue: playback.queue,
      current: playback.current,
      isPlaying: playback.isPlaying,
      direction: playback.direction,
      progress: playback.progress,
      duration: playback.duration,
      volume: audio.volume,
      muted: audio.muted,
      shuffle: playback.shuffle,
      repeat: playback.repeat,
      audioElement: audio.audioElement,
      notice,
      showNotice,
      playTrack: actions.playTrack,
      playTrackAt: actions.playTrackAt,
      togglePlay: actions.togglePlay,
      next: actions.next,
      prev: actions.prev,
      toggleShuffle: actions.toggleShuffle,
      cycleRepeat: actions.cycleRepeat,
      seek: actions.seek,
      setVolume: audio.setVolume,
      toggleMute: audio.toggleMute,
    }),
    [
      playback.queue, playback.current, playback.isPlaying, playback.direction, playback.progress,
      playback.duration, playback.shuffle, playback.repeat,
      audio.volume, audio.muted, audio.audioElement, audio.setVolume, audio.toggleMute,
      notice, showNotice,
      actions.playTrack, actions.playTrackAt, actions.togglePlay, actions.next, actions.prev,
      actions.toggleShuffle, actions.cycleRepeat, actions.seek,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audio.setAudioElement}
        preload="auto"
        onTimeUpdate={(e) => playback.setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => playback.setDuration(e.currentTarget.duration)}
        onError={() => {
          playback.setIsPlaying(false);
          showNotice('Failed to load audio');
        }}
        onEnded={() => {
          if (playback.repeatRef.current === 'one' && playback.currentRef.current) {
            actions.loadTrack(playback.currentRef.current, true);
            playback.setIsPlaying(true);
          } else {
            actions.next();
          }
        }}
        onPlay={() => playback.setIsPlaying(true)}
        onPause={() => playback.setIsPlaying(false)}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
