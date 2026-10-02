//! What a peer tells us about a file, turned into something the engine can reason about.

use crate::model::{Codec, FileInfo};

impl Codec {
    /// The codec a file's extension implies. `.m4a` is assumed AAC; see
    /// [`FileInfo::from_attributes`] for how ALAC is told apart.
    #[must_use]
    pub fn from_path(path: &str) -> Codec {
        let name = basename(path);
        let ext = name
            .rsplit_once('.')
            .map_or("", |(_, e)| e)
            .to_ascii_lowercase();
        match ext.as_str() {
            "flac" => Codec::Flac,
            "alac" => Codec::Alac,
            "wav" => Codec::Wav,
            "aif" | "aiff" => Codec::Aiff,
            "mp3" => Codec::Mp3,
            "aac" | "m4a" => Codec::Aac,
            "ogg" | "oga" => Codec::Ogg,
            "opus" => Codec::Opus,
            _ => Codec::Other,
        }
    }

    #[must_use]
    pub fn is_lossless(self) -> bool {
        matches!(self, Codec::Flac | Codec::Alac | Codec::Wav | Codec::Aiff)
    }

    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Codec::Flac => "FLAC",
            Codec::Alac => "ALAC",
            Codec::Wav => "WAV",
            Codec::Aiff => "AIFF",
            Codec::Mp3 => "MP3",
            Codec::Aac => "AAC",
            Codec::Ogg => "Ogg",
            Codec::Opus => "Opus",
            Codec::Other => "Other",
        }
    }
}

impl FileInfo {
    /// Build from a Soulseek search result entry. Attribute codes: 0 bitrate
    /// (kbps), 1 duration (s), 2 VBR flag, 4 sample rate (Hz), 5 bit depth.
    /// Zero values are treated as unknown, since many clients send 0 for that.
    #[must_use]
    pub fn from_attributes(path: String, size: u64, attrs: &[(u32, u32)]) -> FileInfo {
        let get = |code: u32| {
            attrs
                .iter()
                .find(|(c, _)| *c == code)
                .map(|(_, v)| *v)
                .filter(|v| *v > 0)
        };
        let mut codec = Codec::from_path(&path);
        let bit_depth = get(5);
        // A .m4a with a bit depth is ALAC; AAC has none.
        if codec == Codec::Aac && bit_depth.is_some() && path.to_ascii_lowercase().ends_with(".m4a")
        {
            codec = Codec::Alac;
        }
        FileInfo {
            codec,
            bitrate_kbps: get(0),
            duration_secs: get(1),
            vbr: attrs.iter().find(|(c, _)| *c == 2).map(|(_, v)| *v == 1),
            sample_rate: get(4),
            bit_depth,
            path,
            size,
        }
    }

    /// File name without the folder.
    #[must_use]
    pub fn name(&self) -> &str {
        basename(&self.path)
    }

    /// Remote folder without the trailing separator ("" when there is none).
    #[must_use]
    pub fn folder(&self) -> &str {
        self.path.rfind(['\\', '/']).map_or("", |i| &self.path[..i])
    }

    #[must_use]
    pub fn is_audio(&self) -> bool {
        self.codec != Codec::Other
    }
}

/// The last component of a path with `\` or `/` separators.
#[must_use]
pub fn basename(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_comes_from_the_extension_in_any_case() {
        assert_eq!(
            Codec::from_path(r"Music\Daft Punk\01 - Daftendirekt.FLAC"),
            Codec::Flac
        );
        assert_eq!(Codec::from_path("a/b/track.Mp3"), Codec::Mp3);
        assert_eq!(Codec::from_path("song.aif"), Codec::Aiff);
        assert_eq!(Codec::from_path("cover.jpg"), Codec::Other);
        assert_eq!(Codec::from_path("README"), Codec::Other);
        // A dot in the folder name is not an extension.
        assert_eq!(Codec::from_path(r"Music\Vol.mp3\notes"), Codec::Other);
    }

    #[test]
    fn lossless_and_labels() {
        assert!(Codec::Flac.is_lossless());
        assert!(Codec::Wav.is_lossless());
        assert!(!Codec::Mp3.is_lossless());
        assert!(!Codec::Other.is_lossless());
        assert_eq!(Codec::Flac.label(), "FLAC");
        assert_eq!(Codec::Mp3.label(), "MP3");
    }

    #[test]
    fn attributes_map_to_fields() {
        let f = FileInfo::from_attributes(
            r"Music\Daft Punk\1997 - Homework\03 - Revolution 909.flac".into(),
            31_000_000,
            &[(0, 1011), (1, 326), (4, 44100), (5, 16)],
        );
        assert_eq!(f.codec, Codec::Flac);
        assert_eq!(f.bitrate_kbps, Some(1011));
        assert_eq!(f.duration_secs, Some(326));
        assert_eq!(f.sample_rate, Some(44100));
        assert_eq!(f.bit_depth, Some(16));
        assert_eq!(f.vbr, None);
        assert_eq!(f.name(), "03 - Revolution 909.flac");
        assert_eq!(f.folder(), r"Music\Daft Punk\1997 - Homework");
        assert!(f.is_audio());
    }

    #[test]
    fn vbr_flag_and_zero_values() {
        let v0 = FileInfo::from_attributes("x/01.mp3".into(), 1, &[(0, 245), (2, 1)]);
        assert_eq!(v0.vbr, Some(true));
        let cbr = FileInfo::from_attributes("x/01.mp3".into(), 1, &[(0, 320), (2, 0), (4, 0)]);
        assert_eq!(cbr.vbr, Some(false));
        assert_eq!(cbr.sample_rate, None);
    }

    #[test]
    fn m4a_with_bit_depth_is_alac() {
        let alac = FileInfo::from_attributes("x/01.m4a".into(), 1, &[(5, 16), (4, 44100)]);
        assert_eq!(alac.codec, Codec::Alac);
        let aac = FileInfo::from_attributes("x/01.m4a".into(), 1, &[(0, 256)]);
        assert_eq!(aac.codec, Codec::Aac);
    }

    #[test]
    fn name_and_folder_without_separator() {
        let f = FileInfo::from_attributes("cover.jpg".into(), 1, &[]);
        assert_eq!(f.name(), "cover.jpg");
        assert_eq!(f.folder(), "");
        assert!(!f.is_audio());
    }
}
