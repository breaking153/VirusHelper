pub(crate) const FORMAT_SAMPLE_SIZE: usize = 64 * 1024;

/// Signature identification is deliberately independent of the filename. The
/// sample comes from the existing hash stream, so no second file read is needed.
pub(crate) fn detect_format(sample: &[u8], truncated: bool) -> String {
    if sample.is_empty() {
        return "空文件".into();
    }
    if sample.starts_with(b"MZ") {
        return pe_format(sample).unwrap_or_else(|| "DOS/MZ".into());
    }
    if let Some(kind) = infer::get(sample) {
        return match kind.extension() {
            "mach" => "Mach-O".into(),
            "class" => "Java Class".into(),
            "sh" => "脚本（#!）".into(),
            extension => extension.to_ascii_uppercase(),
        };
    }
    if sample.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
        return "OLE/CFB".into();
    }
    for (bom, little_endian, label) in [
        ([0xff, 0xfe], true, "UTF-16LE 文本"),
        ([0xfe, 0xff], false, "UTF-16BE 文本"),
    ] {
        if let Some(body) = sample.strip_prefix(&bom) {
            if body.len() % 2 == 0 || truncated {
                let words = body.as_chunks::<2>().0.iter().map(|b| {
                    if little_endian {
                        u16::from_le_bytes([b[0], b[1]])
                    } else {
                        u16::from_be_bytes([b[0], b[1]])
                    }
                });
                if char::decode_utf16(words).all(|c| c.is_ok_and(text_char)) {
                    return label.into();
                }
            }
            return "未知格式".into();
        }
    }
    let text = match std::str::from_utf8(sample) {
        Ok(text) => Some(text),
        // Sampling may split the last UTF-8 character of an otherwise valid prefix.
        Err(e) if truncated && e.error_len().is_none() => {
            std::str::from_utf8(&sample[..e.valid_up_to()]).ok()
        }
        Err(_) => None,
    };
    if text.is_some_and(|s| !s.is_empty() && s.chars().all(text_char)) {
        return "UTF-8 文本".into();
    }
    "未知格式".into()
}

fn text_char(c: char) -> bool {
    !c.is_control() || matches!(c, '\n' | '\r' | '\t' | '\u{c}')
}

fn pe_format(sample: &[u8]) -> Option<String> {
    let offset = u32::from_le_bytes(sample.get(0x3c..0x40)?.try_into().ok()?) as usize;
    if offset < 0x40 {
        return None;
    }
    let header = sample.get(offset..offset.checked_add(26)?)?;
    if !header.starts_with(b"PE\0\0") {
        return None;
    }
    let kind = match u16::from_le_bytes([header[24], header[25]]) {
        0x10b => "PE32",
        0x20b => "PE32+",
        _ => "PE",
    };
    let flags = u16::from_le_bytes([header[22], header[23]]);
    let suffix = if flags & 0x2000 != 0 {
        " DLL"
    } else if flags & 0x0002 != 0 {
        " EXE"
    } else {
        ""
    };
    Some(format!("{kind}{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_common_signatures_and_never_needs_a_filename() {
        assert_eq!(detect_format(b"\x89PNG\r\n\x1a\n", false), "PNG");
        assert_eq!(detect_format(b"%PDF-1.7\n%%EOF\n", false), "PDF");
        assert_eq!(detect_format(b"PK\x03\x04\0\0\0\0", false), "ZIP");
        let mut elf = [0; 64];
        elf[..4].copy_from_slice(b"\x7fELF");
        assert_eq!(detect_format(&elf, false), "ELF");
        assert_eq!(detect_format(&[0xcf, 0xfa, 0xed, 0xfe], false), "Mach-O");
    }

    #[test]
    fn distinguishes_pe_exe_dll_and_bounded_or_invalid_pe_headers() {
        let mut pe = [0; 256];
        pe[..2].copy_from_slice(b"MZ");
        pe[0x3c..0x40].copy_from_slice(&0x80_u32.to_le_bytes());
        pe[0x80..0x84].copy_from_slice(b"PE\0\0");
        pe[0x96..0x98].copy_from_slice(&2_u16.to_le_bytes());
        pe[0x98..0x9a].copy_from_slice(&0x20b_u16.to_le_bytes());
        assert_eq!(detect_format(&pe, false), "PE32+ EXE");
        pe[0x96..0x98].copy_from_slice(&0x2002_u16.to_le_bytes());
        assert_eq!(detect_format(&pe, false), "PE32+ DLL");
        pe[0x3c..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(detect_format(&pe, false), "DOS/MZ");
        assert_eq!(detect_format(b"MZ", false), "DOS/MZ");
    }

    #[test]
    fn identifies_text_empty_and_unknown_data_without_extension_guesses() {
        assert_eq!(detect_format("你好 abc\n".as_bytes(), false), "UTF-8 文本");
        assert_eq!(
            detect_format(&[0xff, 0xfe, b'A', 0], false),
            "UTF-16LE 文本"
        );
        assert_eq!(
            detect_format(&[0xfe, 0xff, 0, b'A'], false),
            "UTF-16BE 文本"
        );
        assert_eq!(detect_format(b"", false), "空文件");
        assert_eq!(detect_format(&[0, 1, 2, 3, 0xff], false), "未知格式");
        assert_eq!(detect_format(b"abc\xe4\xbd", true), "UTF-8 文本");
        assert_eq!(detect_format(b"abc\xe4\xbd", false), "未知格式");
    }
}
