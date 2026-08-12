import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
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

export function PlayerProvider({ children }: { children: ReactNode }) {
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
  const [queue, setQueue] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  const { notice, showNotice } = useNoticeState();

  const isPlayable = (track: Track) => track.status !== 'suspended';

  type MoveDecision =
    | { kind: 'empty' }
    | { kind: 'unplayable' }
    | { kind: 'replay' }
    | { kind: 'end' }
    | { kind: 'play'; track: Track };

  // Pure decision logic for `move` — where the queue should go next given the
  // current track and playback settings. No side effects.
  function decideNextTrack(
    q: Track[],
    cur: Track,
    offset: 1 | -1,
    shuffle: boolean,
    repeat: 'off' | 'all' | 'one',
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

  // Loads a track into the audio element. seekTo > 0 seeks to that position
  // once metadata is ready; autoplay=false only loads (does not start playback).
  const attachTrack = useCallback((track: Track, seekTo: number, autoplay: boolean) => {
    setCurrent(track);
    setProgress(Math.max(0, seekTo));
    setDuration(track.duration || 0);
    const audio = audioRef.current;
    if (!audio) return;
    applyTrackToAudio(audio, track, seekTo, autoplay, () => setIsPlaying(false));
  }, []);

  const loadTrack = useCallback(
    (track: Track, shouldPlay: boolean) => attachTrack(track, 0, shouldPlay),
    [attachTrack],
  );

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(time)) {
      audio.currentTime = time;
      setProgress(time);
    }
  }, []);

  const playTrack = useCallback(
    (track: Track, nextQueue?: Track[]) => {
      if (!isPlayable(track)) {
        showNotice('This track is suspended and cannot be played');
        return;
      }
      if (nextQueue && nextQueue.length > 0) {
        setQueue(nextQueue);
        const idx = nextQueue.findIndex((t) => t.id === track.id);
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
    [current, loadTrack, showNotice],
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
    [attachTrack, current, isPlayable, seek, showNotice],
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
  }, [current, showNotice]);

  const queueRef = useRef<Track[]>([]);
  const currentRef = useRef<Track | null>(null);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

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
    [loadTrack, showNotice],
  );

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  // keep volume in sync with audio element (the Web Audio graph taps the
  // element's output, so the element volume is the single source of truth)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted, current]);

  const value = useMemo(
    () => ({
      queue,
      current,
      isPlaying,
      direction,
      progress,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      audioElement,
      notice,
      showNotice,
      playTrack,
      playTrackAt,
      togglePlay,
      next,
      prev,
      toggleShuffle,
      cycleRepeat,
      seek,
      setVolume,
      toggleMute,
    }),
    [queue, current, isPlaying, direction, progress, duration, volume, muted, shuffle, repeat, audioElement, notice, showNotice, playTrack, playTrackAt, togglePlay, next, prev, toggleShuffle, cycleRepeat, seek, setVolume, toggleMute],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={setAudioElement}
        preload="auto"
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          setIsPlaying(false);
          showNotice('Failed to load audio');
        }}
        onEnded={() => {
          if (repeatRef.current === 'one' && currentRef.current) {
            loadTrack(currentRef.current, true);
            setIsPlaying(true);
          } else {
            next();
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
