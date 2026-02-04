use std::collections::HashMap;
use std::env;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use anyhow::Result;
#[cfg(not(windows))]
use portable_pty::native_pty_system;
use portable_pty::CommandBuilder;
use portable_pty::PtySize;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::process::ChildTerminator;
use crate::process::ProcessHandle;
use crate::process::PtyHandles;
use crate::process::SpawnedProcess;

/// Returns true when ConPTY support is available (Windows only).
#[cfg(windows)]
pub fn conpty_supported() -> bool {
    crate::win::conpty_supported()
}

/// Returns true when ConPTY support is available (non-Windows always true).
#[cfg(not(windows))]
pub fn conpty_supported() -> bool {
    true
}

struct PtyChildTerminator {
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

impl ChildTerminator for PtyChildTerminator {
    fn kill(&mut self) -> std::io::Result<()> {
        self.killer.kill()
    }
}

fn platform_native_pty_system() -> Box<dyn portable_pty::PtySystem + Send> {
    #[cfg(windows)]
    {
        Box::new(crate::win::ConPtySystem::default())
    }

    #[cfg(not(windows))]
    {
        native_pty_system()
    }
}

fn parse_env_size() -> Option<(u16, u16)> {
    let rows = env::var("LINES").ok()?.parse::<u16>().ok()?;
    let cols = env::var("COLUMNS").ok()?.parse::<u16>().ok()?;
    if rows == 0 || cols == 0 {
        return None;
    }
    Some((rows, cols))
}

#[cfg(unix)]
fn detect_terminal_size() -> Option<(u16, u16)> {
    detect_terminal_size_from_fd(libc::STDOUT_FILENO)
        .or_else(|| detect_terminal_size_from_fd(libc::STDIN_FILENO))
        .or_else(parse_env_size)
}

#[cfg(unix)]
fn detect_terminal_size_from_fd(fd: libc::c_int) -> Option<(u16, u16)> {
    let mut winsize = libc::winsize {
        ws_row: 0,
        ws_col: 0,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let result = unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, &mut winsize) };
    if result != 0 || winsize.ws_row == 0 || winsize.ws_col == 0 {
        return None;
    }
    Some((winsize.ws_row, winsize.ws_col))
}

#[cfg(windows)]
fn detect_terminal_size() -> Option<(u16, u16)> {
    use winapi::um::winbase::GetStdHandle;
    use winapi::um::winbase::STD_OUTPUT_HANDLE;
    use winapi::um::wincon::GetConsoleScreenBufferInfo;
    use winapi::um::wincon::CONSOLE_SCREEN_BUFFER_INFO;

    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        if handle.is_null() {
            return parse_env_size();
        }
        let mut info: CONSOLE_SCREEN_BUFFER_INFO = std::mem::zeroed();
        if GetConsoleScreenBufferInfo(handle, &mut info) == 0 {
            return parse_env_size();
        }
        let cols = info.srWindow.Right.saturating_sub(info.srWindow.Left) + 1;
        let rows = info.srWindow.Bottom.saturating_sub(info.srWindow.Top) + 1;
        let rows = u16::try_from(rows).ok()?;
        let cols = u16::try_from(cols).ok()?;
        if rows == 0 || cols == 0 {
            return parse_env_size();
        }
        Some((rows, cols))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::OnceLock;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = env::var(key).ok();
            env::set_var(key, value);
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(prev) = self.prev.take() {
                env::set_var(self.key, prev);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn parse_env_size_reads_lines_and_columns() {
        let _lock = env_lock().lock().unwrap();
        let _lines = EnvVarGuard::set("LINES", "42");
        let _cols = EnvVarGuard::set("COLUMNS", "120");

        assert_eq!(parse_env_size(), Some((42, 120)));
    }

    #[cfg(unix)]
    fn detect_terminal_size_with_provider<F>(provider: F) -> Option<(u16, u16)>
    where
        F: Fn(libc::c_int) -> Option<(u16, u16)> + Copy,
    {
        detect_terminal_size_from_fd_with(libc::STDOUT_FILENO, provider)
            .or_else(|| detect_terminal_size_from_fd_with(libc::STDIN_FILENO, provider))
            .or_else(parse_env_size)
    }

    #[cfg(unix)]
    fn detect_terminal_size_from_fd_with<F>(fd: libc::c_int, provider: F) -> Option<(u16, u16)>
    where
        F: Fn(libc::c_int) -> Option<(u16, u16)>,
    {
        provider(fd)
    }

    #[cfg(unix)]
    #[test]
    fn detect_terminal_size_uses_ioctl_when_available() {
        let _lock = env_lock().lock().unwrap();
        let _lines = EnvVarGuard::set("LINES", "10");
        let _cols = EnvVarGuard::set("COLUMNS", "20");

        let size = detect_terminal_size_with_provider(|fd| {
            if fd == libc::STDOUT_FILENO {
                Some((40, 100))
            } else {
                None
            }
        });

        assert_eq!(size, Some((40, 100)));
    }
}

/// Spawn a process attached to a PTY, returning handles for stdin, output, and exit.
pub async fn spawn_process(
    program: &str,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
    arg0: &Option<String>,
    size: Option<(u16, u16)>,
) -> Result<SpawnedProcess> {
    if program.is_empty() {
        anyhow::bail!("missing program for PTY spawn");
    }

    let pty_system = platform_native_pty_system();
    let size = size
        .or_else(detect_terminal_size)
        .ok_or_else(|| anyhow::anyhow!("missing terminal size; set rows/cols or LINES/COLUMNS"))?;
    let size = PtySize {
        rows: size.0.max(1),
        cols: size.1.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: size.pixel_width,
        pixel_height: size.pixel_height,
    })?;

    let mut command_builder = CommandBuilder::new(arg0.as_ref().unwrap_or(&program.to_string()));
    command_builder.cwd(cwd);
    command_builder.env_clear();
    for arg in args {
        command_builder.arg(arg);
    }
    for (key, value) in env {
        command_builder.env(key, value);
    }

    let mut child = pair.slave.spawn_command(command_builder)?;
    let killer = child.clone_killer();

    let (writer_tx, mut writer_rx) = mpsc::channel::<Vec<u8>>(128);
    let (output_tx, _) = broadcast::channel::<Vec<u8>>(256);
    let initial_output_rx = output_tx.subscribe();

    let mut reader = pair.master.try_clone_reader()?;
    let output_tx_clone = output_tx.clone();
    let reader_handle: JoinHandle<()> = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8_192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = output_tx_clone.send(buf[..n].to_vec());
                }
                Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(_) => break,
            }
        }
    });

    let writer = pair.master.take_writer()?;
    let writer = Arc::new(tokio::sync::Mutex::new(writer));
    let writer_handle: JoinHandle<()> = tokio::spawn({
        let writer = Arc::clone(&writer);
        async move {
            while let Some(bytes) = writer_rx.recv().await {
                let mut guard = writer.lock().await;
                use std::io::Write;
                let _ = guard.write_all(&bytes);
                let _ = guard.flush();
            }
        }
    });

    let (exit_tx, exit_rx) = oneshot::channel::<i32>();
    let exit_status = Arc::new(AtomicBool::new(false));
    let wait_exit_status = Arc::clone(&exit_status);
    let exit_code = Arc::new(StdMutex::new(None));
    let wait_exit_code = Arc::clone(&exit_code);
    let wait_handle: JoinHandle<()> = tokio::task::spawn_blocking(move || {
        let code = match child.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(_) => -1,
        };
        wait_exit_status.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut guard) = wait_exit_code.lock() {
            *guard = Some(code);
        }
        let _ = exit_tx.send(code);
    });

    let handles = PtyHandles {
        _slave: if cfg!(windows) {
            Some(pair.slave)
        } else {
            None
        },
        _master: pair.master,
    };

    let (handle, output_rx) = ProcessHandle::new(
        writer_tx,
        output_tx,
        initial_output_rx,
        Box::new(PtyChildTerminator { killer }),
        reader_handle,
        Vec::new(),
        writer_handle,
        wait_handle,
        exit_status,
        exit_code,
        Some(handles),
    );

    Ok(SpawnedProcess {
        session: handle,
        output_rx,
        exit_rx,
    })
}
