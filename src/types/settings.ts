export interface AppSettings {
  default_max_posts: number;
  default_sync_mode: 'normal' | 'full';
  download_timeout_secs: number;
  proxy_mode: 'auto' | 'manual' | 'off';
  proxy_url: string | null;
  theme: 'dark' | 'light' | 'system';
  language: 'zh' | 'en';
  image_download_delay_enabled: boolean;
  image_download_delay_ms: number;
  image_download_jitter_enabled: boolean;
  image_download_jitter_ms: number;
  sidebar_width: number;
  post_list_width: number;
  downloadAssetTypes: {
    images: boolean;
    audio: boolean;
    attachments: boolean;
  };
  developer_mode_enabled: boolean;
  perf_hud_enabled: boolean;
  debug_output_mode: 'terminal' | 'inherit' | 'none';
  custom_images_dir: string | null;
  migration_verify_mode: 'size' | 'hash';
  demo_mode: boolean;
  download_concurrency: number;
  download_retries: number;
  delete_mode: 'trash' | 'direct';
  layout_mode: 'classic' | 'workbench';
  color_theme: 'default' | 'reading-room' | 'dhole' | 'nightwolf' | 'azure-fox';
}

export const DEFAULT_SETTINGS: AppSettings = {
  default_max_posts: 9999,
  default_sync_mode: 'normal',
  download_timeout_secs: 60,
  proxy_mode: 'auto',
  proxy_url: null,
  theme: 'dark',
  language: 'en',
  image_download_delay_enabled: true,
  image_download_delay_ms: 300,
  image_download_jitter_enabled: false,
  image_download_jitter_ms: 150,
  sidebar_width: 256,
  post_list_width: 320,
  downloadAssetTypes: {
    images: true,
    audio: true,
    attachments: true,
  },
  developer_mode_enabled: false,
  perf_hud_enabled: false,
  debug_output_mode: 'none',
  custom_images_dir: null,
  migration_verify_mode: 'size',
  demo_mode: false,
  download_concurrency: 3,
  download_retries: 2,
  delete_mode: 'trash',
  layout_mode: 'classic',
  color_theme: 'default',
};
