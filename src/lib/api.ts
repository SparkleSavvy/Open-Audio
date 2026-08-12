import type {
  AdminStats,
  AdminUser,
  AppNotification,
  Comment,
  Fan,
  FollowedUser,
  RemovalRequest,
  Track,
  TrackDeleteRequest,
  TwoFaSetup,
  User,
  UserProfile,
} from '../types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// POST with an optional JSON body (never sets Content-Type for FormData).
function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type LoginResult = { user: User } | { need2fa: true; userId: number; username: string };

export const api = {
  // auth
  me: () => request<{ user: User }>('/auth/me'),
  login: (username: string, password: string): Promise<LoginResult> => post<LoginResult>('/auth/login', { username, password }),
  login2fa: (userId: number, code: string) => post<{ user: User; recoveryCodes?: string[] }>('/auth/login/2fa', { userId, code }),
  register: (username: string, email: string, password: string) =>
    post<{ user: User }>('/auth/register', { username, email, password }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  start2fa: () => post<TwoFaSetup>('/auth/2fa/start'),
  enable2fa: (secret: string, code: string, recoveryCodes: string[]) =>
    post<{ user: User }>('/auth/2fa/enable', { secret, code, recoveryCodes }),
  disable2fa: (password: string) => post<{ user: User }>('/auth/2fa/disable', { password }),

  // tracks
  getTracks: (params: { q?: string; sort?: 'latest' | 'popular'; liked?: boolean; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.sort) query.set('sort', params.sort);
    if (params.liked) query.set('liked', '1');
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<{ tracks: Track[] }>(`/tracks${qs ? `?${qs}` : ''}`);
  },
  getTrack: (id: number) => request<{ track: Track }>(`/tracks/${id}`),
  getMyTracks: () => request<{ tracks: Track[] }>('/tracks/me'),
  uploadTrack: (form: FormData) =>
    request<{ track: Track }>('/tracks', { method: 'POST', body: form }),
  deleteTrack: (id: number) => request<{ ok: boolean }>(`/tracks/${id}`, { method: 'DELETE' }),
  toggleLike: (id: number) => post<{ liked: boolean; likes: number }>(`/tracks/${id}/like`),
  recordPlay: (id: number) => post<{ ok: boolean }>(`/tracks/${id}/play`),
  resubmit: (id: number) => post<{ track: Track }>(`/tracks/${id}/resubmit`),
  toggleRepost: (id: number) => post<{ reposted: boolean; reposts: number }>(`/tracks/${id}/repost`),

  // studio
  importSoundCloud: (url: string) => post<{ track: Track }>('/studio/import', { url }),

  // comments
  getTrackComments: (id: number, filter?: 'newest' | 'oldest') =>
    request<{ comments: Comment[] }>(`/tracks/${id}/comments${filter ? `?filter=${filter}` : ''}`),
  postComment: (id: number, body: { body: string; ts: number; replyTo?: number | null }) =>
    post<{ comment: Comment }>(`/tracks/${id}/comments`, body),
  likeComment: (id: number) => post<{ liked: boolean; likes: number }>(`/tracks/comments/${id}/like`),
  deleteComment: (id: number) => request<{ ok: boolean }>(`/tracks/comments/${id}`, { method: 'DELETE' }),

  // fans
  getTrackFans: (id: number) => request<{ fans: Fan[] }>(`/tracks/${id}/fans`),

  // users
  getUserProfile: (id: number) => request<{ profile: UserProfile }>(`/users/${id}`),
  toggleFollow: (id: number) => post<{ following: boolean; followers: number }>(`/users/${id}/follow`),
  getUserTracks: (id: number, sort?: 'latest' | 'popular') =>
    request<{ tracks: Track[] }>(`/users/${id}/tracks${sort ? `?sort=${sort}` : ''}`),
  getUserReposts: (id: number) => request<{ tracks: Track[] }>(`/users/${id}/reposts`),
  getUserLikes: (id: number) => request<{ tracks: Track[] }>(`/users/${id}/likes`),
  getUserFollowing: (id: number) => request<{ users: FollowedUser[] }>(`/users/${id}/following`),

  // admin
  adminTracks: (status: string) => request<{ tracks: Track[] }>(`/admin/tracks?status=${status}`),
  verifyTrack: (id: number) => post<{ track: Track }>(`/admin/tracks/${id}/verify`),
  suspendTrack: (id: number) => post<{ track: Track }>(`/admin/tracks/${id}/suspend`),
  unsuspendTrack: (id: number) => post<{ track: Track }>(`/admin/tracks/${id}/unsuspend`),
  rejectTrack: (id: number, reason: string) => post<{ track: Track }>(`/admin/tracks/${id}/reject`, { reason }),
  adminUsers: () => request<{ users: AdminUser[] }>('/admin/users'),
  updateUser: (id: number, patch: { banned?: boolean; role?: string }) =>
    request<{ user: User }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeleteTrack: (id: number) => request<{ ok: boolean }>(`/admin/tracks/${id}`, { method: 'DELETE' }),
  requestTrackDelete: (id: number, reason: string) =>
    post<{ request: TrackDeleteRequest }>(`/admin/tracks/${id}/delete-request`, { reason }),
  trackDeleteRequests: () => request<{ requests: TrackDeleteRequest[] }>('/admin/track-delete-requests'),
  approveTrackDelete: (id: number) => post<{ request: TrackDeleteRequest }>(`/admin/track-delete-requests/${id}/approve`),
  rejectTrackDelete: (id: number) => post<{ request: TrackDeleteRequest }>(`/admin/track-delete-requests/${id}/reject`),
  adminStats: () => request<AdminStats>('/admin/stats'),
  adminRemovalRequests: () => request<{ requests: RemovalRequest[] }>('/admin/removal-request'),
  adminCancelRemoval: (id: number) => post<{ request: RemovalRequest }>(`/admin/removal-request/${id}/cancel`),
  adminConfirmRemoval: (id: number, key: string) => post<{ ok: boolean }>(`/admin/removal-request/${id}/confirm`, { key }),

  // notifications
  notifications: () => request<{ notifications: AppNotification[] }>('/notifications'),
  notificationsUnread: () => request<{ unread: number }>('/notifications/unread-count'),
  readNotification: (id: number) => post<{ ok: boolean }>(`/notifications/${id}/read`),
  readAllNotifications: () => post<{ ok: boolean }>('/notifications/read-all'),
  clearNotifications: () => request<{ ok: boolean }>('/notifications', { method: 'DELETE' }),
};

export function downloadTrack(track: Track): void {
  const a = document.createElement('a');
  a.href = `/api/tracks/${track.id}/download`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
