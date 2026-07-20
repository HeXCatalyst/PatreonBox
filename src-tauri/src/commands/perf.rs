use std::collections::HashSet;
use std::sync::Mutex;
use sysinfo::{get_current_pid, Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// A persistent `System` so `cpu_usage()` can be computed as the delta between
/// polls (a single refresh always reports 0% CPU).
pub struct SysState(pub Mutex<System>);

#[derive(serde::Serialize)]
pub struct ProcessStats {
    /// Resident memory of this app's process tree, in MB.
    rss_mb: f64,
    /// CPU usage of the tree as a percentage of one core (may exceed 100 on
    /// multi-core); `cores` lets the UI normalise to 0–100%.
    cpu_percent: f32,
    cores: usize,
    /// How many processes were summed (main + webview/helper children).
    process_count: usize,
}

/// Cumulative disk I/O for this app's process tree, in bytes since each process
/// started.
///
/// Deliberately cumulative rather than per-interval. sysinfo's `written_bytes`
/// counts only what happened since the last refresh of the shared `System`, so
/// its value depends on which caller refreshed last — with both the perf HUD and
/// the Downloads monitor polling the same state on different cadences, that
/// reading is meaningless. Totals are monotonic and caller-independent, so each
/// consumer can divide by its own elapsed time and get a correct rate.
#[derive(serde::Serialize)]
pub struct DiskIoStats {
    total_written_bytes: u64,
    total_read_bytes: u64,
}

/// Collect this process and every descendant (the WebView/helper processes).
/// Repeats until no new children are found, since `processes()` is unordered and
/// a grandchild may be visited before its parent has joined the set.
fn process_tree(sys: &System) -> HashSet<Pid> {
    let mut tree: HashSet<Pid> = HashSet::new();
    if let Ok(me) = get_current_pid() {
        tree.insert(me);
    }
    loop {
        let mut added = false;
        for (pid, proc_) in sys.processes() {
            if !tree.contains(pid) {
                if let Some(parent) = proc_.parent() {
                    if tree.contains(&parent) {
                        tree.insert(*pid);
                        added = true;
                    }
                }
            }
        }
        if !added {
            break;
        }
    }
    tree
}

/// This app's own resource usage — the main process plus its descendant
/// processes (the WebView/helper processes), NOT the whole system.
#[tauri::command]
pub fn process_stats(state: tauri::State<SysState>) -> ProcessStats {
    let mut sys = state.0.lock().unwrap_or_else(|e| e.into_inner());
    // Refresh CPU deltas + memory for every process (needed to walk the tree).
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let tree = process_tree(&sys);

    let mut rss: u64 = 0;
    let mut cpu: f32 = 0.0;
    for pid in &tree {
        if let Some(p) = sys.process(*pid) {
            rss += p.memory(); // bytes (sysinfo 0.30+)
            cpu += p.cpu_usage();
        }
    }

    ProcessStats {
        rss_mb: rss as f64 / 1_048_576.0,
        cpu_percent: cpu,
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        process_count: tree.len(),
    }
}

/// Bytes this app's process tree has written to / read from disk since start.
/// Powers the Downloads page's disk-write line, which is compared against
/// network throughput to spot bytes arriving but not landing on disk.
#[tauri::command]
pub fn disk_io_stats(state: tauri::State<SysState>) -> DiskIoStats {
    let mut sys = state.0.lock().unwrap_or_else(|e| e.into_inner());
    // Disk usage only. The Downloads page polls this every second for as long as
    // it's open, and a plain `refresh_processes` re-reads cmdline, environment,
    // cwd, memory and CPU for every process on the machine — a lot of work to
    // throw away when all we want is one counter. `new()` starts with every
    // refresh disabled, so this asks for precisely the field we read below.
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_disk_usage(),
    );

    let mut written: u64 = 0;
    let mut read: u64 = 0;
    for pid in &process_tree(&sys) {
        if let Some(p) = sys.process(*pid) {
            let io = p.disk_usage();
            written += io.total_written_bytes;
            read += io.total_read_bytes;
        }
    }

    DiskIoStats { total_written_bytes: written, total_read_bytes: read }
}
