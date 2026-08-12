export const TRACK_SELECT = `
SELECT t.*,
  u.username AS uploader_username,
  u.avatar_url AS uploader_avatar,
  EXISTS(SELECT 1 FROM likes l WHERE l.track_id = t.id AND l.user_id = ?) AS liked,
  EXISTS(SELECT 1 FROM reposts r WHERE r.track_id = t.id AND r.user_id = ?) AS reposted
FROM tracks t
LEFT JOIN users u ON u.id = t.uploader_id
`;

export function viewerParams(viewerId: number): number[] {
  return [viewerId, viewerId];
}
