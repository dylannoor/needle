//! Best-effort UPnP port mapping for the listen port, renewed every half lease
//! and removed when the mapper is dropped.
// ponytail: UPnP only; add NAT-PMP (soulseek-rs/src/port_mapping/nat_pmp.rs) if routers without UPnP matter.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use igd_next::{PortMappingProtocol, SearchOptions, search_gateway};

const LEASE_SECS: u32 = 3600;

pub struct PortMapper {
    stop: Arc<AtomicBool>,
}

impl Drop for PortMapper {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl PortMapper {
    /// Map `port` on a thread and report whether it worked through `done`.
    pub fn spawn(port: u16, done: impl FnOnce(bool) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        thread::spawn(move || run(port, &flag, done));
        Self { stop }
    }
}

fn local_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 53)).ok()?;
    Some(socket.local_addr().ok()?.ip())
}

fn run(port: u16, stop: &AtomicBool, done: impl FnOnce(bool)) {
    let options = SearchOptions {
        timeout: Some(Duration::from_secs(5)),
        ..SearchOptions::default()
    };
    let (Ok(gateway), Some(ip)) = (search_gateway(options), local_ip()) else {
        done(false);
        return;
    };
    let local = SocketAddr::new(ip, port);
    let map = || {
        gateway
            .add_port(PortMappingProtocol::TCP, port, local, LEASE_SECS, "Needle")
            .is_ok()
    };
    done(map());
    let mut renewed = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(500));
        if renewed.elapsed() >= Duration::from_secs(u64::from(LEASE_SECS / 2)) {
            map();
            renewed = Instant::now();
        }
    }
    let _ = gateway.remove_port(PortMappingProtocol::TCP, port);
}
