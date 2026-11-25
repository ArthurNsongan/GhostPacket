//! End-to-end tests of the server-side verifier: real TCP, real HTTP.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use ghostpacket_core::channel_sim::flip_bit;
use ghostpacket_core::crypto::Keypair;
use ghostpacket_core::protocol::{encode_frame, encode_frame_with, Encryption};
use ghostpacket_core::schema::{DocumentBody, DocumentDraft};
use ghostpacket_verifier::{http, Config, Verifier};
use zeroize::Zeroizing;

const SEED: [u8; 32] = [0x11; 32];
const ORIGIN: &str = "https://ghostpacket.example";

fn draft(id: &[u8; 8]) -> DocumentDraft {
    DocumentDraft {
        doc_id: *id,
        timestamp: 1_793_448_000,
        body: DocumentBody::CustomMessage {
            sender: "Kaolack distribution point 4".into(),
            title: "Voucher".into(),
            message: "25 kg rice, 5 L oil".into(),
        },
    }
}

fn frame(id: &[u8; 8]) -> Vec<u8> {
    encode_frame(draft(id), &SEED, 0).unwrap().bytes
}

fn start(config: Config) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let verifier = Arc::new(Verifier::new(config).unwrap());
    std::thread::spawn(move || http::serve(listener, verifier));
    addr
}

fn config() -> Config {
    Config { allow_origin: Some(ORIGIN.into()), ..Config::default() }
}

/// Sends a raw request, returns (status, headers, json body).
fn raw(addr: &str, request: &[u8]) -> (u16, String, serde_json::Value) {
    let mut s = TcpStream::connect(addr).unwrap();
    s.write_all(request).unwrap();
    let mut out = Vec::new();
    let _ = s.read_to_end(&mut out);
    let text = String::from_utf8_lossy(&out).to_string();
    let (h, b) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = h.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    (status, h.to_string(), serde_json::from_str(b).unwrap_or(serde_json::Value::Null))
}

fn request(addr: &str, method: &str, path: &str, extra: &str, body: &[u8], content_length: Option<usize>) -> (u16, String, serde_json::Value) {
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/octet-stream\r\n{extra}");
    if let Some(n) = content_length {
        head.push_str(&format!("Content-Length: {n}\r\n"));
    }
    head.push_str("\r\n");
    let mut req = head.into_bytes();
    req.extend_from_slice(body);
    raw(addr, &req)
}

fn post(addr: &str, body: &[u8]) -> (u16, String, serde_json::Value) {
    request(addr, "POST", "/v1/proofs", "", body, Some(body.len()))
}

#[test]
fn accepts_then_detects_replay() {
    let addr = start(config());
    let f = frame(b"AID-0001");
    let (s1, h1, b1) = post(&addr, &f);
    assert_eq!(s1, 201, "{b1}");
    assert_eq!(b1["status"], "accepted");
    assert_eq!(b1["doc_id"], "AID-0001");
    assert_eq!(b1["receipt"].as_str().unwrap().len(), 64);
    assert_eq!(b1["document"]["customMessage"]["title"], "Voucher");
    assert!(h1.contains(&format!("Access-Control-Allow-Origin: {ORIGIN}")));

    let (s2, _, b2) = post(&addr, &f);
    assert_eq!(s2, 409);
    assert_eq!(b2["status"], "replay");
    assert_eq!(request(&addr, "GET", "/v1/health", "", b"", None).2["ledger"], 1);
}

#[test]
fn concurrent_submits_of_one_proof_redeem_it_once() {
    let addr = start(config());
    let f = Arc::new(frame(b"AID-0009"));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let (a, f) = (addr.clone(), Arc::clone(&f));
            std::thread::spawn(move || post(&a, &f).0)
        })
        .collect();
    let codes: Vec<u16> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(codes.iter().filter(|&&c| c == 201).count(), 1, "{codes:?}");
    assert!(codes.iter().all(|c| [201, 409, 503].contains(c)), "{codes:?}");
}

#[test]
fn rejects_tampered_oversized_and_malformed_requests() {
    let addr = start(config());
    let f = frame(b"AID-0002");
    let bad = flip_bit(&f, 20, 1).unwrap();
    let (s, _, b) = post(&addr, &bad);
    assert_eq!((s, b["code"].as_str()), (422, Some("CRC32_MISMATCH")));

    assert_eq!(request(&addr, "POST", "/v1/proofs", "", &[0u8; 16], Some(100_000)).0, 413, "length checked before reading");
    assert_eq!(request(&addr, "POST", "/v1/proofs", "", &f, None).0, 411);
    assert_eq!(request(&addr, "POST", "/v1/proofs", "Content-Length: 12\r\n", &f, Some(f.len())).0, 400, "duplicate Content-Length");
    assert_eq!(request(&addr, "POST", "/v1/proofs", "Transfer-Encoding: chunked\r\n", &f, Some(f.len())).0, 400);
    assert_eq!(request(&addr, "POST", "/v1/proofs", "", &f, None).0, 411);
    let plain = format!("POST /v1/proofs HTTP/1.1\r\nHost: x\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n", f.len());
    let mut req = plain.into_bytes();
    req.extend_from_slice(&f);
    assert_eq!(raw(&addr, &req).0, 415, "text/plain would skip the CORS preflight");
    assert_eq!(raw(&addr, b"GET /v1/health HTTP/2\r\n\r\n").0, 400);
}

#[test]
fn foreign_origin_cannot_post() {
    let addr = start(config());
    let f = frame(b"AID-0010");
    let (s, _, b) = request(&addr, "POST", "/v1/proofs", "Origin: https://evil.example\r\n", &f, Some(f.len()));
    assert_eq!((s, b["code"].as_str()), (403, Some("ORIGIN_NOT_ALLOWED")));
    assert_eq!(request(&addr, "POST", "/v1/proofs", &format!("Origin: {ORIGIN}\r\n"), &f, Some(f.len())).0, 201);
}

#[test]
fn slow_client_is_cut_at_the_request_deadline() {
    let addr = start(config());
    let mut s = TcpStream::connect(&addr).unwrap();
    let t0 = Instant::now();
    let mut buf = [0u8; 256];
    s.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
    // One byte per second: each read() is well under 5 s, the whole request is not.
    let mut got = 0;
    for b in b"POST /v1/proofs HTTP/1.1\r\n".iter() {
        let _ = s.write_all(&[*b]);
        if let Ok(n) = s.read(&mut buf[got..]) {
            got += n;
            if n > 0 {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(800));
        if t0.elapsed() > Duration::from_secs(9) {
            break;
        }
    }
    let elapsed = t0.elapsed();
    assert!(elapsed < Duration::from_secs(8), "connection held for {elapsed:?}");
    assert!(String::from_utf8_lossy(&buf).contains("408"), "expected 408 REQUEST_TIMEOUT");
}

#[test]
fn token_protects_submission() {
    let addr = start(Config { token: Some(Zeroizing::new("s3cret-token".into())), ..config() });
    let f = frame(b"AID-0011");
    assert_eq!(post(&addr, &f).0, 401);
    assert_eq!(request(&addr, "POST", "/v1/proofs", "Authorization: Bearer wrong\r\n", &f, Some(f.len())).0, 401);
    assert_eq!(request(&addr, "POST", "/v1/proofs", "Authorization: Bearer s3cret-token\r\n", &f, Some(f.len())).0, 201);
    let public = request(&addr, "GET", "/v1/health", "", b"", None).2;
    assert!(public.get("ledger").is_none(), "redemption volume hidden without the token");
}

#[test]
fn strict_keyring_rejects_other_issuers() {
    let other = Keypair::from_seed(&[0x22; 32]).unwrap().public_key();
    let addr = start(Config { trusted: vec![other], ..config() });
    let (s, _, b) = post(&addr, &frame(b"AID-0003"));
    assert_eq!((s, b["code"].as_str()), (422, Some("UNTRUSTED_ISSUER")));
}

#[test]
fn encrypted_proofs_need_the_passphrase_and_leak_nothing() {
    let enc = encode_frame_with(draft(b"RX-00009"), &SEED, 0, Some(Encryption { passphrase: b"baobab moon", salt: &[7; 16] }))
        .unwrap()
        .bytes;
    let locked = start(config());
    let (s, _, b) = post(&locked, &enc);
    assert_eq!((s, b["code"].as_str()), (422, Some("PASSPHRASE_REQUIRED")));

    let wrong = start(Config { passphrase: Some(Zeroizing::new("nope".into())), ..config() });
    assert_eq!(post(&wrong, &enc).2["code"], "ENCRYPTED_PROOF_REJECTED", "no post-decryption oracle");

    let open = start(Config { passphrase: Some(Zeroizing::new("baobab moon".into())), ..config() });
    let (s, _, b) = post(&open, &enc);
    assert_eq!(s, 201);
    assert_eq!(b["encrypted"], true);
    for leaked in ["document", "doc_id", "fingerprint", "issuer_pubkey_hex", "doc_timestamp"] {
        assert!(b.get(leaked).is_none(), "{leaked} must not be echoed for encrypted proofs: {b}");
    }
    let (s, _, b) = post(&open, &enc);
    assert_eq!(s, 409);
    assert!(b.get("doc_id").is_none());
}

#[test]
fn ledger_survives_restart_and_recovers_a_torn_line() {
    let path = std::env::temp_dir().join(format!("gp-ledger-{}-a.jsonl", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let f = frame(b"AID-0004");
    let a = start(Config { ledger_path: Some(path.clone()), ..config() });
    assert_eq!(post(&a, &f).0, 201);
    // Simulate a crash mid-append: a partial record with no newline.
    std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{\"key\":\"half").unwrap();
    let b = start(Config { ledger_path: Some(path.clone()), ..config() });
    assert_eq!(post(&b, &f).0, 409, "a restarted server still knows the redemption");
    assert_eq!(post(&b, &frame(b"AID-0005")).0, 201, "appends after the torn line on a fresh line");
    let c = start(Config { ledger_path: Some(path.clone()), ..config() });
    assert_eq!(post(&c, &frame(b"AID-0005")).0, 409);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn corrupt_ledger_refuses_to_start() {
    let path = std::env::temp_dir().join(format!("gp-ledger-{}-b.jsonl", std::process::id()));
    std::fs::write(&path, "not json\n{\"also\":\"bad\"}\n").unwrap();
    assert!(Verifier::new(Config { ledger_path: Some(path.clone()), ..Config::default() }).is_err());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn ledger_cap_answers_503_so_clients_retry() {
    let addr = start(Config { max_ledger: 1, ..config() });
    assert_eq!(post(&addr, &frame(b"AID-0006")).0, 201);
    let (s, _, b) = post(&addr, &frame(b"AID-0007"));
    assert_eq!((s, b["code"].as_str()), (503, Some("LEDGER_FULL")));
}

#[test]
fn cors_preflight_and_unknown_routes() {
    let addr = start(config());
    let (s, h, _) = request(&addr, "OPTIONS", "/v1/proofs", "", b"", None);
    assert_eq!(s, 204);
    assert!(h.contains("Access-Control-Allow-Private-Network: true"));
    assert_eq!(request(&addr, "GET", "/v1/proofs", "", b"", None).0, 405);
    assert_eq!(request(&addr, "GET", "/nope", "", b"", None).0, 404);
}
