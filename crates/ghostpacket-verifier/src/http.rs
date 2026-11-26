//! Minimal HTTP/1.1 endpoint on `std::net` (no framework, no async runtime).
//!
//! ```text
//! POST /v1/proofs   Content-Type: application/octet-stream, body = raw .gpkt (v1 ≤ 512 B, v2 ≤ 131 150 B)
//!                   → 201 accepted | 409 replay | 422 rejected | 401 | 403 | 413 | 415 | 429 | 503
//! GET  /v1/health   → 200 {"ok":true} (+ version and ledger size with a valid token)
//! OPTIONS *         → CORS preflight
//! ```
//! Hardening:
//! - one request per connection (`Connection: close`), whole request within a
//!   5 s deadline (slow clients cannot hold a slot), head ≤ 2 KiB, body ≤ 131 150 B (GPKT v2);
//! - ≤ 32 connections in total and ≤ 4 per client IP; token bucket of 5
//!   requests/s (burst 20) per IP;
//! - strict parsing: one numeric Content-Length, no Transfer-Encoding, HTTP/1.x only;
//! - POST must be `application/octet-stream` (forces a CORS preflight) and,
//!   if an `Origin` header is present, it must equal `--allow-origin`
//!   (blocks cross-site and DNS-rebinding posts);
//! - optional bearer token (`GHOSTPACKET_TOKEN`) for POST and detailed health.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ghostpacket_core::protocol::MAX_ANY_FRAME_SIZE;

use crate::Verifier;

const MAX_HEAD: usize = 2 * 1024;
const MAX_CONNECTIONS: usize = 32;
const MAX_PER_IP: usize = 4;
const DEADLINE: Duration = Duration::from_secs(5);
const RATE_PER_SEC: f64 = 5.0;
const RATE_BURST: f64 = 20.0;
const MAX_TRACKED_IPS: usize = 10_000;

pub struct Response {
    pub status: u16,
    pub body: String,
}

fn json(status: u16, body: serde_json::Value) -> Response {
    Response {
        status,
        body: body.to_string(),
    }
}

fn err(status: u16, code: &str) -> Response {
    json(status, serde_json::json!({ "status": "error", "code": code }))
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

/// A parsed request (only what the routes need).
pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub content_type: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub body: &'a [u8],
}

fn token_ok(verifier: &Verifier, authorization: Option<&str>) -> bool {
    match verifier.token() {
        None => true,
        Some(expected) => {
            let given = authorization.and_then(|a| a.strip_prefix("Bearer ")).unwrap_or("");
            // Constant-time comparison.
            given.len() == expected.len() && given.bytes().zip(expected.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
        }
    }
}

/// Routes one parsed request. Pure function: easy to test without sockets.
pub fn route(verifier: &Verifier, r: &Request<'_>) -> Response {
    let path = r.path.split('?').next().unwrap_or(r.path);
    if let Some(origin) = r.origin {
        // Browsers always send Origin on cross-origin POSTs: only the configured one may post.
        if r.method == "POST" && verifier.allow_origin() != Some(origin) {
            return err(403, "ORIGIN_NOT_ALLOWED");
        }
    }
    match (r.method, path) {
        ("OPTIONS", _) => Response { status: 204, body: String::new() },
        ("GET", "/v1/health") => {
            if verifier.token().is_some() && token_ok(verifier, r.authorization) {
                json(200, serde_json::json!({ "ok": true, "service": "ghostpacket-verifier", "version": env!("CARGO_PKG_VERSION"), "ledger": verifier.ledger_len() }))
            } else if verifier.token().is_none() {
                json(200, serde_json::json!({ "ok": true, "ledger": verifier.ledger_len() }))
            } else {
                json(200, serde_json::json!({ "ok": true }))
            }
        }
        ("POST", "/v1/proofs") => {
            if !r.content_type.is_some_and(|c| c.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/octet-stream")) {
                return err(415, "CONTENT_TYPE_MUST_BE_OCTET_STREAM");
            }
            if !token_ok(verifier, r.authorization) {
                return err(401, "TOKEN_REQUIRED");
            }
            let verdict = verifier.submit(r.body);
            json(verdict.http_status(), serde_json::to_value(&verdict).unwrap_or_default())
        }
        (_, "/v1/proofs") | (_, "/v1/health") => err(405, "METHOD_NOT_ALLOWED"),
        _ => err(404, "NOT_FOUND"),
    }
}

fn write_response(stream: &mut TcpStream, verifier: &Verifier, r: &Response) {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        r.status,
        reason(r.status),
        r.body.len()
    );
    if r.status == 429 {
        head.push_str("Retry-After: 1\r\n");
    }
    if let Some(origin) = verifier.allow_origin() {
        head.push_str(&format!(
            "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nVary: Origin\r\n"
        ));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(r.body.as_bytes());
    let _ = stream.write_all(&out);
    let _ = stream.flush();
    linger_close(stream);
}

/// Lingering close: closing a socket with unread input sends a TCP RST, which
/// can wipe the response before the client reads it (an early 413 or 408).
/// Half-close, then drain briefly (bounded in bytes and time).
fn linger_close(stream: &mut TcpStream) {
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let mut sink = [0u8; 512];
    let mut drained = 0usize;
    while drained < 16 * 1024 {
        match stream.read(&mut sink) {
            Ok(0) | Err(_) => break,
            Ok(n) => drained += n,
        }
    }
}

/// Reads with a deadline for the whole request, not per `read()` call.
fn read_some(stream: &mut TcpStream, deadline: Instant, buf: &mut [u8]) -> Result<usize, u16> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(408);
    }
    let _ = stream.set_read_timeout(Some(left));
    match stream.read(buf) {
        Ok(0) => Err(0),
        Ok(n) => Ok(n),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Err(408),
        Err(_) => Err(0),
    }
}

enum Parsed {
    Ok { method: String, path: String, headers: Vec<(String, String)>, body: Vec<u8> },
    Fail(u16, &'static str),
    Gone,
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
}

fn read_request(stream: &mut TcpStream) -> Parsed {
    let deadline = Instant::now() + DEADLINE;
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let mut scanned = 0;
    let head_end = loop {
        if let Some(i) = buf[scanned..].windows(4).position(|w| w == b"\r\n\r\n") {
            break scanned + i;
        }
        scanned = buf.len().saturating_sub(3);
        if buf.len() > MAX_HEAD {
            return Parsed::Fail(431, "HEADERS_TOO_LARGE");
        }
        match read_some(stream, deadline, &mut chunk) {
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(0) => return Parsed::Gone,
            Err(_) => return Parsed::Fail(408, "REQUEST_TIMEOUT"),
        }
    };
    if head_end > MAX_HEAD {
        return Parsed::Fail(431, "HEADERS_TOO_LARGE");
    }

    let Ok(head) = std::str::from_utf8(&buf[..head_end]) else {
        return Parsed::Fail(400, "BAD_REQUEST");
    };
    let mut lines = head.split("\r\n");
    let parts: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
    let (method, path) = match parts.as_slice() {
        [m, p, v] if v.starts_with("HTTP/1.") && !m.is_empty() && p.starts_with('/') => (m.to_string(), p.to_string()),
        _ => return Parsed::Fail(400, "BAD_REQUEST_LINE"),
    };
    let mut headers = Vec::new();
    for line in lines {
        let Some((k, v)) = line.split_once(':') else {
            return Parsed::Fail(400, "BAD_HEADER");
        };
        if k.is_empty() || k != k.trim() || k.contains(char::is_whitespace) {
            return Parsed::Fail(400, "BAD_HEADER");
        }
        headers.push((k.to_string(), v.trim().to_string()));
    }
    if header(&headers, "transfer-encoding").is_some() {
        return Parsed::Fail(400, "TRANSFER_ENCODING_NOT_SUPPORTED");
    }
    let lengths: Vec<&str> = headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("content-length")).map(|(_, v)| v.as_str()).collect();
    if lengths.len() > 1 {
        return Parsed::Fail(400, "DUPLICATE_CONTENT_LENGTH");
    }

    let mut body = buf[head_end + 4..].to_vec();
    if method == "POST" {
        let len = match lengths.first() {
            None => return Parsed::Fail(411, "LENGTH_REQUIRED"),
            Some(v) if !v.is_empty() && v.len() <= 6 && v.bytes().all(|b| b.is_ascii_digit()) => v.parse::<usize>().unwrap_or(usize::MAX),
            Some(_) => return Parsed::Fail(400, "BAD_CONTENT_LENGTH"),
        };
        // Bound before reading (and before allocating) the body.
        // GPKT v2 frames (documents with an image) reach 131 150 bytes.
        if len > MAX_ANY_FRAME_SIZE {
            return Parsed::Fail(413, "FRAME_TOO_LARGE");
        }
        while body.len() < len {
            match read_some(stream, deadline, &mut chunk) {
                Ok(n) => body.extend_from_slice(&chunk[..n]),
                Err(0) => return Parsed::Fail(400, "INCOMPLETE_BODY"),
                Err(_) => return Parsed::Fail(408, "REQUEST_TIMEOUT"),
            }
        }
        body.truncate(len);
    } else {
        body.clear();
    }
    Parsed::Ok { method, path, headers, body }
}

/// Reads one request from `stream`, answers it, closes the connection.
pub fn handle(mut stream: TcpStream, verifier: &Verifier) {
    let _ = stream.set_write_timeout(Some(DEADLINE));
    let response = match read_request(&mut stream) {
        Parsed::Gone => return,
        Parsed::Fail(status, code) => err(status, code),
        Parsed::Ok { method, path, headers, body } => route(
            verifier,
            &Request {
                method: &method,
                path: &path,
                content_type: header(&headers, "content-type"),
                origin: header(&headers, "origin"),
                authorization: header(&headers, "authorization"),
                body: &body,
            },
        ),
    };
    write_response(&mut stream, verifier, &response);
}

/// Per-IP token bucket and connection counts.
#[derive(Default)]
struct Limits {
    buckets: HashMap<IpAddr, (f64, Instant)>,
    open: HashMap<IpAddr, usize>,
}

impl Limits {
    fn admit(&mut self, ip: IpAddr) -> Result<(), u16> {
        if self.open.get(&ip).copied().unwrap_or(0) >= MAX_PER_IP {
            return Err(503);
        }
        if self.buckets.len() > MAX_TRACKED_IPS {
            let now = Instant::now();
            self.buckets.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(60));
        }
        let now = Instant::now();
        let (tokens, last) = self.buckets.entry(ip).or_insert((RATE_BURST, now));
        *tokens = (*tokens + now.duration_since(*last).as_secs_f64() * RATE_PER_SEC).min(RATE_BURST);
        *last = now;
        if *tokens < 1.0 {
            return Err(429);
        }
        *tokens -= 1.0;
        *self.open.entry(ip).or_insert(0) += 1;
        Ok(())
    }

    fn release(&mut self, ip: IpAddr) {
        if let Some(n) = self.open.get_mut(&ip) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                self.open.remove(&ip);
            }
        }
    }
}

/// Decrements the counters even if a handler ever panics.
struct Slot {
    active: Arc<AtomicUsize>,
    limits: Arc<Mutex<Limits>>,
    ip: IpAddr,
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
        if let Ok(mut l) = self.limits.lock() {
            l.release(self.ip);
        }
    }
}

fn reject_fast(mut stream: TcpStream, verifier: &Verifier, status: u16, code: &str) {
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    write_response(&mut stream, verifier, &err(status, code));
}

/// Accept loop. Each admitted connection runs on its own thread.
pub fn serve(listener: TcpListener, verifier: Arc<Verifier>) {
    let active = Arc::new(AtomicUsize::new(0));
    let limits = Arc::new(Mutex::new(Limits::default()));
    loop {
        let (stream, peer) = match listener.accept() {
            Ok(s) => s,
            Err(_) => {
                // EMFILE and friends: back off instead of spinning.
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        let ip = peer.ip();
        if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            reject_fast(stream, &verifier, 503, "BUSY");
            continue;
        }
        let admitted = limits.lock().map(|mut l| l.admit(ip)).unwrap_or(Err(503));
        if let Err(status) = admitted {
            reject_fast(stream, &verifier, status, if status == 429 { "RATE_LIMITED" } else { "TOO_MANY_CONNECTIONS" });
            continue;
        }
        active.fetch_add(1, Ordering::SeqCst);
        let slot = Slot {
            active: Arc::clone(&active),
            limits: Arc::clone(&limits),
            ip,
        };
        let v = Arc::clone(&verifier);
        let spawned = std::thread::Builder::new().name("gpkt-conn".into()).spawn(move || {
            let _slot = slot;
            handle(stream, &v);
        });
        if spawned.is_err() {
            // Thread could not start: the closure (and its Slot) was dropped, counters restored.
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
