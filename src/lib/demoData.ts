import { Creator, Post, Asset } from '../types/db';

// Two fictional creators used by Demo Mode (Settings > Developer Mode > 演示模式)
// so the app can be screenshotted without exposing real Patreon subscriptions.
// IDs are prefixed unmistakably so they can never collide with a real synced
// creator's ID (those are content-hashes of real Patreon data).

const CREATOR_1_ID = '__demo_creator_1__';
const CREATOR_2_ID = '__demo_creator_2__';

// Every local_path below points at a file that ensure_demo_assets_on_disk
// (a Rust command) copies onto disk under images_dir()/__demo__/... the
// first time Demo Mode is switched on — see src-tauri/src/commands/file_ops.rs.
function demoAssetPath(creatorId: string, filename: string): string {
  return `images/__demo__/${creatorId}/high_res/${filename}`;
}

const DEMO_CREATORS_BASE: Creator[] = [
  {
    id: CREATOR_1_ID,
    source_key: 'demo',
    external_id: null,
    name: 'Aurora Wildframe',
    profile_url: 'https://www.patreon.com/demo-aurora-wildframe',
    avatar_path: null,
    description: 'Wildlife and wilderness photography from the field.',
    last_synced_at: '2026-06-28T09:00:00Z',
    created_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-06-28T09:00:00Z',
    subscription_type: 'paid',
    is_subscribed: 1,
    is_pinned: 0,
    pin_order: 0,
  },
  {
    id: CREATOR_2_ID,
    source_key: 'demo',
    external_id: null,
    name: 'Coastal Lens Studio',
    profile_url: 'https://www.patreon.com/demo-coastal-lens',
    avatar_path: null,
    description: 'Landscape and travel photography along the coast.',
    last_synced_at: '2026-06-25T09:00:00Z',
    created_at: '2026-02-02T09:00:00Z',
    updated_at: '2026-06-25T09:00:00Z',
    subscription_type: 'free',
    is_subscribed: 1,
    is_pinned: 0,
    pin_order: 0,
  },
];

export const DEMO_POSTS: Post[] = [
  {
    id: '__demo_post_1__',
    creator_id: CREATOR_1_ID,
    source_key: 'demo',
    external_id: null,
    title: 'Chasing the Alpine Wolf Pack',
    excerpt: 'Four mornings at 4,000 feet finally paid off.',
    content_raw: null,
    content_rendered_html:
      '<p>Four mornings at 4,000 feet finally paid off. The pack has been using this ridge line to move between den sites, and once the wind finally cooperated, they came within thirty meters of the blind without ever knowing I was there.</p><p>Patience is the whole job. The photo is just the receipt.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-28T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'unread',
    is_starred: 1,
    created_at: '2026-06-28T08:00:00Z',
    updated_at: '2026-06-28T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Aurora Wildframe',
    creator_avatar_path: undefined,
  },
  {
    id: '__demo_post_2__',
    creator_id: CREATOR_1_ID,
    source_key: 'demo',
    external_id: null,
    title: 'Behind the Blind: Three Days Waiting for Light',
    excerpt: 'Not every trip ends with a usable frame, and that has to be fine.',
    content_raw: null,
    content_rendered_html:
      '<p>Not every trip ends with a usable frame, and that has to be fine. Overcast skies for three straight days, a lens that fogged every time I opened the blind, and a lot of instant coffee. This is the part nobody posts, so here it is.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-20T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'read',
    is_starred: 0,
    created_at: '2026-06-20T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Aurora Wildframe',
    creator_avatar_path: undefined,
  },
  {
    id: '__demo_post_3__',
    creator_id: CREATOR_1_ID,
    source_key: 'demo',
    external_id: null,
    title: "Gear Notes: What's Actually in My Bag",
    excerpt: 'Less than you would think, and none of it is the expensive part.',
    content_raw: null,
    content_rendered_html:
      '<p>Less than you would think, and none of it is the expensive part. A long lens matters less than knowing where the animals will be at sunrise before you ever raise the camera. Full breakdown of the kit below.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-10T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'unread',
    is_starred: 0,
    created_at: '2026-06-10T08:00:00Z',
    updated_at: '2026-06-10T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Aurora Wildframe',
    creator_avatar_path: undefined,
  },
  {
    id: '__demo_post_4__',
    creator_id: CREATOR_2_ID,
    source_key: 'demo',
    external_id: null,
    title: 'Golden Hour on the Coast Road',
    excerpt: 'This stretch only works for about twelve minutes a day.',
    content_raw: null,
    content_rendered_html:
      '<p>This stretch only works for about twelve minutes a day, right as the light drops below the cloud bank offshore. Everything before or after that window is a completely different, much flatter photo.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-25T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'unread',
    is_starred: 0,
    created_at: '2026-06-25T08:00:00Z',
    updated_at: '2026-06-25T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Coastal Lens Studio',
    creator_avatar_path: undefined,
  },
  {
    id: '__demo_post_5__',
    creator_id: CREATOR_2_ID,
    source_key: 'demo',
    external_id: null,
    title: 'A Quiet Morning at the Overlook',
    excerpt: 'No plan for this one beyond showing up before anyone else did.',
    content_raw: null,
    content_rendered_html:
      '<p>No plan for this one beyond showing up before anyone else did. Sometimes the best composition is just an empty overlook and enough coffee to wait out the fog.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-15T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'read',
    is_starred: 0,
    created_at: '2026-06-15T08:00:00Z',
    updated_at: '2026-06-15T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Coastal Lens Studio',
    creator_avatar_path: undefined,
  },
  {
    id: '__demo_post_6__',
    creator_id: CREATOR_2_ID,
    source_key: 'demo',
    external_id: null,
    title: 'Editing Workflow: From RAW to Final',
    excerpt: 'Fewer sliders than you would guess, and almost no local adjustments.',
    content_raw: null,
    content_rendered_html:
      '<p>Fewer sliders than you would guess, and almost no local adjustments. If a photo needs that much rescuing in post, the real fix is usually going back and reshooting it.</p>',
    content_format: 'html',
    source_url: null,
    published_at: '2026-06-05T08:00:00Z',
    archived_at: null,
    has_assets: 1,
    read_state: 'unread',
    is_starred: 0,
    created_at: '2026-06-05T08:00:00Z',
    updated_at: '2026-06-05T08:00:00Z',
    min_cents_pledged_to_view: null,
    creator_name: 'Coastal Lens Studio',
    creator_avatar_path: undefined,
  },
];

export const DEMO_ASSETS: Asset[] = [
  {
    id: '__demo_asset_1__',
    post_id: '__demo_post_1__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_1_ID, 'ltapsah-mountain-wolf-7229583.jpg'),
    file_name: 'ltapsah-mountain-wolf-7229583.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-28T08:00:00Z',
    updated_at: '2026-06-28T08:00:00Z',
    downloaded_at: '2026-06-28T08:00:00Z',
  },
  {
    id: '__demo_asset_2__',
    post_id: '__demo_post_1__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_1_ID, 'pexels-dropshado-30662151.jpg'),
    file_name: 'pexels-dropshado-30662151.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-28T08:00:01Z',
    updated_at: '2026-06-28T08:00:01Z',
    downloaded_at: '2026-06-28T08:00:01Z',
  },
  {
    id: '__demo_asset_3__',
    post_id: '__demo_post_2__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_1_ID, 'pexels-robert-schwarz-1488822070-31839964.jpg'),
    file_name: 'pexels-robert-schwarz-1488822070-31839964.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-20T08:00:00Z',
    updated_at: '2026-06-20T08:00:00Z',
    downloaded_at: '2026-06-20T08:00:00Z',
  },
  {
    id: '__demo_asset_4__',
    post_id: '__demo_post_3__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_1_ID, 'pexels-sonneblom-10528689.jpg'),
    file_name: 'pexels-sonneblom-10528689.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-10T08:00:00Z',
    updated_at: '2026-06-10T08:00:00Z',
    downloaded_at: '2026-06-10T08:00:00Z',
  },
  {
    id: '__demo_asset_5__',
    post_id: '__demo_post_4__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_2_ID, 'pexels-alex-ning-523843601-33650553.jpg'),
    file_name: 'pexels-alex-ning-523843601-33650553.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-25T08:00:00Z',
    updated_at: '2026-06-25T08:00:00Z',
    downloaded_at: '2026-06-25T08:00:00Z',
  },
  {
    id: '__demo_asset_6__',
    post_id: '__demo_post_4__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_2_ID, 'pexels-glen-mc-call-1137859051-30447248.jpg'),
    file_name: 'pexels-glen-mc-call-1137859051-30447248.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-25T08:00:01Z',
    updated_at: '2026-06-25T08:00:01Z',
    downloaded_at: '2026-06-25T08:00:01Z',
  },
  {
    id: '__demo_asset_7__',
    post_id: '__demo_post_5__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_2_ID, 'pexels-sefa-demirtas-2152709769-32366529.jpg'),
    file_name: 'pexels-sefa-demirtas-2152709769-32366529.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-15T08:00:00Z',
    updated_at: '2026-06-15T08:00:00Z',
    downloaded_at: '2026-06-15T08:00:00Z',
  },
  {
    id: '__demo_asset_8__',
    post_id: '__demo_post_6__',
    source_url: null,
    local_path: demoAssetPath(CREATOR_2_ID, 'pexels-zenith-3341173-14854864.jpg'),
    file_name: 'pexels-zenith-3341173-14854864.jpg',
    mime_type: 'image/jpeg',
    media_type: 'image',
    byte_size: null,
    checksum_sha256: null,
    created_at: '2026-06-05T08:00:00Z',
    updated_at: '2026-06-05T08:00:00Z',
    downloaded_at: '2026-06-05T08:00:00Z',
  },
];

export const DEMO_CREATORS: (Creator & { post_count: number })[] = DEMO_CREATORS_BASE.map(c => ({
  ...c,
  post_count: DEMO_POSTS.filter(p => p.creator_id === c.id).length,
}));

/** Mirrors getPosts()'s creatorId/starred filtering and its published_at DESC ordering. */
export function getDemoPosts(creatorId?: string, starredOnly?: boolean): Post[] {
  return DEMO_POSTS
    .filter(p => (starredOnly ? p.is_starred === 1 : true))
    .filter(p => (creatorId ? p.creator_id === creatorId : true))
    .slice()
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

/** Mirrors getPostAssets()'s created_at ASC ordering. */
export function getDemoAssets(postId: string): Asset[] {
  return DEMO_ASSETS
    .filter(a => a.post_id === postId)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
