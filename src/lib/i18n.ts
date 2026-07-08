import { useSettings } from "../features/settings/SettingsContext";

export type Language = 'zh' | 'en';

export interface Translations {
  common: {
    cancel: string;
    unknownDate: string;
  };
  sidebar: {
    syncSubscriptionsTooltip: string;
    searchPlaceholder: string;
    filterAll: string;
    filterFree: string;
    filterPaid: string;
    filterUnsubscribed: string;
    starred: string;
    allCreators: string;
    pinnedHeading: (count: number) => string;
    subscriptionsHeading: (count: number) => string;
    settings: string;
    unpin: string;
    pin: string;
    delete: string;
    unsubscribedTag: string;
    deleteConfirmTitle: (name: string) => string;
    deleteConfirmDesc: string;
    confirmDelete: string;
    statusScraping: string;
    statusScrapeError: string;
    statusSaving: string;
    statusSynced: (count: number) => string;
    statusDbError: (msg: string) => string;
    statusError: (msg: string) => string;
    syncBannerWarning: string;
  };
  postList: {
    starredHeading: (count: number) => string;
    modeNormalBare: string;
    modeFullBare: string;
    syncingLabel: (modeLabel: string, progress: number, total: string) => string;
    syncingPostsLabel: string;
    downloadingImagesLabel: string;
    pause: string;
    cancel: string;
    downloadingImages: (progress: number, total: string) => string;
    maxPostsTooltip: string;
    onlyNewPosts: string;
    onlyNewPostsTooltip: string;
    modeNormal: string;
    modeFull: string;
    modeNormalDesc: string;
    modeFullDesc: string;
    resume: (done: number) => string;
    resync: string;
    resumeDownload: (done: number, total: string) => string;
    assets: string;
    failedCount: (n: number) => string;
    clearDataTooltip: string;
    searchPlaceholder: string;
    filter: string;
    noStarredPosts: string;
    noPostsFound: string;
    selectCreator: string;
    starredEmptyHint: string;
    notSyncedHint: string;
    chooseCreatorHint: string;
    syncing: string;
    syncNow: string;
    removeFromStarred: string;
    addToStarred: string;
    prev: string;
    next: string;
    jumpToPageTooltip: string;
    clearDataTitle: (name?: string) => string;
    clearDataDesc: (count: number) => string;
    clearDataConfirm: string;
  };
  readingView: {
    noSelection: string;
    selectPostHint: string;
    original: string;
    removeFromStarred: string;
    addToStarred: string;
    imagePostHint: string;
    noTextContent: string;
    savedToDownloads: string;
    audioHeading: (count: number) => string;
    openInSystem: string;
    saveToDownloads: string;
    notDownloaded: string;
    attachmentsHeading: (count: number) => string;
    save: string;
  };
  filterPanel: {
    free: string;
    presetAll: string;
    preset7d: string;
    preset30d: string;
    presetYear: string;
    presetCustom: string;
    publishDate: string;
    from: string;
    to: string;
    paidTier: string;
    all: string;
  };
  imageGallery: {
    imagesHeading: (count: number) => string;
    small: string;
    large: string;
    saveToDownloads: string;
  };
  lightbox: {
    zoomOut: string;
    resetZoom: string;
    zoomIn: string;
    restoreZoom: string;
    properties: string;
    downloadedAt: (date: string) => string;
    saveToDownloads: string;
    close: string;
  };
  mediaView: {
    postsTab: string;
    mediaTab: string;
    count: (n: number) => string;
    newestFirst: string;
    oldestFirst: string;
    loading: string;
    empty: string;
  };
  selfCheck: {
    heading: string;
    description: string;
    run: string;
    running: string;
    copy: string;
    copied: string;
    checks: {
      data_dir: string;
      images_dir: string;
      downloads_dir: string;
      database: string;
      proxy: string;
      system_info: string;
      patreon_connectivity: string;
    };
  };
  settingsNav: {
    account: string;
    sync: string;
    network: string;
    storage: string;
    appearance: string;
    language: string;
    about: string;
    developer: string;
    backToLibrary: string;
  };
  settingsAccount: {
    heading: string;
    creator: string;
    patron: string;
    logout: string;
    notLoggedIn: string;
    connectHint: string;
    loginButton: string;
    followedHeading: (total: number, paid: number) => string;
    lastSynced: (date: string) => string;
    demoModeHidden: string;
  };
  settingsAppearance: {
    heading: string;
    themeLabel: string;
    themeDesc: string;
    dark: string;
    light: string;
    system: string;
    panelWidthLabel: string;
    panelWidthValue: (sidebar: number, postList: number) => string;
    restoreDefault: string;
  };
  settingsNetwork: {
    heading: string;
    proxyModeLabel: string;
    proxyModeDesc: string;
    auto: string;
    manual: string;
    off: string;
    manualAddrLabel: string;
    manualAddrFormat: string;
  };
  settingsStorage: {
    heading: string;
    dataDirLabel: string;
    openInFinder: string;
    storageUsedLabel: string;
    database: (size: string) => string;
    images: (size: string) => string;
    total: (size: string) => string;
    calculating: string;
    clearAllLabel: string;
    clearAllDesc: string;
    clearButton: string;
    clearDialogTitle: string;
    clearDialogDesc: string;
    cancel: string;
    clearAll: string;
    imagesDirLabel: string;
    imagesDirDefault: string;
    changeFolderButton: string;
    restoreDefaultButton: string;
    migrationCopying: string;
    migrationVerifying: string;
    migrationDone: string;
    migrationFailed: (msg: string) => string;
    verifyModeLabel: string;
    verifyModeSize: string;
    verifyModeHash: string;
  };
  settingsSync: {
    heading: string;
    maxPostsLabel: string;
    maxPostsDesc: string;
    defaultModeLabel: string;
    defaultModeDesc: string;
    modeNormal: string;
    modeFull: string;
    timeoutLabel: string;
    timeoutDesc: string;
    delayLabel: string;
    delayDesc: string;
    msUnit: string;
    jitterLabel: string;
    jitterDesc: string;
    msCapUnit: string;
    assetDownloadHeading: string;
    assetDownloadDesc: string;
    imagesLabel: string;
    imagesDesc: string;
    audioLabel: string;
    audioDesc: string;
    attachmentsLabel: string;
    attachmentsDesc: string;
  };
  settingsAbout: {
    heading: string;
    appVersion: string;
    database: string;
    debugMode: string;
    debugOutputLabel: string;
    debugModeTerminal: string;
    debugModeInherit: string;
    debugModeNone: string;
    demoMode: string;
  };
  settingsLanguage: {
    heading: string;
    description: string;
    chinese: string;
    english: string;
  };
}

const zh: Translations = {
  common: {
    cancel: '取消',
    unknownDate: '未知日期',
  },
  sidebar: {
    syncSubscriptionsTooltip: '同步订阅',
    searchPlaceholder: '搜索创作者...',
    filterAll: '全部',
    filterFree: '免费',
    filterPaid: '付费',
    filterUnsubscribed: '已退订',
    starred: '收藏',
    allCreators: '全部创作者',
    pinnedHeading: (count) => `置顶 (${count})`,
    subscriptionsHeading: (count) => `订阅 (${count})`,
    settings: '设置(Settings)',
    unpin: '取消置顶',
    pin: '置顶',
    delete: '删除',
    unsubscribedTag: '（已退订）',
    deleteConfirmTitle: (name) => `删除「${name}」？`,
    deleteConfirmDesc: '将同时删除所有帖子和已下载图片，此操作不可撤销。',
    confirmDelete: '确认删除',
    statusScraping: '正在抓取 Patreon...',
    statusScrapeError: '抓取出错，正在尝试备份文件...',
    statusSaving: '正在保存到数据库...',
    statusSynced: (count) => `✓ 已同步 ${count} 位创作者！`,
    statusDbError: (msg) => `数据库保存出错：${msg}`,
    statusError: (msg) => `出错：${msg}`,
    syncBannerWarning: '正在同步订阅列表，请勿关闭窗口…',
  },
  postList: {
    starredHeading: (count) => `收藏 (${count})`,
    modeNormalBare: '普通',
    modeFullBare: '完整',
    syncingLabel: (modeLabel, progress, total) => `⟳ ${modeLabel}同步 ${progress}/${total}`,
    syncingPostsLabel: '正在同步帖子…',
    downloadingImagesLabel: '正在下载图片…',
    pause: '⏸ 暂停',
    cancel: '✕ 取消',
    downloadingImages: (progress, total) => `🖼 下载图片 ${progress}/${total}`,
    maxPostsTooltip: '本次抓取的帖子数量上限',
    onlyNewPosts: '仅新帖',
    onlyNewPostsTooltip: '遇到已同步过的帖子就提前停止翻页，只拉取新增内容',
    modeNormal: '↓ 普通',
    modeFull: '⬇ 完整',
    modeNormalDesc: '内容+资产',
    modeFullDesc: '普通+自动下载',
    resume: (done) => `↻ 继续 ${done}/...`,
    resync: '↓ 重新',
    resumeDownload: (done, total) => `↻ 继续下载 ${done}/${total}`,
    assets: 'Assets',
    failedCount: (n) => `⚠ ${n} 张失败`,
    clearDataTooltip: '清除该创作者的所有已同步数据',
    searchPlaceholder: '搜索帖子...',
    filter: '筛选',
    noStarredPosts: '暂无收藏帖子',
    noPostsFound: '未找到帖子',
    selectCreator: '请选择创作者',
    starredEmptyHint: '在帖子列表或阅读页中点击 ★ 收藏帖子',
    notSyncedHint: '这位创作者还没有同步过帖子。',
    chooseCreatorHint: '从侧栏选择一位创作者以查看其帖子。',
    syncing: '同步中...',
    syncNow: '立即同步帖子',
    removeFromStarred: '取消收藏',
    addToStarred: '加入收藏',
    prev: '上一页',
    next: '下一页',
    jumpToPageTooltip: '跳转到指定页',
    clearDataTitle: (name) => `清除「${name ?? '该创作者'}」的已同步数据？`,
    clearDataDesc: (count) => `将永久删除全部 ${count} 篇帖子、附件和已下载图片。创作者仍会保留在库中，可随时重新同步。`,
    clearDataConfirm: '清除数据',
  },
  readingView: {
    noSelection: '未选择帖子',
    selectPostHint: '从列表中选择一篇帖子以查看正文和附件。',
    original: '原文',
    removeFromStarred: '取消收藏',
    addToStarred: '加入收藏',
    imagePostHint: '图片帖 — 请查看下方附件。',
    noTextContent: '该帖子没有正文内容。',
    savedToDownloads: '✓ 已保存到下载',
    audioHeading: (count) => `🎵 音频 (${count})`,
    openInSystem: '在系统中打开',
    saveToDownloads: '保存到 Downloads',
    notDownloaded: '未下载',
    attachmentsHeading: (count) => `📎 附件 (${count})`,
    save: '保存',
  },
  filterPanel: {
    free: '免费',
    presetAll: '全部',
    preset7d: '近7天',
    preset30d: '近30天',
    presetYear: '今年',
    presetCustom: '自定义',
    publishDate: '发布日期',
    from: '从',
    to: '到',
    paidTier: '付费档位',
    all: '全部',
  },
  imageGallery: {
    imagesHeading: (count) => `图片 (${count})`,
    small: '小',
    large: '大',
    saveToDownloads: '保存到下载',
  },
  lightbox: {
    zoomOut: '缩小 (-)',
    resetZoom: '重置缩放 (0)',
    zoomIn: '放大 (+)',
    restoreZoom: '还原 (0)',
    properties: '属性 (I)',
    downloadedAt: (date) => `下载于 ${date}`,
    saveToDownloads: '保存到下载',
    close: '关闭 (Esc)',
  },
  mediaView: {
    postsTab: '帖子',
    mediaTab: '媒体',
    count: (n) => `${n} 张`,
    newestFirst: '最新在前',
    oldestFirst: '最早在前',
    loading: '加载中…',
    empty: '暂无已下载的图片。先在帖子页同步/下载图片后再来这里查看。',
  },
  selfCheck: {
    heading: '运行自检',
    description: '检查本机环境是否正常（目录、数据库、代理、网络连通性）。不会登录或修改你的数据。',
    run: '运行自检',
    running: '检查中…',
    copy: '复制结果',
    copied: '已复制',
    checks: {
      data_dir: '应用数据目录',
      images_dir: '图片目录',
      downloads_dir: '下载目录',
      database: '数据库读写',
      proxy: '代理解析',
      system_info: '系统信息',
      patreon_connectivity: 'Patreon 连通性',
    },
  },
  settingsNav: {
    account: '账号',
    sync: '同步偏好',
    network: '网络 / 代理',
    storage: '存储',
    appearance: '外观',
    language: '语言(Language)',
    about: '关于',
    developer: '开发者模式',
    backToLibrary: '返回库',
  },
  settingsAccount: {
    heading: '账号',
    creator: '创作者',
    patron: '赞助人',
    logout: '登出',
    notLoggedIn: '未登录',
    connectHint: '连接你的 Patreon 账号以同步订阅列表',
    loginButton: '登录 Patreon',
    followedHeading: (total, paid) => `关注的创作者 (${total} 位，其中 ${paid} 位付费)`,
    lastSynced: (date) => `上次同步：${date}`,
    demoModeHidden: '演示模式已开启，账号信息已隐藏。',
  },
  settingsAppearance: {
    heading: '外观',
    themeLabel: '主题',
    themeDesc: '控制整个应用的配色方案',
    dark: '🌙 深色',
    light: '☀️ 浅色',
    system: '💻 跟随系统',
    panelWidthLabel: '面板宽度',
    panelWidthValue: (sidebar, postList) => `侧栏 ${sidebar}px · 帖子列表 ${postList}px`,
    restoreDefault: '恢复默认宽度',
  },
  settingsNetwork: {
    heading: '网络 / 代理',
    proxyModeLabel: '代理模式',
    proxyModeDesc: '自动 = 读取 macOS 系统代理（scutil）；手动 = 使用下方地址；关闭 = 不走代理',
    auto: '自动',
    manual: '手动',
    off: '关闭',
    manualAddrLabel: '手动代理地址',
    manualAddrFormat: '格式：http://host:port，例如 http://127.0.0.1:7890',
  },
  settingsStorage: {
    heading: '存储',
    dataDirLabel: '数据目录',
    openInFinder: '在 Finder 中打开',
    storageUsedLabel: '占用空间',
    database: (size) => `数据库 ${size}`,
    images: (size) => `图片 ${size}`,
    total: (size) => `合计 ${size}`,
    calculating: '计算中…',
    clearAllLabel: '清除全部数据',
    clearAllDesc: '删除所有帖子和图片。创作者订阅记录保留，可随时重新同步。',
    clearButton: '清除…',
    clearDialogTitle: '清除全部帖子和图片？',
    clearDialogDesc: '所有创作者的帖子、附件和下载图片将被永久删除。创作者订阅列表保留。',
    cancel: '取消',
    clearAll: '清除全部',
    imagesDirLabel: '图片存储位置',
    imagesDirDefault: '默认位置',
    changeFolderButton: '更改文件夹…',
    restoreDefaultButton: '恢复默认位置',
    migrationCopying: '正在复制文件…',
    migrationVerifying: '正在校验文件…',
    migrationDone: '迁移完成',
    migrationFailed: (msg) => `迁移失败：${msg}`,
    verifyModeLabel: '校验模式',
    verifyModeSize: '大小对比',
    verifyModeHash: '完整 Hash 校验',
  },
  settingsSync: {
    heading: '同步偏好',
    maxPostsLabel: '默认最大帖子数',
    maxPostsDesc: '每次同步拉取的上限，下次打开 app 时生效',
    defaultModeLabel: '默认同步模式',
    defaultModeDesc: '普通 = 内容 + 资产；完整 = 普通 + 自动下载图片',
    modeNormal: '↓ 普通',
    modeFull: '⬇ 完整',
    timeoutLabel: '图片下载超时（秒）',
    timeoutDesc: '单张图片下载的最大等待时间，修改后下次启动 app 生效',
    delayLabel: '图片下载延迟',
    delayDesc: '每张图片下载后的等待时间，减少触发 CDN 限流的风险（50–5000 ms）',
    msUnit: 'ms',
    jitterLabel: '随机抖动',
    jitterDesc: '在延迟基础上叠加 0 到此值的随机时间，避免请求间隔过于规律（50–2000 ms）',
    msCapUnit: 'ms 上限',
    assetDownloadHeading: '资产下载',
    assetDownloadDesc: '点击 "Assets" 时下载哪几类资产',
    imagesLabel: '🖼 图片',
    imagesDesc: 'post 内嵌图片、封面图',
    audioLabel: '🎵 音频',
    audioDesc: 'MP3、M4A、WAV 等音频文件',
    attachmentsLabel: '📎 附件',
    attachmentsDesc: 'PDF、ZIP、PSD 等可下载文件',
  },
  settingsAbout: {
    heading: '关于',
    appVersion: '应用版本',
    database: '数据库',
    debugMode: '开发者模式',
    debugOutputLabel: '调试输出',
    debugModeTerminal: '独立终端',
    debugModeInherit: '当前终端',
    debugModeNone: '无输出',
    demoMode: '演示模式',
  },
  settingsLanguage: {
    heading: '语言',
    description: '切换应用的界面语言',
    chinese: '中文',
    english: 'English',
  },
};

const en: Translations = {
  common: {
    cancel: 'Cancel',
    unknownDate: 'Unknown Date',
  },
  sidebar: {
    syncSubscriptionsTooltip: 'Sync Subscriptions',
    searchPlaceholder: 'Search creators...',
    filterAll: 'All',
    filterFree: 'Free',
    filterPaid: 'Paid',
    filterUnsubscribed: "Unsub'd",
    starred: 'Starred',
    allCreators: 'All Creators',
    pinnedHeading: (count) => `Pinned (${count})`,
    subscriptionsHeading: (count) => `Subscriptions (${count})`,
    settings: 'Settings',
    unpin: 'Unpin',
    pin: 'Pin',
    delete: 'Delete',
    unsubscribedTag: '(Unsubscribed)',
    deleteConfirmTitle: (name) => `Delete "${name}"?`,
    deleteConfirmDesc: 'This will also delete all posts and downloaded images. This action cannot be undone.',
    confirmDelete: 'Confirm Delete',
    statusScraping: 'Scraping Patreon...',
    statusScrapeError: 'Scrape error, trying backup file...',
    statusSaving: 'Saving to database...',
    statusSynced: (count) => `✓ ${count} creators synced!`,
    statusDbError: (msg) => `DB save error: ${msg}`,
    statusError: (msg) => `Error: ${msg}`,
    syncBannerWarning: "Syncing subscriptions — please don't close this window…",
  },
  postList: {
    starredHeading: (count) => `Starred (${count})`,
    modeNormalBare: 'Normal',
    modeFullBare: 'Full',
    syncingLabel: (modeLabel, progress, total) => `⟳ Syncing (${modeLabel}) ${progress}/${total}`,
    syncingPostsLabel: 'Syncing posts…',
    downloadingImagesLabel: 'Downloading images…',
    pause: '⏸ Pause',
    cancel: '✕ Cancel',
    downloadingImages: (progress, total) => `🖼 Downloading images ${progress}/${total}`,
    maxPostsTooltip: 'Max posts to scrape',
    onlyNewPosts: 'New posts only',
    onlyNewPostsTooltip: 'Stop paging as soon as an already-synced post is found — only pulls new content',
    modeNormal: '↓ Normal',
    modeFull: '⬇ Full',
    modeNormalDesc: 'Content + assets',
    modeFullDesc: 'Normal + auto-download',
    resume: (done) => `↻ Resume ${done}/...`,
    resync: '↓ Resync',
    resumeDownload: (done, total) => `↻ Resume download ${done}/${total}`,
    assets: 'Assets',
    failedCount: (n) => `⚠ ${n} failed`,
    clearDataTooltip: 'Clear all synced data for this creator',
    searchPlaceholder: 'Search posts...',
    filter: 'Filter',
    noStarredPosts: 'No starred posts',
    noPostsFound: 'No posts found',
    selectCreator: 'Select a creator',
    starredEmptyHint: 'Click ★ on a post row or the reading view to star it',
    notSyncedHint: "We haven't synced any posts for this creator yet.",
    chooseCreatorHint: 'Choose a creator from the sidebar to view their posts.',
    syncing: 'Syncing...',
    syncNow: 'Sync Posts Now',
    removeFromStarred: 'Remove from starred',
    addToStarred: 'Add to starred',
    prev: 'Prev',
    next: 'Next',
    jumpToPageTooltip: 'Jump to page',
    clearDataTitle: (name) => `Clear synced data for ${name ?? 'this creator'}?`,
    clearDataDesc: (count) => `This will permanently delete all ${count} posts, attachments, and downloaded images. The creator will remain in your library and can be re-synced at any time.`,
    clearDataConfirm: 'Clear Data',
  },
  readingView: {
    noSelection: 'No Selection',
    selectPostHint: 'Select a post from the list to view its contents and attachments.',
    original: 'Original',
    removeFromStarred: 'Remove from starred',
    addToStarred: 'Add to starred',
    imagePostHint: 'Image post — see attachments below.',
    noTextContent: 'No text content available for this post.',
    savedToDownloads: '✓ Saved to Downloads',
    audioHeading: (count) => `🎵 Audio (${count})`,
    openInSystem: 'Open in system',
    saveToDownloads: 'Save to Downloads',
    notDownloaded: 'Not downloaded',
    attachmentsHeading: (count) => `📎 Attachments (${count})`,
    save: 'Save',
  },
  filterPanel: {
    free: 'Free',
    presetAll: 'All',
    preset7d: 'Last 7 days',
    preset30d: 'Last 30 days',
    presetYear: 'This year',
    presetCustom: 'Custom',
    publishDate: 'Publish Date',
    from: 'From',
    to: 'To',
    paidTier: 'Paid Tier',
    all: 'All',
  },
  imageGallery: {
    imagesHeading: (count) => `Images (${count})`,
    small: 'Small',
    large: 'Large',
    saveToDownloads: 'Save to Downloads',
  },
  lightbox: {
    zoomOut: 'Zoom Out (-)',
    resetZoom: 'Reset Zoom (0)',
    zoomIn: 'Zoom In (+)',
    restoreZoom: 'Restore (0)',
    properties: 'Properties (I)',
    downloadedAt: (date) => `Downloaded at ${date}`,
    saveToDownloads: 'Save to Downloads',
    close: 'Close (Esc)',
  },
  mediaView: {
    postsTab: 'Posts',
    mediaTab: 'Media',
    count: (n) => `${n} image${n === 1 ? '' : 's'}`,
    newestFirst: 'Newest',
    oldestFirst: 'Oldest',
    loading: 'Loading…',
    empty: 'No downloaded images yet. Sync/download images from the Posts view first.',
  },
  selfCheck: {
    heading: 'Self-Check',
    description: 'Verify this machine\'s environment (folders, database, proxy, connectivity). Never logs in or modifies your data.',
    run: 'Run self-check',
    running: 'Checking…',
    copy: 'Copy results',
    copied: 'Copied',
    checks: {
      data_dir: 'App data folder',
      images_dir: 'Images folder',
      downloads_dir: 'Downloads folder',
      database: 'Database read/write',
      proxy: 'Proxy resolution',
      system_info: 'System info',
      patreon_connectivity: 'Patreon connectivity',
    },
  },
  settingsNav: {
    account: 'Account',
    sync: 'Sync',
    network: 'Network / Proxy',
    storage: 'Storage',
    appearance: 'Appearance',
    language: 'Language',
    about: 'About',
    developer: 'Developer Mode',
    backToLibrary: 'Back to Library',
  },
  settingsAccount: {
    heading: 'Account',
    creator: 'Creator',
    patron: 'Patron',
    logout: 'Log Out',
    notLoggedIn: 'Not logged in',
    connectHint: 'Connect your Patreon account to sync your subscriptions',
    loginButton: 'Log in to Patreon',
    followedHeading: (total, paid) => `Following (${total}, ${paid} paid)`,
    lastSynced: (date) => `Last synced: ${date}`,
    demoModeHidden: 'Demo Mode is on — account details are hidden.',
  },
  settingsAppearance: {
    heading: 'Appearance',
    themeLabel: 'Theme',
    themeDesc: "Controls the app's color scheme",
    dark: '🌙 Dark',
    light: '☀️ Light',
    system: '💻 System',
    panelWidthLabel: 'Panel Width',
    panelWidthValue: (sidebar, postList) => `Sidebar ${sidebar}px · Post list ${postList}px`,
    restoreDefault: 'Restore Default Width',
  },
  settingsNetwork: {
    heading: 'Network / Proxy',
    proxyModeLabel: 'Proxy Mode',
    proxyModeDesc: 'Auto = read the macOS system proxy (scutil); Manual = use the address below; Off = no proxy',
    auto: 'Auto',
    manual: 'Manual',
    off: 'Off',
    manualAddrLabel: 'Manual Proxy Address',
    manualAddrFormat: 'Format: http://host:port, e.g. http://127.0.0.1:7890',
  },
  settingsStorage: {
    heading: 'Storage',
    dataDirLabel: 'Data Directory',
    openInFinder: 'Open in Finder',
    storageUsedLabel: 'Storage Used',
    database: (size) => `Database ${size}`,
    images: (size) => `Images ${size}`,
    total: (size) => `Total ${size}`,
    calculating: 'Calculating…',
    clearAllLabel: 'Clear All Data',
    clearAllDesc: 'Deletes all posts and images. Creator subscriptions are kept and can be re-synced anytime.',
    clearButton: 'Clear…',
    clearDialogTitle: 'Clear all posts and images?',
    clearDialogDesc: 'All posts, attachments, and downloaded images for every creator will be permanently deleted. Creator subscriptions are kept.',
    cancel: 'Cancel',
    clearAll: 'Clear All',
    imagesDirLabel: 'Images Storage Location',
    imagesDirDefault: 'Default location',
    changeFolderButton: 'Change Folder…',
    restoreDefaultButton: 'Restore Default Location',
    migrationCopying: 'Copying files…',
    migrationVerifying: 'Verifying files…',
    migrationDone: 'Migration complete',
    migrationFailed: (msg) => `Migration failed: ${msg}`,
    verifyModeLabel: 'Verification Mode',
    verifyModeSize: 'Size comparison',
    verifyModeHash: 'Full hash verification',
  },
  settingsSync: {
    heading: 'Sync Preferences',
    maxPostsLabel: 'Default Max Posts',
    maxPostsDesc: 'Upper limit fetched per sync, applied next time the app opens',
    defaultModeLabel: 'Default Sync Mode',
    defaultModeDesc: 'Normal = content + assets; Full = Normal + auto-download images',
    modeNormal: '↓ Normal',
    modeFull: '⬇ Full',
    timeoutLabel: 'Image Download Timeout (sec)',
    timeoutDesc: 'Max wait time per image download, applied next app launch',
    delayLabel: 'Image Download Delay',
    delayDesc: 'Wait time after each image download, reduces the risk of CDN rate-limiting (50–5000 ms)',
    msUnit: 'ms',
    jitterLabel: 'Random Jitter',
    jitterDesc: 'Adds 0 to this many extra ms on top of the delay, so requests are less evenly spaced (50–2000 ms)',
    msCapUnit: 'ms cap',
    assetDownloadHeading: 'Asset Downloads',
    assetDownloadDesc: 'Which asset types to download when clicking "Assets"',
    imagesLabel: '🖼 Images',
    imagesDesc: 'Inline post images, cover art',
    audioLabel: '🎵 Audio',
    audioDesc: 'MP3, M4A, WAV, and other audio files',
    attachmentsLabel: '📎 Attachments',
    attachmentsDesc: 'PDF, ZIP, PSD, and other downloadable files',
  },
  settingsAbout: {
    heading: 'About',
    appVersion: 'App Version',
    database: 'Database',
    debugMode: 'Developer Mode',
    debugOutputLabel: 'Debug Output',
    debugModeTerminal: 'Standalone Terminal',
    debugModeInherit: 'Current Terminal',
    debugModeNone: 'No Output',
    demoMode: 'Demo Mode',
  },
  settingsLanguage: {
    heading: 'Language',
    description: "Switch the app's display language",
    chinese: '中文',
    english: 'English',
  },
};

export const translations: Record<Language, Translations> = { zh, en };

export function useTranslation(): Translations {
  const { settings } = useSettings();
  const lang: Language = settings.language ?? 'zh';
  return translations[lang];
}
