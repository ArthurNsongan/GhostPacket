//! ghostpacket-verifier
//!
//! ```text
//! ghostpacket-verifier verify <file.gpkt>... [--trust <hex>]...
//! ghostpacket-verifier serve (--trust <hex>... | --tofu) [--addr 127.0.0.1:8787] [--ledger proofs.jsonl]
//!                            [--allow-origin <origin>] [--max-ledger N]
//! ```
//! Secrets come from the environment, never from the command line (visible in
//! the process list): GHOSTPACKET_PASSPHRASE opens encrypted proofs,
//! GHOSTPACKET_TOKEN requires `Authorization: Bearer <token>` on POST.

use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use ghostpacket_verifier::{http, parse_key, Config, Verdict, Verifier, DEFAULT_MAX_LEDGER};
use zeroize::Zeroizing;

const USAGE: &str = "usage:
  ghostpacket-verifier verify <file.gpkt>... [--trust <hex>]...
  ghostpacket-verifier serve (--trust <hex>... | --tofu) [--addr 127.0.0.1:8787] [--ledger proofs.jsonl]
                             [--allow-origin <origin>] [--max-ledger N]
env:
  GHOSTPACKET_PASSPHRASE  opens encrypted proofs (NFC form, as typed on the devices)
  GHOSTPACKET_TOKEN       requires 'Authorization: Bearer <token>' on POST";

struct Args {
    command: String,
    files: Vec<PathBuf>,
    trusted: Vec<[u8; 32]>,
    tofu: bool,
    addr: String,
    ledger: Option<PathBuf>,
    allow_origin: Option<String>,
    max_ledger: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let command = it.next().ok_or(USAGE)?;
    let mut a = Args {
        command,
        files: Vec::new(),
        trusted: Vec::new(),
        tofu: false,
        addr: "127.0.0.1:8787".into(),
        ledger: None,
        allow_origin: None,
        max_ledger: DEFAULT_MAX_LEDGER,
    };
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or(format!("{name} needs a value"));
        match arg.as_str() {
            "--trust" => a.trusted.push(parse_key(&value("--trust")?)?),
            "--tofu" => a.tofu = true,
            "--addr" => a.addr = value("--addr")?,
            "--ledger" => a.ledger = Some(PathBuf::from(value("--ledger")?)),
            "--allow-origin" => {
                let o = value("--allow-origin")?;
                if o == "*" || !(o.starts_with("https://") || o.starts_with("http://localhost") || o.starts_with("http://127.0.0.1")) {
                    return Err("--allow-origin must be one exact origin such as https://example.org (no '*')".into());
                }
                a.allow_origin = Some(o.trim_end_matches('/').to_string());
            }
            "--max-ledger" => a.max_ledger = value("--max-ledger")?.parse().map_err(|_| "--max-ledger needs a number")?,
            "-h" | "--help" => return Err(USAGE.into()),
            s if s.starts_with("--") => return Err(format!("unknown option {s}\n{USAGE}")),
            file => a.files.push(PathBuf::from(file)),
        }
    }
    Ok(a)
}

/// Reads at most 513 bytes (works for FIFOs and special files too).
fn read_bounded(path: &PathBuf) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(513);
    std::fs::File::open(path)?.take(513).read_to_end(&mut out)?;
    Ok(out)
}

fn env_secret(name: &str) -> Option<Zeroizing<String>> {
    std::env::var(name).ok().filter(|v| !v.is_empty()).map(Zeroizing::new)
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let passphrase = env_secret("GHOSTPACKET_PASSPHRASE");
    if passphrase.as_ref().is_some_and(|p| !p.is_ascii()) {
        eprintln!("note: GHOSTPACKET_PASSPHRASE has non-ASCII characters; it must be in Unicode NFC form, as the web app normalizes it");
    }
    let strict = !args.trusted.is_empty();
    if args.command == "serve" && !strict && !args.tofu {
        eprintln!("serve needs --trust <issuer key hex> (recommended) or an explicit --tofu to accept any valid signer\n{USAGE}");
        return ExitCode::from(2);
    }
    let token = env_secret("GHOSTPACKET_TOKEN");
    let has_token = token.is_some();
    let config = Config {
        trusted: args.trusted,
        passphrase,
        ledger_path: args.ledger,
        allow_origin: args.allow_origin,
        token,
        max_ledger: args.max_ledger,
    };
    let verifier = match Verifier::new(config) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };

    match args.command.as_str() {
        "verify" => {
            if args.files.is_empty() {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            }
            let mut failed = false;
            for path in &args.files {
                let verdict = match read_bounded(path) {
                    Ok(bytes) => verifier.submit(&bytes),
                    Err(e) => Verdict::Rejected { code: "READ_FAILED".into(), message: e.to_string() },
                };
                failed |= !matches!(verdict, Verdict::Accepted { .. });
                println!("{}", serde_json::json!({ "file": path.display().to_string(), "verdict": verdict }));
            }
            if failed {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
        "serve" => {
            let listener = match TcpListener::bind(&args.addr) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("cannot listen on {}: {e}", args.addr);
                    return ExitCode::from(2);
                }
            };
            eprintln!(
                "ghostpacket-verifier on http://{} · {} · {} · ledger {} entr(y/ies) · CORS {}",
                args.addr,
                if strict { "strict keyring" } else { "trust on first use" },
                if has_token { "token required" } else { "no token (anyone can submit)" },
                verifier.ledger_len(),
                verifier.allow_origin().unwrap_or("off"),
            );
            http::serve(listener, Arc::new(verifier));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
