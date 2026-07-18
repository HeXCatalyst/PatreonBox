use std::collections::HashSet;
use std::sync::Mutex;
use sysinfo::{get_current_pid, Pid, ProcessesToUpdate, System};

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

/// This app's own resource usage — the main process plus its descendant
/// processes (the WebView/helper processes), NOT the whole system.
#[tauri::command]
pub fn process_stats(state: tauri::State<SysState>) -> ProcessStats {
    let mut sys = state.0.lock().unwrap_or_else(|e| e.into_inner());
    // Refresh CPU deltas + memory for every process (needed to walk the tree).
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut tree: HashSet<Pid> = HashSet::new();
    if let Ok(me) = get_current_pid() {
        tree.insert(me);
    }
    // Grow the set to include all descendants of our process.
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
