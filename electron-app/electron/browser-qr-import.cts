// Owns the in-memory handoff, not OTP rules or persistence. Secrets never reach the renderer.
function createBrowserQrImport(options) {
  const requests = new Map();
  const payloads = new Map();
  const identities = new Map();
  const pending = [];
  let generation = 0;
  let revision = 0;
  let nextId = 0;
  const accepted = { accepted: true };
  const failure = (errorCode) => ({ accepted: false, errorCode });

  function snapshot() {
    const entry = pending[0];
    return {
      revision,
      review:
        entry?.account && options.isUnlocked()
          ? {
              id: entry.id,
              issuer: entry.account.issuer,
              accountName: entry.account.accountName,
              algorithm: entry.account.algorithm,
              digits: entry.account.digits,
              period: entry.account.period,
              saving: entry.saving,
              error: entry.error,
              queuedCount: pending.length,
            }
          : undefined,
    };
  }

  function publish() {
    revision += 1;
    options.onChanged(snapshot());
  }

  function remove(entry) {
    entry.account = undefined;
    const index = pending.indexOf(entry);
    if (index >= 0) pending.splice(index, 1);
  }

  function clear() {
    generation += 1;
    for (const entry of pending) {
      if (!entry.saving) forgetPayloads(entry);
      entry.account = undefined;
    }
    pending.length = 0;
    // Keep only IDs/fingerprints and outcomes for retries, never payloads or accounts.
    publish();
  }

  function forgetPayloads(entry) {
    for (const fingerprint of entry.fingerprints) payloads.delete(fingerprint);
    if (identities.get(entry.identity) === entry) identities.delete(entry.identity);
  }

  async function enqueue(request) {
    if (!options.isUnlocked()) return failure("APP_LOCKED");
    const known = requests.get(request.requestId);
    if (known) {
      return known.fingerprint === request.fingerprint ? known.result : failure("INVALID_REQUEST");
    }
    // Do not evict replay records and accidentally accept an old request again.
    if (requests.size >= 4096) return failure("INTERNAL_ERROR");
    const duplicate = payloads.get(request.fingerprint);
    if (duplicate) {
      requests.set(request.requestId, duplicate);
      return duplicate.result;
    }
    if (pending.length >= 16) return failure("INTERNAL_ERROR");
    const entry = {
      id: String(++nextId),
      fingerprints: [request.fingerprint],
      identity: undefined,
      account: undefined,
      saving: false,
      error: undefined,
    };
    const started = generation;
    pending.push(entry);
    const record = { fingerprint: request.fingerprint, result: undefined };
    requests.set(request.requestId, record);
    payloads.set(request.fingerprint, record);
    record.result = (async () => {
      try {
        const parsed = await options.parseQr(request.text);
        if (generation !== started || !options.isUnlocked()) {
          remove(entry);
          return failure("APP_LOCKED");
        }
        if (!parsed) {
          remove(entry);
          publish();
          return failure("INVALID_REQUEST");
        }
        const duplicate = identities.get(parsed.identity);
        if (duplicate) {
          duplicate.fingerprints.push(request.fingerprint);
          remove(entry);
          publish();
          return accepted;
        }
        entry.identity = parsed.identity;
        identities.set(entry.identity, entry);
        entry.account = parsed.account;
        publish();
        options.activate();
        return accepted;
      } catch {
        forgetPayloads(entry);
        remove(entry);
        publish();
        return failure("INTERNAL_ERROR");
      } finally {
        // Do not retain the authenticated request (and its text) in replay promises.
        request = undefined;
      }
    })();
    const result = await record.result;
    record.result = result;
    if (result.errorCode === "INTERNAL_ERROR" || result.errorCode === "APP_LOCKED") {
      // Nothing was queued: transient failures may safely be retried with the same ID.
      if (payloads.get(record.fingerprint) === record) payloads.delete(record.fingerprint);
      for (const [id, candidate] of requests) {
        if (candidate === record) requests.delete(id);
      }
    }
    return result;
  }

  function cancel(id) {
    const entry = pending.find((item) => item.id === id);
    if (!entry || entry.saving) return;
    forgetPayloads(entry);
    remove(entry);
    publish();
  }

  async function confirm(id) {
    if (!options.isUnlocked()) {
      clear();
      return { results: [] };
    }
    const entry = pending[0];
    if (!entry || entry.id !== id || !entry.account || entry.saving) return { results: [] };
    entry.saving = true;
    entry.error = undefined;
    publish();
    try {
      // The shared save adapter also checks protection immediately before each write.
      const result = await options.saveAccounts([entry.account]);
      if (result.results?.[0]?.success) {
        remove(entry);
      } else if (entry.account) {
        entry.error = "Unable to save the account. Try again or cancel the import.";
      } else {
        forgetPayloads(entry);
      }
      return result;
    } catch {
      if (entry.account)
        entry.error = "Unable to save the account. Try again or cancel the import.";
      else forgetPayloads(entry);
      return { results: [] };
    } finally {
      entry.saving = false;
      publish();
    }
  }

  return { enqueue, snapshot, confirm, cancel, clear };
}

module.exports = { createBrowserQrImport };
