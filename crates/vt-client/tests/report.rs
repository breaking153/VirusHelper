use vt_client::{decode_report, validate_hash};

const HASH: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[test]
fn accepts_only_file_identity_hashes_and_normalizes_case() {
    assert_eq!(validate_hash(&HASH.to_uppercase()).unwrap(), HASH);
    assert!(validate_hash("900150983cd24fb0d6963f7d28e17f72").is_ok());
    assert!(validate_hash("a9993e364706816aba3e25717850c26c9cd0d89d").is_ok());
    for value in ["../secret", "invalid", "abcd?key=secret", "12345678"] {
        assert_eq!(validate_hash(value).unwrap_err().code, "invalid-input");
    }
}

#[test]
fn decodes_real_v3_file_shape_without_calling_zero_detections_safe() {
    let response = format!(
        r#"{{"data":{{"id":"{HASH}","type":"file","attributes":{{"last_analysis_date":1720000000,"last_analysis_stats":{{"malicious":3,"suspicious":1,"undetected":62,"harmless":2,"timeout":1,"failure":1}}}}}}}}"#
    );
    let report = decode_report(HASH, response.as_bytes()).unwrap();
    assert_eq!(
        (report.malicious, report.suspicious, report.total),
        (3, 1, 70)
    );
    assert_eq!(report.last_analysis_date, Some(1720000000));
    assert_eq!(report.status, "found");
}

#[test]
fn missing_analysis_is_pending_and_malformed_responses_are_rejected() {
    let pending = format!(r#"{{"data":{{"id":"{HASH}","type":"file","attributes":{{}}}}}}"#);
    assert_eq!(
        decode_report(HASH, pending.as_bytes()).unwrap().status,
        "pending"
    );
    for body in [
        r#"{"data":{}}"#,
        r#"not json"#,
        r#"{"data":{"id":"wrong","type":"file","attributes":{"last_analysis_stats":{"malicious":-1}}}}"#,
    ] {
        assert_eq!(
            decode_report(HASH, body.as_bytes()).unwrap_err().code,
            "invalid-response"
        );
    }
}

#[test]
fn decodes_vt_threat_labels_and_categories_and_tolerates_absent_classification() {
    for (classification, label, categories) in [
        (
            serde_json::json!({"suggested_threat_label": "trojan.generic/test", "popular_threat_category": [{"count": 20, "value": "trojan"}, {"count": 3, "value": "downloader"}, {"count": 2, "value": "trojan"}]}),
            Some("trojan.generic/test"),
            vec!["trojan", "downloader"],
        ),
        (
            serde_json::json!({"suggested_threat_label": " ", "popular_threat_category": [{"value": "ransomware"}]}),
            None,
            vec!["ransomware"],
        ),
        (serde_json::Value::Null, None, vec![]),
        (serde_json::json!({}), None, vec![]),
    ] {
        let body = serde_json::json!({"data": {"id": HASH, "type": "file", "attributes": {
            "last_analysis_stats": {"malicious": 3, "undetected": 67},
            "popular_threat_classification": classification
        }}});
        let report = decode_report(HASH, &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(report.threat_label.as_deref(), label);
        assert_eq!(report.threat_categories, categories);
        let serialized = serde_json::to_value(&report).unwrap();
        assert_eq!(
            serialized["threatLabel"],
            serde_json::to_value(label).unwrap()
        );
        assert_eq!(
            serialized["threatCategories"],
            serde_json::to_value(categories).unwrap()
        );
        assert_eq!(report.status, "found");
    }
}
