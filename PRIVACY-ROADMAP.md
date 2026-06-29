Privacy & Security Enhancement Roadmap
======================================

This is a working list of privacy-enhancing features for this fork, with an
honest read on effort and risk. Two are already implemented on the
`pgp-encryption` branch; the rest are candidates to pick from.

Already done (this branch)
--------------------------

* **At-rest PGP encryption of incoming mail.** Per-account public key in the
  control panel; new mail is encrypted to it (PGP/MIME) at delivery, after spam
  filtering, before hitting disk. Opt-in, fails open (never drops mail). See
  `conf/pgp-encrypt.py`, `security.md`.

* **Passkeys (WebAuthn) for the control panel.** Phishing-resistant second
  factor alongside the existing TOTP. Fully implemented; inactive until the
  optional `webauthn` package is installed (it needs a `cryptography` bump that
  touches the TLS code, so it's gated on validating cert provisioning first).
  See `management/mfa.py`, `setup/management.sh`.

Already strong in stock Mail-in-a-Box (no work needed)
------------------------------------------------------

* Outgoing mail header scrubbing already strips `User-Agent`, `X-Mailer`,
  `X-Originating-IP`, `X-Enigmail`, `X-Pgp-Agent`, rewrites the first `Received:`
  line to hide the sender's home IP, and collapses `Mime-Version` comments.
  ([conf/postfix_outgoing_mail_header_filters](conf/postfix_outgoing_mail_header_filters))
* Backups are already encrypted (duplicity with a local key).
* All client-facing services are TLS-only with modern ciphers; HSTS is set.

Candidates, roughly by value/effort
-----------------------------------

1. **Webmail anti-tracking defaults (Roundcube).** Force "block remote/external
   images" so tracking pixels don't phone home until the user opts in per
   message, and disable automatic read receipts (MDN). Small, low-risk config
   change in `setup/webmail.sh`. *Effort: low. Risk: low.* Strongly recommended.

2. **Autocrypt headers on outbound mail.** Add the `Autocrypt:` header so two
   users who both have a PGP key get opportunistic end-to-end encryption
   negotiated automatically by compatible clients. Pairs naturally with the
   at-rest PGP feature and the per-account key store we already added.
   *Effort: medium. Risk: low.*

3. **Roundcube Enigma (PGP) plugin.** Lets webmail users decrypt the at-rest
   encrypted mail in the browser. Tradeoff: the private key (or its passphrase)
   has to be available to the browser/server, which weakens the at-rest threat
   model — best offered as an explicit, clearly-labeled opt-in. *Effort: medium.
   Risk: medium (key-handling UX).*

4. **Tor onion service for webmail/IMAP/control panel.** Publish a `.onion` and
   serve the same nginx/dovecot endpoints over it, so users can reach their mail
   without exposing network metadata. *Effort: medium. Risk: low-moderate.*

5. **Log minimization / IP anonymization.** Shorten mail-log retention and/or
   mask the last octet of client IPs in stored logs. Direct metadata-at-rest
   win, but trades off against `fail2ban` and debugging, so it should be a
   toggle, not a default. *Effort: low-medium. Risk: medium (fail2ban).*

6. **App-specific passwords for IMAP/SMTP.** Revocable, per-device credentials
   so a phone or client never holds the primary password, and a lost device can
   be cut off without a global password reset. Security more than privacy, but
   high practical value and it composes with the control-panel MFA work.
   *Effort: medium-high (Dovecot auth + UI). Risk: medium.*

7. **Outbound DNS-over-TLS for the recursive resolver.** Encrypt the box's own
   DNS lookups (MX resolution, blocklists) so the upstream network can't observe
   who your users mail. *Effort: medium. Risk: low-moderate (resolver config).*

8. **Per-recipient "require at-rest encryption" enforcement.** Extend the PGP
   feature with an admin switch that *defers* (instead of storing plaintext)
   when an account that is marked encryption-required has no usable key — for
   users who would rather bounce than store cleartext. *Effort: low. Risk: low*
   (changes the current fail-open default for opted-in accounts only).

Suggested next step
-------------------

#1 (webmail anti-tracking defaults) is the cheapest real win and a good next
commit. #2 (Autocrypt) is the most natural follow-on to the PGP work. The
remaining items are larger and worth scoping individually.
