//! Prints Needle's verdict for each file, under Normal and Strict:
//! `cargo run -p needle-core --release --example verify -- <file>...`

use std::path::Path;
use std::time::Instant;

use needle_core::model::{Strictness, Tier};
use needle_core::verify::verify_file;

fn main() {
    // Any codec, so only the spectrum and bitrate can fail. 256 kbps puts lossy
    // files on the 320/V0 thresholds.
    let tier = Tier {
        label: "any".into(),
        codecs: vec![],
        min_bit_depth: None,
        min_sample_rate: None,
        min_bitrate_kbps: Some(256),
        allow_vbr: true,
    };
    for arg in std::env::args().skip(1) {
        let path = Path::new(&arg);
        let start = Instant::now();
        let normal = verify_file(path, &tier, Strictness::Normal);
        let took = start.elapsed();
        match (normal, verify_file(path, &tier, Strictness::Strict)) {
            (Ok(n), Ok(s)) => println!(
                "{:<4} {:<4} {:?} {}Hz {}bit {}kbps cutoff={} {:.0}ms {} | {}",
                if n.ok { "ok" } else { "FAIL" },
                if s.ok { "ok" } else { "FAIL" },
                n.codec,
                n.sample_rate.unwrap_or(0),
                n.bit_depth.map_or("-".into(), |b| b.to_string()),
                n.bitrate_kbps.unwrap_or(0),
                n.cutoff_hz
                    .map_or("none".into(), |c| format!("{:.1}k", c / 1000.0)),
                took.as_secs_f64() * 1000.0,
                s.reason.or(n.reason).unwrap_or_default(),
                arg,
            ),
            (Err(e), _) | (_, Err(e)) => println!("ERR  {e} | {arg}"),
        }
    }
}
