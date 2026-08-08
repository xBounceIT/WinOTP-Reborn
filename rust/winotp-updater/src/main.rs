use std::io::{self, Read};

use winotp_updater::{run_request, UpdaterRequest, UpdaterResponse};

fn main() {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("Failed to read updater request: {error}");
        std::process::exit(1);
    }

    let response = match serde_json::from_str::<UpdaterRequest>(&input) {
        Ok(request) => match run_request(request) {
            Ok(response) => response,
            Err(error) => UpdaterResponse::failure(error),
        },
        Err(error) => UpdaterResponse::failure(format!("Invalid updater request: {error}")),
    };

    match serde_json::to_string(&response) {
        Ok(serialized) => println!("{serialized}"),
        Err(error) => {
            eprintln!("Failed to serialize updater response: {error}");
            std::process::exit(1);
        }
    }

    if !response.success {
        std::process::exit(2);
    }
}
