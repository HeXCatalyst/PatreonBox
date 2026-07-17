export interface Creator {
  id: string;
  source_key: string;
  external_id: string | null;
  name: string;
  profile_url: string | null;
  avatar_path: string | null;
  description: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  subscription_type: 'free' | 'paid' | null;
  is_subscribed: number;
  is_pinned: number;
  pin_order: number;
}

export interface Post {
  id: string;
  creator_id: string;
  source_key: string;
  external_id: string | null;
  title: string;
  excerpt: string | null;
  content_raw: string | null;
  content_rendered_html: string | null;
  content_format: string | null;
  source_url: string | null;
  published_at: string | null;
  archived_at: string | null;
  has_assets: number;
  read_state: 'unread' | 'read' | 'archived';
  is_starred: number;
  created_at: string;
  updated_at: string;
  min_cents_pledged_to_view?: number | null;
  // joined fields
  creator_name?: string;
  creator_avatar_path?: string;
}

export interface Asset {
  id: string;
  post_id: string;
  source_url: string | null;
  local_path: string;
  file_name: string;
  mime_type: string | null;
  media_type: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  created_at: string;
  updated_at: string;
  downloaded_at: string | null;
  download_error: string | null;
  // The creator's original publish time for this asset's post. Populated only by
  // queries that join `posts` (media grid, reading view) — absent on plain asset
  // rows, hence optional.
  published_at?: string | null;
}

export interface SyncRun {
  id: string;
  source_key: string;
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  creators_scanned: number;
  posts_imported: number;
  assets_downloaded: number;
  error_message: string | null;
}

export interface PostTag {
  post_id: string;
  tag: string;
}

export interface SyncCheckpoint {
  creator_id: string;
  cursor: string;
  posts_done: number;
  mode: 'normal' | 'full';
}
