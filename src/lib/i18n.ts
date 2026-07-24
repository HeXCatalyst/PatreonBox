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
    downloads: string;
    search: string;
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
    videoHeading: (count: number) => string;
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
    publishedAt: (date: string) => string;
    downloadedAt: (date: string) => string;
    saveToDownloads: string;
    close: string;
    fullscreen: string;
    exitFullscreen: string;
  };
  comments: {
    heading: (n: number) => string;
    refresh: string;
    loading: string;
    empty: string;
    notLoaded: string;
    error: string;
    unknownAuthor: string;
  };
  favorites: {
    title: string;
    mediaTab: string;
    postsTab: string;
    countMedia: (n: number) => string;
    countPosts: (n: number) => string;
    filterCreator: string;
    allCreators: string;
    sortBy: string;
    thumbnailSize: string;
    sortName: (k: string) => string;
    asc: string;
    desc: string;
    emptyMedia: string;
    emptyPosts: string;
  };
  perfHud: {
    title: string;
    fps: string;
    frame: string;
    heap: string;
    pressure: string;
    processSection: string;
    rss: string;
    cpu: string;
    collapse: string;
    expand: string;
    close: string;
    settingLabel: string;
  };
  downloads: {
    backToLibrary: string;
    heading: string;
    countDownloading: (n: number) => string;
    countQueued: (n: number) => string;
    countFailed: (n: number) => string;
    countPaused: (n: number) => string;
    pauseAll: string;
    resumeAll: string;
    retryAllFailed: string;
    cancelAll: string;
    retry: string;
    remove: string;
    sectionDownloading: string;
    sectionQueued: string;
    sectionFailed: string;
    sectionPaused: string;
    pausedLabel: string;
    sectionCompleted: string;
    clearCompleted: string;
    empty: string;
    network: string;
    diskWrite: string;
    window: string;
    stalled: (secs: number) => string;
    collapseMonitor: string;
    expandMonitor: string;
    etaLeft: (t: string) => string;
    queuedDash: string;
  };
  mediaView: {
    postsTab: string;
    mediaTab: string;
    count: (n: number) => string;
    newestFirst: string;
    oldestFirst: string;
    jumpToMonth: string;
    wheelDone: string;
    favorite: string;
    unfavorite: string;
    kindName: (k: string) => string;
    scrollToTop: string;
    scrollToBottom: string;
    loading: string;
    empty: string;
    select: string;
    cancel: string;
    selectedCount: (n: number) => string;
    deleteSelected: string;
    deleteConfirmTitle: (n: number) => string;
    deleteConfirmDesc: string;
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
    history: string;
    backToLibrary: string;
  };
  settingsHistory: {
    heading: string;
    desc: string;
    empty: string;
    clearButton: string;
    rebuildIndexLabel: string;
    rebuildIndexDesc: string;
    rebuildButton: string;
    rebuildDone: string;
    subscriptionsTarget: string;
    postsImported: (n: number) => string;
    creatorsScanned: (n: number) => string;
    statusRunning: string;
    statusSuccess: string;
    statusFailed: string;
    statusCancelled: string;
    statusInterrupted: string;
  };
  search: {
    placeholder: string;
    heading: string;
    empty: string;
    noResults: (q: string) => string;
    resultsCount: (n: number) => string;
  };
  workbench: {
    flipHint: string;
    zen: string;
    zenExit: string;
    syncPosts: string;
    downloadAssets: string;
    noPosts: string;
  };
  timeline: {
    heading: string;
    empty: string;
    pick: string;
    openInWorkbench: string;
  };
  commandPalette: {
    placeholder: string;
    groupCreators: string;
    groupPosts: string;
    groupCommands: string;
    empty: string;
    cmdSyncAll: string;
    cmdDownloads: string;
    cmdSettings: string;
    cmdSearch: string;
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
    layoutLabel: string;
    layoutDesc: string;
    layoutClassic: string;
    layoutWorkbench: string;
    colorThemeLabel: string;
    colorThemeDesc: string;
    themeName: (ct: string) => string;
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
    deleteModeLabel: string;
    deleteModeDesc: string;
    deleteModeTrash: string;
    deleteModeDirect: string;
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
    downloads: '下载',
    search: '搜索',
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
    videoHeading: (count) => `🎬 视频 (${count})`,
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
    publishedAt: (date) => `发布于 ${date}`,
    downloadedAt: (date) => `下载于 ${date}`,
    saveToDownloads: '保存到下载',
    close: '关闭 (Esc)',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏 (Esc)',
  },
  comments: {
    heading: (n) => `评论 (${n})`,
    refresh: '刷新',
    loading: '加载评论中…',
    empty: '暂无评论',
    notLoaded: '点击刷新加载评论',
    error: '评论加载失败',
    unknownAuthor: '匿名',
  },
  favorites: {
    title: '收藏',
    mediaTab: '媒体',
    postsTab: '帖子',
    countMedia: (n) => `${n} 张`,
    countPosts: (n) => `${n} 篇`,
    filterCreator: '按创作者筛选',
    allCreators: '全部创作者',
    sortBy: '排序方式',
    thumbnailSize: '缩略图大小',
    sortName: (k) => ({ favorited: '收藏时间', published: '发布日期', added: '下载日期', name: '文件名', size: '大小' }[k] ?? k),
    asc: '升序',
    desc: '降序',
    emptyMedia: '还没有收藏的图片 — 在媒体视图里点右上角星标',
    emptyPosts: '还没有收藏的帖子',
  },
  perfHud: {
    title: 'PERF',
    fps: 'FPS',
    frame: '帧时',
    heap: 'JS 内存',
    pressure: '渲染压力',
    processSection: '本进程 · 主进程+子进程',
    rss: 'RSS 内存',
    cpu: 'CPU',
    collapse: '折叠',
    expand: '展开',
    close: '关闭',
    settingLabel: '性能悬浮窗',
  },
  downloads: {
    backToLibrary: '返回书库',
    heading: '下载',
    countDownloading: (n) => `${n} 个下载中`,
    countQueued: (n) => `${n} 个排队中`,
    countFailed: (n) => `${n} 个失败`,
    countPaused: (n) => `${n} 个已暂停`,
    pauseAll: '全部暂停',
    resumeAll: '全部继续',
    retryAllFailed: '重试全部失败项',
    cancelAll: '全部取消',
    retry: '重试',
    remove: '移除',
    sectionDownloading: '下载中',
    sectionQueued: '排队中',
    sectionFailed: '失败',
    sectionPaused: '已暂停',
    pausedLabel: '已暂停',
    sectionCompleted: '已完成',
    clearCompleted: '清除已完成',
    empty: '还没有下载任务。先到创作者的帖子页发起图片下载。',
    network: '网络',
    diskWrite: '磁盘写入',
    window: '最近 60 秒',
    stalled: (secs) => `已 ${secs} 秒没有数据`,
    collapseMonitor: '收起吞吐图',
    expandMonitor: '展开吞吐图',
    etaLeft: (t) => `剩余 ${t}`,
    queuedDash: '—',
  },
  mediaView: {
    postsTab: '帖子',
    mediaTab: '媒体',
    count: (n) => `${n} 张`,
    newestFirst: '最新在前',
    oldestFirst: '最早在前',
    jumpToMonth: '跳到月份',
    wheelDone: '完成',
    favorite: '收藏',
    unfavorite: '取消收藏',
    kindName: (k) => ({ all: '全部', image: '图片', video: '视频', audio: '音频' }[k] ?? k),
    scrollToTop: '回到顶端',
    scrollToBottom: '跳到底端',
    loading: '加载中…',
    empty: '暂无已下载的图片。先在帖子页同步/下载图片后再来这里查看。',
    select: '选择',
    cancel: '取消',
    selectedCount: (n) => `已选 ${n} 张`,
    deleteSelected: '删除',
    deleteConfirmTitle: (n) => `删除 ${n} 张图片?`,
    deleteConfirmDesc: '将从磁盘移除这些图片文件(按设置移入废纸篓或直接删除),之后可随时重新下载。',
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
    history: '同步历史',
    backToLibrary: '返回库',
  },
  settingsHistory: {
    heading: '同步历史',
    desc: '每次同步的运行记录。数据可随时清空，不影响已抓取的帖子。',
    empty: '还没有同步记录。',
    clearButton: '清空历史',
    rebuildIndexLabel: '搜索索引',
    rebuildIndexDesc: '重建全局搜索索引（仅索引，帖子数据不受影响）。',
    rebuildButton: '重建索引',
    rebuildDone: '已重建',
    subscriptionsTarget: '全部订阅',
    postsImported: (n) => `+${n} 帖子`,
    creatorsScanned: (n) => `${n} 位创作者`,
    statusRunning: '进行中',
    statusSuccess: '成功',
    statusFailed: '失败',
    statusCancelled: '已取消',
    statusInterrupted: '已中断',
  },
  search: {
    placeholder: '搜索所有帖子…',
    heading: '搜索',
    empty: '输入关键词，搜索所有创作者的帖子标题和正文。',
    noResults: (q) => `没有匹配「${q}」的帖子。`,
    resultsCount: (n) => `${n} 条结果`,
  },
  workbench: {
    flipHint: '← → 翻页',
    zen: '专注阅读',
    zenExit: '返回',
    syncPosts: '同步',
    downloadAssets: '下载',
    noPosts: '还没有帖子——点「同步」抓取。',
  },
  timeline: {
    heading: '全部动态',
    empty: '还没有帖子。',
    pick: '从左侧选择一条帖子阅读。',
    openInWorkbench: '在工作台打开',
  },
  commandPalette: {
    placeholder: '跳转创作者、搜索帖子、执行命令…',
    groupCreators: '创作者',
    groupPosts: '帖子',
    groupCommands: '命令',
    empty: '没有匹配项',
    cmdSyncAll: '同步所有订阅',
    cmdDownloads: '打开下载',
    cmdSettings: '打开设置',
    cmdSearch: '打开搜索',
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
    dark: '深色',
    light: '浅色',
    system: '跟随系统',
    panelWidthLabel: '面板宽度',
    panelWidthValue: (sidebar, postList) => `侧栏 ${sidebar}px · 帖子列表 ${postList}px`,
    restoreDefault: '恢复默认宽度',
    layoutLabel: '布局',
    layoutDesc: '经典三栏,或工作台(侧边导航栏 + 阅读画布 + 底部作品胶片条)。',
    layoutClassic: '经典三栏',
    layoutWorkbench: '工作台',
    colorThemeLabel: '配色主题',
    colorThemeDesc: '为整个应用换一套配色。暗夜狼已可用;其余角色主题仍在打磨,收在开发者模式里。',
    themeName: (ct) => (({ 'default': '默认', 'reading-room': '阅读室', 'dhole': '豺 Dhole', 'nightwolf': '暗夜狼', 'azure-fox': '蓝狐' } as Record<string, string>)[ct] ?? ct),
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
    deleteModeLabel: '删除方式',
    deleteModeDesc: '在 Media 页删除图片时:移入废纸篓(可恢复),或直接永久删除。',
    deleteModeTrash: '移入废纸篓',
    deleteModeDirect: '直接删除',
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
    downloads: 'Downloads',
    search: 'Search',
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
    videoHeading: (count) => `🎬 Video (${count})`,
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
    publishedAt: (date) => `Published at ${date}`,
    downloadedAt: (date) => `Downloaded at ${date}`,
    saveToDownloads: 'Save to Downloads',
    close: 'Close (Esc)',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen (Esc)',
  },
  comments: {
    heading: (n) => `Comments (${n})`,
    refresh: 'Refresh',
    loading: 'Loading comments…',
    empty: 'No comments yet',
    notLoaded: 'Click Refresh to load comments',
    error: 'Failed to load comments',
    unknownAuthor: 'Anonymous',
  },
  favorites: {
    title: 'Favorites',
    mediaTab: 'Media',
    postsTab: 'Posts',
    countMedia: (n) => `${n} images`,
    countPosts: (n) => `${n} posts`,
    filterCreator: 'Filter by creator',
    allCreators: 'All creators',
    sortBy: 'Sort by',
    thumbnailSize: 'Thumbnail size',
    sortName: (k) => ({ favorited: 'Favorited', published: 'Published', added: 'Downloaded', name: 'Name', size: 'Size' }[k] ?? k),
    asc: 'Ascending',
    desc: 'Descending',
    emptyMedia: 'No favorited images yet — star one from the Media view',
    emptyPosts: 'No starred posts yet',
  },
  perfHud: {
    title: 'PERF',
    fps: 'FPS',
    frame: 'Frame',
    heap: 'JS Heap',
    pressure: 'Pressure',
    processSection: 'This process · main + children',
    rss: 'RSS',
    cpu: 'CPU',
    collapse: 'Collapse',
    expand: 'Expand',
    close: 'Close',
    settingLabel: 'Performance HUD',
  },
  downloads: {
    backToLibrary: 'Back to Library',
    heading: 'Downloads',
    countDownloading: (n) => `${n} downloading`,
    countQueued: (n) => `${n} queued`,
    countFailed: (n) => `${n} failed`,
    countPaused: (n) => `${n} paused`,
    pauseAll: 'Pause all',
    resumeAll: 'Resume all',
    retryAllFailed: 'Retry all failed',
    cancelAll: 'Cancel all',
    retry: 'Retry',
    remove: 'Remove',
    sectionDownloading: 'Downloading',
    sectionQueued: 'Queued',
    sectionFailed: 'Failed',
    sectionPaused: 'Paused',
    pausedLabel: 'Paused',
    sectionCompleted: 'Completed',
    clearCompleted: 'Clear completed',
    empty: "No downloads yet. Start an image download from a creator's Posts view.",
    network: 'Network',
    diskWrite: 'Disk write',
    window: 'last 60s',
    stalled: (secs) => `No bytes for ${secs}s`,
    collapseMonitor: 'Collapse throughput chart',
    expandMonitor: 'Show throughput chart',
    etaLeft: (t) => `${t} left`,
    queuedDash: '—',
  },
  mediaView: {
    postsTab: 'Posts',
    mediaTab: 'Media',
    count: (n) => `${n} image${n === 1 ? '' : 's'}`,
    newestFirst: 'Newest',
    oldestFirst: 'Oldest',
    jumpToMonth: 'Jump to month',
    wheelDone: 'Done',
    favorite: 'Favorite',
    unfavorite: 'Remove from favorites',
    kindName: (k) => ({ all: 'All', image: 'Images', video: 'Video', audio: 'Audio' }[k] ?? k),
    scrollToTop: 'Back to top',
    scrollToBottom: 'Jump to bottom',
    loading: 'Loading…',
    empty: 'No downloaded images yet. Sync/download images from the Posts view first.',
    select: 'Select',
    cancel: 'Cancel',
    selectedCount: (n) => `${n} selected`,
    deleteSelected: 'Delete',
    deleteConfirmTitle: (n) => `Delete ${n} image${n === 1 ? '' : 's'}?`,
    deleteConfirmDesc: 'The image files will be removed from disk (moved to Trash or deleted, per your settings) and can be re-downloaded anytime.',
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
    history: 'Sync History',
    backToLibrary: 'Back to Library',
  },
  settingsHistory: {
    heading: 'Sync History',
    desc: 'A log of each sync run. Safe to clear anytime — scraped posts are untouched.',
    empty: 'No sync runs yet.',
    clearButton: 'Clear history',
    rebuildIndexLabel: 'Search index',
    rebuildIndexDesc: 'Rebuild the global search index (index only — post data is untouched).',
    rebuildButton: 'Rebuild index',
    rebuildDone: 'Rebuilt',
    subscriptionsTarget: 'All subscriptions',
    postsImported: (n) => `+${n} posts`,
    creatorsScanned: (n) => `${n} creators`,
    statusRunning: 'Running',
    statusSuccess: 'Success',
    statusFailed: 'Failed',
    statusCancelled: 'Cancelled',
    statusInterrupted: 'Interrupted',
  },
  search: {
    placeholder: 'Search all posts…',
    heading: 'Search',
    empty: 'Type to search post titles and content across all creators.',
    noResults: (q) => `No posts match "${q}".`,
    resultsCount: (n) => `${n} results`,
  },
  workbench: {
    flipHint: '← → to flip',
    zen: 'Zen',
    zenExit: 'Back',
    syncPosts: 'Sync',
    downloadAssets: 'Download',
    noPosts: 'No posts yet — hit Sync to fetch them.',
  },
  timeline: {
    heading: 'All activity',
    empty: 'No posts yet.',
    pick: 'Pick an entry on the left to read.',
    openInWorkbench: 'Open in workbench',
  },
  commandPalette: {
    placeholder: 'Jump to a creator, search posts, run a command…',
    groupCreators: 'Creators',
    groupPosts: 'Posts',
    groupCommands: 'Commands',
    empty: 'No matches',
    cmdSyncAll: 'Sync all subscriptions',
    cmdDownloads: 'Open Downloads',
    cmdSettings: 'Open Settings',
    cmdSearch: 'Open Search',
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
    dark: 'Dark',
    light: 'Light',
    system: 'System',
    panelWidthLabel: 'Panel Width',
    panelWidthValue: (sidebar, postList) => `Sidebar ${sidebar}px · Post list ${postList}px`,
    restoreDefault: 'Restore Default Width',
    layoutLabel: 'Layout',
    layoutDesc: 'Classic three panes, or Workbench (icon rail + reading canvas + a filmstrip dock of the creator’s posts).',
    layoutClassic: 'Classic 3-pane',
    layoutWorkbench: 'Workbench',
    colorThemeLabel: 'Color theme',
    colorThemeDesc: 'Recolor the whole app. Nightwolf is ready to use; the other character themes are still being polished and live under Developer Mode.',
    themeName: (ct) => (({ 'default': 'Default', 'reading-room': 'Reading Room', 'dhole': 'Dhole', 'nightwolf': 'Nightwolf', 'azure-fox': 'Azure Fox' } as Record<string, string>)[ct] ?? ct),
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
    deleteModeLabel: 'Delete mode',
    deleteModeDesc: 'When deleting images in the Media view: move to Trash (recoverable), or delete permanently.',
    deleteModeTrash: 'Move to Trash',
    deleteModeDirect: 'Delete directly',
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
