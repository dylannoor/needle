//! Checks that a downloaded file is what it claims to be: header first, then
//! the spectrum, so a transcode saved as FLAC gets caught.

use std::fs::File;
use std::path::Path;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::audio::well_known::{
    CODEC_ID_AAC, CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP3, CODEC_ID_OPUS, CODEC_ID_VORBIS,
};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::model::{Codec, Strictness, Tier, Verdict};

const FFT_SIZE: usize = 4096;
const BANDS: usize = 64;
/// Windows analyzed per track, spread evenly across it.
const MAX_WINDOWS: usize = 120;
/// Windows quieter than this (mean square, about -70 dBFS) are skipped.
const SILENCE: f32 = 1e-7;
const FLOOR_DB: f32 = -120.0;
/// A cliff is at least this deep within 1 kHz (measured 500 Hz either side).
const MIN_DROP_DB: f32 = 25.0;

#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("could not open {0}: {1}")]
    Open(String, String),
    #[error("could not decode: {0}")]
    Decode(String),
}

/// What the spectrum says, independent of any header.
#[derive(Debug, Clone, PartialEq)]
pub struct SpectrumReport {
    /// 64 bands from 0 Hz to Nyquist in dB, the loudest band at 0.
    pub spectrum: Vec<f32>,
    /// Where the content falls off a brick wall, if it clearly does.
    pub cutoff_hz: Option<f32>,
}

/// Inspect `path` against the tier it was downloaded for.
pub fn verify_file(
    path: &Path,
    tier: &Tier,
    strictness: Strictness,
) -> Result<Verdict, VerifyError> {
    let file = decode(path)?;
    let reason = header_reason(&file, tier)
        .or_else(|| {
            spectral_reason(
                file.codec,
                file.sample_rate,
                file.report.cutoff_hz,
                strictness,
                tier,
                file.bitrate_kbps,
            )
        })
        .or_else(|| {
            (strictness == Strictness::Strict && file.padded_from_16).then(|| {
                format!(
                    "16-bit audio padded to {}-bit",
                    file.bit_depth.unwrap_or(24)
                )
            })
        });
    Ok(Verdict {
        ok: reason.is_none(),
        codec: file.codec,
        sample_rate: Some(file.sample_rate),
        bit_depth: file.bit_depth,
        bitrate_kbps: file.bitrate_kbps,
        cutoff_hz: file.report.cutoff_hz,
        nyquist_hz: file.sample_rate as f32 / 2.0,
        reason,
        spectrum: file.report.spectrum,
    })
}

/// Spectrum and cutoff of mono samples. Long inputs are sampled at most
/// `MAX_WINDOWS` windows, like a decoded file.
pub fn analyze_samples(samples: &[f32], sample_rate: u32) -> SpectrumReport {
    let mut analyzer = Analyzer::new(Some(samples.len() as u64));
    for &s in samples {
        analyzer.push(s);
    }
    analyzer.finish(sample_rate)
}

struct Decoded {
    codec: Codec,
    sample_rate: u32,
    bit_depth: Option<u32>,
    bitrate_kbps: Option<u32>,
    /// Only known for MP3, where CBR frames all have the same size.
    vbr: Option<bool>,
    /// A >16-bit file whose samples all sit on the 16-bit grid.
    padded_from_16: bool,
    report: SpectrumReport,
}

fn decode(path: &Path) -> Result<Decoded, VerifyError> {
    let decode_err = |e: SymphoniaError| VerifyError::Decode(e.to_string());
    let file = File::open(path)
        .map_err(|e| VerifyError::Open(path.display().to_string(), e.to_string()))?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(decode_err)?;
    let container = format.format_info().short_name;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| VerifyError::Decode("no audio track".into()))?;
    let (track_id, total_frames) = (track.id, track.num_frames);
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| VerifyError::Decode("no audio codec parameters".into()))?
        .clone();
    let sample_rate = params
        .sample_rate
        .ok_or_else(|| VerifyError::Decode("unknown sample rate".into()))?;

    let id = params.codec;
    let codec = if id == CODEC_ID_FLAC {
        Codec::Flac
    } else if id == CODEC_ID_ALAC {
        Codec::Alac
    } else if id == CODEC_ID_MP3 {
        Codec::Mp3
    } else if id == CODEC_ID_AAC {
        Codec::Aac
    } else if id == CODEC_ID_VORBIS {
        Codec::Ogg
    } else if id == CODEC_ID_OPUS {
        Codec::Opus
    } else {
        match container {
            "wave" => Codec::Wav,
            "aiff" => Codec::Aiff,
            _ => Codec::Other,
        }
    };
    let bit_depth = if is_lossless(codec) {
        params.bits_per_sample
    } else {
        None
    };

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(decode_err)?;
    let mut analyzer = Analyzer::new(total_frames);
    let mut samples: Vec<f32> = Vec::new();
    let mut mp3_frame_sizes = Vec::new();
    let (mut frames, mut bytes) = (0u64, 0u64);
    let (mut on_16_grid, mut nonzero) = (bit_depth.is_some_and(|b| b > 16), false);

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            // A damaged tail still leaves plenty to judge.
            Err(_) if frames > 0 => break,
            Err(e) => return Err(decode_err(e)),
        };
        if packet.track_id != track_id {
            continue;
        }
        bytes += packet.data.len() as u64;
        if codec == Codec::Mp3 {
            mp3_frame_sizes.push(packet.data.len());
        }
        let buf = match decoder.decode(&packet) {
            Ok(buf) => buf,
            Err(SymphoniaError::DecodeError(_) | SymphoniaError::IoError(_)) => continue,
            Err(e) => return Err(decode_err(e)),
        };
        let channels = buf.spec().channels().count().max(1);
        buf.copy_to_vec_interleaved(&mut samples);
        frames += (samples.len() / channels) as u64;
        if on_16_grid {
            // Decoders scale to [-1, 1), so a 16-bit value is a multiple of 2^-15.
            on_16_grid = samples.iter().all(|s| (s * 32768.0).fract() == 0.0);
            nonzero |= samples.iter().any(|&s| s != 0.0);
        }
        for frame in samples.chunks_exact(channels) {
            analyzer.push(frame.iter().sum::<f32>() / channels as f32);
        }
    }
    if frames == 0 {
        return Err(VerifyError::Decode("no audio decoded".into()));
    }

    let secs = frames as f64 / f64::from(sample_rate);
    Ok(Decoded {
        codec,
        sample_rate,
        bit_depth,
        bitrate_kbps: Some((bytes as f64 * 8.0 / secs / 1000.0).round() as u32),
        vbr: (codec == Codec::Mp3).then(|| is_vbr(&mut mp3_frame_sizes)),
        padded_from_16: on_16_grid && nonzero,
        report: analyzer.finish(sample_rate),
    })
}

/// CBR frames differ by at most the padding byte; VBR frames vary widely.
fn is_vbr(sizes: &mut [usize]) -> bool {
    if sizes.is_empty() {
        return false;
    }
    sizes.sort_unstable();
    let median = sizes[sizes.len() / 2];
    let off = sizes.iter().filter(|&&s| s.abs_diff(median) > 2).count();
    off * 50 > sizes.len()
}

fn header_reason(file: &Decoded, tier: &Tier) -> Option<String> {
    if !tier.codecs.is_empty() && !tier.codecs.contains(&file.codec) {
        let wanted: Vec<&str> = tier.codecs.iter().map(|&c| codec_name(c)).collect();
        return Some(format!(
            "Header says {}, not {}",
            codec_name(file.codec),
            wanted.join(" or ")
        ));
    }
    if let (Some(min), Some(bits)) = (tier.min_bit_depth, file.bit_depth)
        && bits < min
    {
        return Some(format!("{bits}-bit, the profile asks for {min}-bit"));
    }
    if let Some(min) = tier.min_sample_rate
        && file.sample_rate < min
    {
        return Some(format!(
            "{}, the profile asks for {}",
            khz(file.sample_rate),
            khz(min)
        ));
    }
    if let (Some(min), Some(kbps)) = (tier.min_bitrate_kbps, file.bitrate_kbps)
        && !is_lossless(file.codec)
    {
        if file.vbr == Some(true) && !tier.allow_vbr {
            return Some(format!(
                "VBR around {kbps} kbps, the profile asks for {min} kbps constant bitrate"
            ));
        }
        // 3% slack for rounding and stray frames.
        if kbps * 100 < min * 97 {
            return Some(format!("{kbps} kbps, the profile asks for {min} kbps"));
        }
    }
    None
}

fn spectral_reason(
    codec: Codec,
    sample_rate: u32,
    cutoff_hz: Option<f32>,
    strictness: Strictness,
    tier: &Tier,
    bitrate_kbps: Option<u32>,
) -> Option<String> {
    let cut = cutoff_hz?;
    let lossless = is_lossless(codec);
    let min_hz = match strictness {
        Strictness::Relaxed => return None,
        Strictness::Normal if lossless => 19_000.0,
        Strictness::Strict if lossless => 20_000.0,
        Strictness::Normal => 16_000.0,
        // 320 and V0 keep content up to 19.5-20 kHz; lower tiers stop earlier.
        Strictness::Strict if tier.min_bitrate_kbps.unwrap_or(0) >= 256 => 19_000.0,
        Strictness::Strict => 16_000.0,
    };
    if cut < min_hz {
        let saved_as = match bitrate_kbps {
            Some(kbps) if !lossless => format!("a {kbps} kbps {}", codec_name(codec)),
            _ => codec_name(codec).to_string(),
        };
        return Some(format!(
            "Stops at {:.1} kHz, the signature of {} saved as {saved_as}",
            cut / 1000.0,
            lossy_source(cut)
        ));
    }
    if lossless && sample_rate >= 88_200 && cut <= 24_500.0 {
        return Some("Upsampled from CD quality: nothing above 22 kHz".into());
    }
    None
}

/// Typical encoder lowpass per bitrate (LAME and older encoders).
fn lossy_source(cut_hz: f32) -> &'static str {
    match cut_hz {
        c if c < 15_500.0 => "an MP3 under 128 kbps",
        c if c < 16_800.0 => "a 128 to 192 kbps MP3",
        c if c < 18_200.0 => "a 128 to 160 kbps MP3",
        c if c < 19_800.0 => "a 192 to 256 kbps MP3 or AAC",
        _ => "a 256 to 320 kbps MP3",
    }
}

fn is_lossless(codec: Codec) -> bool {
    matches!(codec, Codec::Flac | Codec::Alac | Codec::Wav | Codec::Aiff)
}

fn codec_name(codec: Codec) -> &'static str {
    match codec {
        Codec::Flac => "FLAC",
        Codec::Alac => "ALAC",
        Codec::Wav => "WAV",
        Codec::Aiff => "AIFF",
        Codec::Mp3 => "MP3",
        Codec::Aac => "AAC",
        Codec::Ogg => "Ogg Vorbis",
        Codec::Opus => "Opus",
        Codec::Other => "an unknown format",
    }
}

fn khz(hz: u32) -> String {
    if hz.is_multiple_of(1000) {
        format!("{} kHz", hz / 1000)
    } else {
        format!("{:.1} kHz", hz as f32 / 1000.0)
    }
}

/// Averages the power spectrum of every `stride`-th window of a mono stream.
struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    hann: Vec<f32>,
    frame: Vec<f32>,
    scratch: Vec<Complex<f32>>,
    power: Vec<f64>,
    used: usize,
    pos: usize,
    window: usize,
    stride: usize,
}

impl Analyzer {
    fn new(total_frames: Option<u64>) -> Self {
        let windows = total_frames.map_or(0, |n| n as usize / FFT_SIZE);
        let hann = (0..FFT_SIZE)
            .map(|i| {
                (std::f32::consts::PI * i as f32 / FFT_SIZE as f32)
                    .sin()
                    .powi(2)
            })
            .collect();
        Self {
            fft: FftPlanner::new().plan_fft_forward(FFT_SIZE),
            hann,
            frame: Vec::with_capacity(FFT_SIZE),
            scratch: vec![Complex::default(); FFT_SIZE],
            power: vec![0.0; FFT_SIZE / 2 + 1],
            used: 0,
            pos: 0,
            window: 0,
            stride: (windows / MAX_WINDOWS).max(1),
        }
    }

    fn push(&mut self, sample: f32) {
        if self.window.is_multiple_of(self.stride) {
            self.frame.push(sample);
        }
        self.pos += 1;
        if self.pos == FFT_SIZE {
            if !self.frame.is_empty() {
                self.analyze_frame();
                self.frame.clear();
            }
            self.pos = 0;
            self.window += 1;
        }
    }

    fn analyze_frame(&mut self) {
        let energy = self.frame.iter().map(|s| s * s).sum::<f32>() / FFT_SIZE as f32;
        if energy < SILENCE {
            return;
        }
        for (c, (s, w)) in self
            .scratch
            .iter_mut()
            .zip(self.frame.iter().zip(&self.hann))
        {
            *c = Complex::new(s * w, 0.0);
        }
        self.fft.process(&mut self.scratch);
        for (p, c) in self.power.iter_mut().zip(&self.scratch) {
            *p += f64::from(c.norm_sqr());
        }
        self.used += 1;
    }

    fn finish(self, sample_rate: u32) -> SpectrumReport {
        if self.used == 0 {
            return SpectrumReport {
                spectrum: vec![FLOOR_DB; BANDS],
                cutoff_hz: None,
            };
        }
        let used = self.used as f64;
        let to_db = |p: f64| (10.0 * (p / used + 1e-20).log10()) as f32;
        let bins = self.power.len();
        let mut spectrum: Vec<f32> = (0..BANDS)
            .map(|b| {
                let lo = b * bins / BANDS;
                let hi = ((b + 1) * bins / BANDS).max(lo + 1);
                to_db(self.power[lo..hi].iter().sum::<f64>() / (hi - lo) as f64)
            })
            .collect();
        let loudest = spectrum.iter().copied().fold(f32::MIN, f32::max);
        for v in &mut spectrum {
            *v = (*v - loudest).max(FLOOR_DB);
        }
        let db: Vec<f32> = self.power.iter().map(|&p| to_db(p)).collect();
        SpectrumReport {
            spectrum,
            cutoff_hz: detect_cutoff(&db, sample_rate),
        }
    }
}

/// The frequency where content ends at a brick wall, or `None` when there is
/// no clear wall below 0.97 x Nyquist or too little high end to judge.
fn detect_cutoff(db: &[f32], sample_rate: u32) -> Option<f32> {
    let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
    let bin = |hz: f32| ((hz / bin_hz) as usize).min(db.len() - 1);
    let s = smooth(db, bin(100.0).max(1));
    let reference = median(&s[bin(2_000.0)..bin(8_000.0)]);
    let d = bin(500.0).max(2);
    let top = bin(0.97 * sample_rate as f32 / 2.0);
    let (lo, hi) = (bin(9_000.0).max(d), top.saturating_sub(d));
    let (edge, drop) = (lo..hi)
        .map(|i| (i, s[i - d] - s[i + d]))
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    let below = s[edge - d];
    let above = s[edge + d..=top].iter().sum::<f32>() / (top + 1 - edge - d) as f32;
    // Not deep enough, too quiet up there to tell, or content comes back.
    if drop < MIN_DROP_DB || below < reference - 50.0 || above > below - 20.0 {
        return None;
    }
    let cut = (edge - d..=edge + d).find(|&i| s[i] < below - 10.0)?;
    Some(cut as f32 * bin_hz)
}

fn smooth(v: &[f32], half: usize) -> Vec<f32> {
    (0..v.len())
        .map(|i| {
            let w = &v[i.saturating_sub(half)..(i + half + 1).min(v.len())];
            w.iter().sum::<f32>() / w.len() as f32
        })
        .collect()
}

fn median(v: &[f32]) -> f32 {
    let mut v = v.to_vec();
    v.sort_by(f32::total_cmp);
    v[v.len() / 2]
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    const SR: u32 = 44_100;
    const LEN: usize = 1 << 19;

    fn white(len: usize, seed: u64) -> Vec<f32> {
        let mut x = seed | 1;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 40) as f32 / (1u64 << 24) as f32 - 0.5
            })
            .collect()
    }

    /// Scales every frequency of `samples` by `gain(hz)`: an ideal filter.
    fn shape(samples: &[f32], sample_rate: u32, gain: impl Fn(f32) -> f32) -> Vec<f32> {
        let n = samples.len();
        let mut planner = FftPlanner::new();
        let mut buf: Vec<Complex<f32>> = samples.iter().map(|&s| Complex::new(s, 0.0)).collect();
        planner.plan_fft_forward(n).process(&mut buf);
        for (i, c) in buf.iter_mut().enumerate() {
            *c *= gain(i.min(n - i) as f32 * sample_rate as f32 / n as f32);
        }
        planner.plan_fft_inverse(n).process(&mut buf);
        buf.iter().map(|c| c.re / n as f32).collect()
    }

    fn pink(hz: f32) -> f32 {
        (20.0 / hz.max(20.0)).sqrt()
    }

    fn wall(at: f32) -> impl Fn(f32) -> f32 {
        move |hz| if hz < at { 1.0 } else { 0.0 }
    }

    /// Pink noise with a brick wall at `cut_hz`, like a decoded lossy file.
    fn transcode(sample_rate: u32, cut_hz: f32) -> Vec<f32> {
        let w = wall(cut_hz);
        shape(&white(LEN, 7), sample_rate, |hz| pink(hz) * w(hz))
    }

    fn tier(codec: Codec, min_bitrate_kbps: Option<u32>) -> Tier {
        Tier {
            label: "test".into(),
            codecs: vec![codec],
            min_bit_depth: None,
            min_sample_rate: None,
            min_bitrate_kbps,
            allow_vbr: true,
        }
    }

    fn judge(
        samples: &[f32],
        sample_rate: u32,
        codec: Codec,
        strictness: Strictness,
    ) -> Option<String> {
        let report = analyze_samples(samples, sample_rate);
        spectral_reason(
            codec,
            sample_rate,
            report.cutoff_hz,
            strictness,
            &tier(codec, Some(320)),
            Some(320),
        )
    }

    #[test]
    fn full_band_noise_passes_strict() {
        let white = white(LEN, 1);
        let pink = shape(&white, SR, pink);
        for samples in [&white, &pink] {
            assert_eq!(analyze_samples(samples, SR).cutoff_hz, None);
            assert_eq!(judge(samples, SR, Codec::Flac, Strictness::Strict), None);
        }
    }

    #[test]
    fn flac_cut_at_16k_fails_normal_and_names_the_source() {
        let samples = transcode(SR, 16_000.0);
        let cut = analyze_samples(&samples, SR).cutoff_hz.expect("a cutoff");
        assert!((15_800.0..=16_100.0).contains(&cut), "cutoff {cut}");
        let reason = judge(&samples, SR, Codec::Flac, Strictness::Normal).expect("a failure");
        assert!(
            reason.contains("128 to 192 kbps MP3 saved as FLAC"),
            "{reason}"
        );
        assert!(!reason.contains('\u{2014}'));
    }

    #[test]
    fn flac_cut_at_19_5k_passes_normal_but_fails_strict() {
        let samples = transcode(SR, 19_500.0);
        let cut = analyze_samples(&samples, SR).cutoff_hz.expect("a cutoff");
        assert!((19_300.0..=19_600.0).contains(&cut), "cutoff {cut}");
        assert_eq!(judge(&samples, SR, Codec::Flac, Strictness::Normal), None);
        assert!(judge(&samples, SR, Codec::Flac, Strictness::Strict).is_some());
    }

    #[test]
    fn flac_cut_just_below_19k_fails_normal() {
        let samples = transcode(SR, 18_800.0);
        assert!(judge(&samples, SR, Codec::Flac, Strictness::Normal).is_some());
    }

    #[test]
    fn relaxed_ignores_the_spectrum() {
        let samples = transcode(SR, 12_000.0);
        assert!(analyze_samples(&samples, SR).cutoff_hz.is_some());
        assert_eq!(judge(&samples, SR, Codec::Flac, Strictness::Relaxed), None);
    }

    #[test]
    fn mp3_thresholds_follow_strictness() {
        let at_15k = transcode(SR, 15_000.0);
        let reason = judge(&at_15k, SR, Codec::Mp3, Strictness::Normal).expect("a failure");
        assert!(reason.contains("saved as a 320 kbps MP3"), "{reason}");

        let at_17_5k = transcode(SR, 17_500.0);
        assert_eq!(judge(&at_17_5k, SR, Codec::Mp3, Strictness::Normal), None);
        assert!(judge(&at_17_5k, SR, Codec::Mp3, Strictness::Strict).is_some());

        let at_20k = transcode(SR, 20_000.0);
        assert_eq!(judge(&at_20k, SR, Codec::Mp3, Strictness::Strict), None);
    }

    #[test]
    fn hi_res_upsampled_from_cd_fails() {
        let upsampled = transcode(96_000, 22_050.0);
        let reason = judge(&upsampled, 96_000, Codec::Flac, Strictness::Normal);
        assert_eq!(
            reason.as_deref(),
            Some("Upsampled from CD quality: nothing above 22 kHz")
        );

        let real = shape(&white(LEN, 3), 96_000, pink);
        assert_eq!(judge(&real, 96_000, Codec::Flac, Strictness::Strict), None);
    }

    #[test]
    fn silence_and_near_silence_are_inconclusive() {
        for samples in [
            vec![0.0; LEN],
            white(LEN, 5).iter().map(|s| s * 1e-4).collect(),
        ] {
            let report = analyze_samples(&samples, SR);
            assert_eq!(report.cutoff_hz, None);
            assert_eq!(report.spectrum.len(), BANDS);
            assert_eq!(judge(&samples, SR, Codec::Flac, Strictness::Strict), None);
        }
        assert_eq!(analyze_samples(&[], SR).cutoff_hz, None);
    }

    #[test]
    fn wall_under_a_nearly_empty_high_end_is_inconclusive() {
        // Dull music rolling off 12 dB per kHz above 8 kHz: a wall 90 dB down proves nothing.
        let w = wall(16_000.0);
        let rolloff = |hz: f32| 10f32.powf(-0.6 * ((hz - 8_000.0) / 1_000.0).max(0.0));
        let samples = shape(&white(LEN, 9), SR, |hz| pink(hz) * w(hz) * rolloff(hz));
        assert_eq!(analyze_samples(&samples, SR).cutoff_hz, None);
    }

    #[test]
    fn spectrum_is_normalized_and_shows_the_wall() {
        let report = analyze_samples(&transcode(SR, 11_025.0), SR);
        assert_eq!(report.spectrum.len(), BANDS);
        assert_eq!(
            report.spectrum.iter().copied().fold(f32::MIN, f32::max),
            0.0
        );
        assert!(
            report.spectrum[33..].iter().all(|&db| db < -60.0),
            "{:?}",
            report.spectrum
        );
    }

    // End to end through real files.

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("needle-verify-{}-{name}", std::process::id()))
    }

    fn to_int(s: f32, bits: u32) -> i32 {
        (s.clamp(-1.0, 1.0) * ((1 << (bits - 1)) - 1) as f32).round() as i32
    }

    fn write_wav(path: &Path, samples: &[i32], sample_rate: u32, bits: u16) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: bits,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for &s in samples {
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();
    }

    fn write_flac(path: &Path, samples: &[i32], sample_rate: u32, bits: usize) {
        use flacenc::component::BitRepr;
        use flacenc::error::Verify;
        let config = flacenc::config::Encoder::default().into_verified().unwrap();
        let source =
            flacenc::source::MemSource::from_samples(samples, 1, bits, sample_rate as usize);
        let stream =
            flacenc::encode_with_fixed_block_size(&config, source, config.block_size).unwrap();
        let mut sink = flacenc::bitsink::ByteSink::new();
        stream.write(&mut sink).unwrap();
        std::fs::write(path, sink.as_slice()).unwrap();
    }

    fn any_tier(codec: Codec) -> Tier {
        tier(codec, None)
    }

    #[test]
    fn wav_header_is_checked_against_the_tier() {
        let path = temp("header.wav");
        let pcm: Vec<i32> = white(SR as usize * 3, 11)
            .iter()
            .map(|&s| to_int(s, 16))
            .collect();
        write_wav(&path, &pcm, SR, 16);

        let ok = verify_file(&path, &any_tier(Codec::Wav), Strictness::Strict).unwrap();
        assert!(ok.ok, "{:?}", ok.reason);
        assert_eq!(
            (ok.codec, ok.sample_rate, ok.bit_depth),
            (Codec::Wav, Some(SR), Some(16))
        );
        assert_eq!(ok.nyquist_hz, 22_050.0);
        assert_eq!(ok.spectrum.len(), BANDS);

        let reason = |tier: Tier| {
            verify_file(&path, &tier, Strictness::Normal)
                .unwrap()
                .reason
        };
        assert_eq!(
            reason(any_tier(Codec::Flac)).as_deref(),
            Some("Header says WAV, not FLAC")
        );
        let deep = Tier {
            min_bit_depth: Some(24),
            ..any_tier(Codec::Wav)
        };
        assert_eq!(
            reason(deep).as_deref(),
            Some("16-bit, the profile asks for 24-bit")
        );
        let hi_res = Tier {
            min_sample_rate: Some(96_000),
            ..any_tier(Codec::Wav)
        };
        assert_eq!(
            reason(hi_res).as_deref(),
            Some("44.1 kHz, the profile asks for 96 kHz")
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn padded_24_bit_fails_strict_only() {
        let path = temp("padded.wav");
        let noise = white(SR as usize * 3, 13);
        let padded: Vec<i32> = noise.iter().map(|&s| to_int(s, 16) << 8).collect();
        write_wav(&path, &padded, SR, 24);
        let strict = verify_file(&path, &any_tier(Codec::Wav), Strictness::Strict).unwrap();
        assert_eq!(
            strict.reason.as_deref(),
            Some("16-bit audio padded to 24-bit")
        );
        assert!(
            verify_file(&path, &any_tier(Codec::Wav), Strictness::Normal)
                .unwrap()
                .ok
        );

        let real: Vec<i32> = noise.iter().map(|&s| to_int(s, 24)).collect();
        write_wav(&path, &real, SR, 24);
        assert!(
            verify_file(&path, &any_tier(Codec::Wav), Strictness::Strict)
                .unwrap()
                .ok
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn flac_transcode_is_caught_end_to_end() {
        let path = temp("transcode.flac");
        let to_pcm = |v: Vec<f32>| v.iter().map(|&s| to_int(s, 16)).collect::<Vec<_>>();

        write_flac(&path, &to_pcm(shape(&white(LEN, 17), SR, pink)), SR, 16);
        let genuine = verify_file(&path, &any_tier(Codec::Flac), Strictness::Normal).unwrap();
        assert!(genuine.ok, "{:?}", genuine.reason);
        assert_eq!((genuine.codec, genuine.bit_depth), (Codec::Flac, Some(16)));

        write_flac(&path, &to_pcm(transcode(SR, 16_000.0)), SR, 16);
        let fake = verify_file(&path, &any_tier(Codec::Flac), Strictness::Normal).unwrap();
        assert!(!fake.ok);
        assert!(
            fake.cutoff_hz
                .is_some_and(|c| (15_800.0..=16_100.0).contains(&c)),
            "{:?}",
            fake.cutoff_hz
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn unreadable_files_are_errors() {
        let missing = verify_file(
            Path::new("/nonexistent/needle.flac"),
            &any_tier(Codec::Flac),
            Strictness::Normal,
        );
        assert!(matches!(missing, Err(VerifyError::Open(..))));

        let path = temp("garbage.flac");
        std::fs::write(&path, [0x5a_u8; 10_000]).unwrap();
        let garbage = verify_file(&path, &any_tier(Codec::Flac), Strictness::Normal);
        assert!(matches!(garbage, Err(VerifyError::Decode(_))));
        std::fs::remove_file(&path).ok();
    }
}
