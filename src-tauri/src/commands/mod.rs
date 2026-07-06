pub(crate) mod util;
pub mod file_ops;
pub mod auth;
pub mod logging;
pub mod scraping;
pub mod subscriptions;
pub mod settings;
pub mod account;
pub mod image_migration;
pub mod self_check;

// Re-export state types for convenient access from lib.rs .manage() calls
pub use scraping::ScrapedPostsRawState;
pub use scraping::ImageDownloadCancelFlag;
pub use subscriptions::ScrapedSubscriptionsState;
pub use settings::AppSettingsState;
pub use account::AccountInfoState;
pub use image_migration::ImageMigrationLock;
