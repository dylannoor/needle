//! Quality profiles: which files count as good enough, best tier first.

use crate::model::{
    Codec, FileInfo, OnFail, QualityProfile, Strictness, StuckRules, Tier, VerifySettings,
};

impl Tier {
    /// Whether one file satisfies this tier. Lossless files with unknown bit
    /// depth or sample rate count as 16-bit 44.1 kHz; lossy files with an
    /// unknown bitrate fail a bitrate minimum.
    #[must_use]
    pub fn matches(&self, file: &FileInfo) -> bool {
        if !self.codecs.contains(&file.codec) {
            return false;
        }
        let lossless = file.codec.is_lossless();
        if self
            .min_bit_depth
            .is_some_and(|min| file.bit_depth.unwrap_or(16) < min)
        {
            return false;
        }
        if self
            .min_sample_rate
            .is_some_and(|min| file.sample_rate.unwrap_or(44_100) < min)
        {
            return false;
        }
        let Some(min) = self.min_bitrate_kbps else {
            return true;
        };
        match file.bitrate_kbps {
            None => lossless,
            // VBR averages sit well below the CBR ceiling (V0 is ~220-260), so
            // a 320 tier that allows VBR accepts V0.
            Some(kbps) if file.vbr == Some(true) && !lossless => {
                self.allow_vbr && kbps >= min * 11 / 16
            }
            Some(kbps) => kbps >= min,
        }
    }
}

impl QualityProfile {
    /// The best tier every audio file in `files` satisfies, if any. Non-audio
    /// files (cover art, cue sheets, logs) are ignored; no audio means no tier.
    #[must_use]
    pub fn tier_of(&self, files: &[FileInfo]) -> Option<usize> {
        let audio: Vec<&FileInfo> = files.iter().filter(|f| f.is_audio()).collect();
        if audio.is_empty() {
            return None;
        }
        self.tiers
            .iter()
            .position(|t| audio.iter().all(|f| t.matches(f)))
    }

    /// The built-in "Lossless first" profile.
    #[must_use]
    pub fn lossless_first() -> Self {
        let tier = |label: &str, codecs: &[Codec]| Tier {
            label: label.into(),
            codecs: codecs.to_vec(),
            min_bit_depth: None,
            min_sample_rate: None,
            min_bitrate_kbps: None,
            allow_vbr: false,
        };
        QualityProfile {
            id: "lossless-first".into(),
            name: "Lossless first".into(),
            builtin: true,
            tiers: vec![
                Tier {
                    min_bit_depth: Some(24),
                    ..tier("FLAC 24-bit", &[Codec::Flac, Codec::Alac])
                },
                Tier {
                    min_bit_depth: Some(16),
                    min_sample_rate: Some(44_100),
                    ..tier(
                        "FLAC 16-bit",
                        &[Codec::Flac, Codec::Alac, Codec::Wav, Codec::Aiff],
                    )
                },
                Tier {
                    min_bitrate_kbps: Some(320),
                    allow_vbr: true,
                    ..tier("MP3 320 kbps", &[Codec::Mp3])
                },
            ],
            max_queue: 50,
            prefer_complete: true,
            verify: VerifySettings {
                enabled: true,
                strictness: Strictness::Normal,
                on_fail: OnFail::Delete,
            },
            stuck: StuckRules {
                no_data_secs: 120,
                queue_wait_secs: 600,
                max_sources: 5,
                wishlist_when_exhausted: true,
            },
        }
    }

    /// The built-in "Storage first" profile: the smallest good copy wins, so
    /// MP3 320 before FLAC before AIFF.
    #[must_use]
    pub fn storage_first() -> Self {
        let base = Self::lossless_first();
        let tier = |label: &str, codecs: &[Codec]| Tier {
            label: label.into(),
            codecs: codecs.to_vec(),
            min_bit_depth: Some(16),
            min_sample_rate: Some(44_100),
            min_bitrate_kbps: None,
            allow_vbr: false,
        };
        QualityProfile {
            id: "storage-first".into(),
            name: "Storage first".into(),
            tiers: vec![
                base.tiers[2].clone(),
                tier("FLAC", &[Codec::Flac, Codec::Alac]),
                tier("AIFF", &[Codec::Aiff]),
            ],
            ..base
        }
    }

    /// Every built-in profile, in the order the UI lists them.
    #[must_use]
    pub fn builtins() -> Vec<Self> {
        vec![Self::lossless_first(), Self::storage_first()]
    }

    /// Checks a profile the user edited. The error is a sentence for the UI.
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Give the profile a name.".into());
        }
        if self.tiers.is_empty() {
            return Err("Add at least one tier.".into());
        }
        if let Some(t) = self.tiers.iter().find(|t| t.codecs.is_empty()) {
            return Err(format!("Tier \"{}\" needs at least one format.", t.label));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(
        path: &str,
        bitrate: Option<u32>,
        vbr: Option<bool>,
        rate: Option<u32>,
        depth: Option<u32>,
    ) -> FileInfo {
        FileInfo {
            path: path.into(),
            size: 1,
            codec: Codec::from_path(path),
            bitrate_kbps: bitrate,
            vbr,
            sample_rate: rate,
            bit_depth: depth,
            duration_secs: None,
        }
    }

    fn flac(rate: Option<u32>, depth: Option<u32>) -> FileInfo {
        file("Homework/01.flac", None, None, rate, depth)
    }

    fn mp3(bitrate: Option<u32>, vbr: Option<bool>) -> FileInfo {
        file("Homework/01.mp3", bitrate, vbr, Some(44_100), None)
    }

    fn tiers() -> Vec<Tier> {
        QualityProfile::lossless_first().tiers
    }

    #[test]
    fn hi_res_flac_meets_the_24_bit_tier() {
        assert!(tiers()[0].matches(&flac(Some(96_000), Some(24))));
        assert!(!tiers()[0].matches(&flac(Some(44_100), Some(16))));
    }

    #[test]
    fn flac_with_unknown_attributes_counts_as_cd_quality() {
        let unknown = flac(None, None);
        assert!(!tiers()[0].matches(&unknown));
        assert!(tiers()[1].matches(&unknown));
    }

    #[test]
    fn flac_16_tier_rejects_low_sample_rates() {
        assert!(!tiers()[1].matches(&flac(Some(32_000), Some(16))));
        assert!(tiers()[1].matches(&flac(Some(44_100), Some(16))));
        assert!(tiers()[1].matches(&flac(Some(48_000), Some(24))));
    }

    #[test]
    fn codec_must_be_listed() {
        assert!(!tiers()[1].matches(&mp3(Some(320), Some(false))));
        assert!(!tiers()[2].matches(&flac(Some(44_100), Some(16))));
        assert!(tiers()[1].matches(&file("x/01.wav", None, None, Some(44_100), Some(16))));
    }

    #[test]
    fn mp3_bitrate_boundaries() {
        let t = &tiers()[2];
        assert!(t.matches(&mp3(Some(320), Some(false))));
        assert!(t.matches(&mp3(Some(320), None)));
        assert!(!t.matches(&mp3(Some(319), Some(false))));
        assert!(!t.matches(&mp3(Some(256), None)));
        assert!(!t.matches(&mp3(None, None)));
    }

    #[test]
    fn v0_passes_a_320_tier_only_when_vbr_is_allowed() {
        let t = &tiers()[2];
        assert!(t.matches(&mp3(Some(245), Some(true))));
        assert!(t.matches(&mp3(Some(220), Some(true))));
        assert!(!t.matches(&mp3(Some(219), Some(true))));
        let strict = Tier {
            allow_vbr: false,
            ..t.clone()
        };
        assert!(!strict.matches(&mp3(Some(260), Some(true))));
    }

    #[test]
    fn tier_of_picks_the_best_tier_all_audio_meets() {
        let p = QualityProfile::lossless_first();
        let mixed = vec![flac(Some(96_000), Some(24)), flac(Some(44_100), Some(16))];
        assert_eq!(p.tier_of(&mixed), Some(1));
        let hi = vec![
            flac(Some(96_000), Some(24)),
            file("Homework/cover.jpg", None, None, None, None),
        ];
        assert_eq!(p.tier_of(&hi), Some(0));
        assert_eq!(p.tier_of(&[mp3(Some(192), Some(false))]), None);
    }

    #[test]
    fn tier_of_without_audio_is_none() {
        let p = QualityProfile::lossless_first();
        assert_eq!(p.tier_of(&[]), None);
        assert_eq!(
            p.tier_of(&[file("Homework/folder.jpg", None, None, None, None)]),
            None
        );
    }

    #[test]
    fn built_in_profile_is_valid() {
        let p = QualityProfile::lossless_first();
        assert_eq!(p.id, "lossless-first");
        assert_eq!(p.tiers.len(), 3);
        assert_eq!(p.validate(), Ok(()));
    }

    #[test]
    fn validate_rejects_broken_profiles() {
        let ok = QualityProfile::lossless_first();
        assert!(
            QualityProfile {
                name: "  ".into(),
                ..ok.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            QualityProfile {
                tiers: vec![],
                ..ok.clone()
            }
            .validate()
            .is_err()
        );
        let mut no_codec = ok.clone();
        no_codec.tiers[1].codecs.clear();
        assert_eq!(
            no_codec.validate(),
            Err("Tier \"FLAC 16-bit\" needs at least one format.".into())
        );
    }
    #[test]
    fn storage_first_prefers_the_smallest_good_copy() {
        let p = QualityProfile::storage_first();
        assert!(p.builtin);
        assert_eq!(p.validate(), Ok(()));
        let labels: Vec<_> = p.tiers.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, ["MP3 320 kbps", "FLAC", "AIFF"]);
        let file = |path: &str, bitrate, depth| {
            FileInfo::from_attributes(path.into(), 1, &[(0, bitrate), (4, 44_100), (5, depth)])
        };
        assert_eq!(p.tier_of(&[file("a.mp3", 320, 0)]), Some(0));
        assert_eq!(p.tier_of(&[file("a.flac", 0, 24)]), Some(1));
        assert_eq!(p.tier_of(&[file("a.aiff", 0, 16)]), Some(2));
        assert_eq!(p.tier_of(&[file("a.wav", 0, 16)]), None);
    }
}
