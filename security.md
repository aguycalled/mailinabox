Mail-in-a-Box Security Guide
============================

Mail-in-a-Box turns a fresh Ubuntu 22.04 LTS 64-bit machine into a mail server appliance by installing and configuring various components.

This page documents the security posture of Mail-in-a-Box. The term “box” is used below to mean a configured Mail-in-a-Box.

Reporting Security Vulnerabilities
----------------------------------

Security vulnerabilities should be reported to the [project's maintainer](https://joshdata.me) via email.

Threat Model
------------

Nothing is perfectly secure, and an adversary with sufficient resources can always penetrate a system.

The primary goal of Mail-in-a-Box is to make deploying a good mail server easy, so we balance ― as everyone does ― privacy and security concerns with the practicality of actually deploying the system. That means we make certain assumptions about adversaries. We assume that adversaries . . .

* Do not have physical access to the box (i.e., we do not aim to protect the box from physical access).
* Have not been given Unix accounts on the box (i.e., we assume all users with shell access are trusted).

On the other hand, we do assume that adversaries are performing passive surveillance and, possibly, active man-in-the-middle attacks. And so:

* User credentials are always sent through SSH/TLS, never in the clear, with modern TLS settings.
* Outbound mail is sent with the highest level of TLS possible.
* The box advertises its support for [DANE TLSA](https://en.wikipedia.org/wiki/DNS-based_Authentication_of_Named_Entities), when DNSSEC is enabled at the domain name registrar, so that inbound mail is more likely to be transmitted securely.

Additional details follow.

User Credentials
----------------

The box's administrator and its (non-administrative) mail users must sometimes communicate their credentials to the box.

### Services behind TLS

These services are protected by [TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security):

* SMTP Submission (ports 465/587). Mail users submit outbound mail through SMTP with TLS (port 465) or STARTTLS (port 587).
* IMAP/POP (ports 993, 995). Mail users check for incoming mail through IMAP or POP over TLS.
* HTTPS (port 443). Webmail, the Exchange/ActiveSync protocol, the administrative control panel, and any static hosted websites are accessed over HTTPS.

The services all follow these rules:

* TLS certificates are generated with 2048-bit RSA keys and SHA-256 fingerprints. The box provides a self-signed certificate by default. The [setup guide](https://mailinabox.email/guide.html) explains how to verify the certificate fingerprint on first login. Users are encouraged to replace the certificate with a proper CA-signed one. ([source](setup/ssl.sh))
* Only TLSv1.2+ are offered (the older SSL protocols are not offered).
* We track the [Mozilla Intermediate Ciphers Recommendation](https://wiki.mozilla.org/Security/Server_Side_TLS), balancing security with supporting a wide range of mail clients. Diffie-Hellman ciphers use a 2048-bit key for forward secrecy. For more details, see the [output of SSLyze for these ports](tests/tls_results.txt).

Additionally:

* SMTP Submission on port 587 will not accept user credentials without STARTTLS (true also of SMTP on port 25 in case of client misconfiguration), and the submission port won't accept mail without encryption. The minimum cipher key length is 128 bits. (The box is of course configured not to be an open relay. User credentials are required to send outbound mail.) ([source](setup/mail-postfix.sh))
* HTTPS (port 443): The HTTPS Strict Transport Security header is set. A redirect from HTTP to HTTPS is offered. The [Qualys SSL Labs test](https://www.ssllabs.com/ssltest) should report an A+ grade. ([source 1](conf/nginx-ssl.conf), [source 2](conf/nginx.conf))

### Password Storage

The passwords for mail users are stored on disk using the [SHA512-CRYPT](http://man7.org/linux/man-pages/man3/crypt.3.html) hashing scheme. ([source](management/mailconfig.py)) Password changes (as well as changes to control panel two-factor authentication settings) expire any control panel login sessions.

### Control Panel Authentication

Logging into the administrative control panel requires the user's email address and password. Users may additionally enable one or more second factors, which are then required to log in: ([source](management/mfa.py))

* **Authenticator app (TOTP).** A six-digit time-based code from an app such as FreeOTP. The shared secret is stored on the box; a replay guard rejects a code that was just used.
* **Passkeys (WebAuthn).** A hardware security key, phone, or the computer's built-in biometric authenticator. Only the credential's public key and signature counter are stored on the box, the private key never leaves the authenticator, and the credential is cryptographically bound to the box's hostname, which makes passkey logins phishing-resistant. After the password is verified, the browser must sign a fresh server-issued challenge; the signature is checked against the stored public key and the signature counter is advanced to detect cloned authenticators.

Any one enabled second factor satisfies the check. Changing a user's password or their set of second factors invalidates all of that user's existing control-panel sessions. These factors protect the control panel only, not IMAP/SMTP/webmail logins.

Passkey support depends on the optional `webauthn` Python package. It is not installed by default (it requires a newer `cryptography` than the pinned version, which also affects the certificate code), so passkeys are inactive until an administrator installs it; see [setup/management.sh](setup/management.sh).

### Console access

Console access (e.g. via SSH) is configured by the system image used to create the box, typically from by a cloud virtual machine provider (e.g. Digital Ocean). Mail-in-a-Box does not set any console access settings, although it will warn the administrator in the System Status Checks if password-based login is turned on.

The [setup guide video](https://mailinabox.email/) explains how to verify the host key fingerprint on first login.

If DNSSEC is enabled at the box's domain name's registrar, the SSHFP record that the box automatically puts into DNS can also be used to verify the host key fingerprint by setting `VerifyHostKeyDNS yes` in your `ssh/.config` file or by logging in with `ssh -o VerifyHostKeyDNS=yes`. ([source](management/dns_update.py))

### Brute-force attack mitigation

`fail2ban` provides some protection from brute-force login attacks (repeated logins that guess account passwords) by blocking offending IP addresses at the network level.

The following services are protected: SSH, IMAP (dovecot), SMTP submission (postfix), webmail (roundcube), Nextcloud/CalDAV/CardDAV (over HTTP), and the Mail-in-a-Box control panel (over HTTP).

Some other services running on the box may be missing fail2ban filters.

Outbound Mail
-------------

The basic protocols of email delivery did not plan for the presence of adversaries on the network. For a number of reasons it is not possible in most cases to guarantee that a connection to a recipient server is secure.

### DNSSEC

The first step in resolving the destination server for an email address is performing a DNS look-up for the MX record of the domain name. The box uses a locally-running [DNSSEC](https://en.wikipedia.org/wiki/DNSSEC)-aware nameserver to perform the lookup. If the domain name has DNSSEC enabled, DNSSEC guards against DNS records being tampered with.

### Encryption

The box (along with the vast majority of mail servers) uses [opportunistic encryption](https://en.wikipedia.org/wiki/Opportunistic_encryption), meaning the mail is encrypted in transit and protected from passive eavesdropping, but it is not protected from an active man-in-the-middle attack. Modern encryption settings (TLSv1 and later, no RC4) will be used to the extent the recipient server supports them. ([source](setup/mail-postfix.sh))

### DANE

If the recipient's domain name supports DNSSEC and has published a [DANE TLSA](https://en.wikipedia.org/wiki/DNS-based_Authentication_of_Named_Entities) record, then on-the-wire encryption is forced between the box and the recipient MTA and this encryption is not subject to a man-in-the-middle attack. The TLSA record contains a certificate fingerprint which the receiving MTA (server) must present to the box. ([source](setup/mail-postfix.sh))

### Domain Policy Records

Domain policy records allow recipient MTAs to detect when the _domain_ part of of the sender address in incoming mail has been spoofed. All outbound mail is signed with [DKIM](https://en.wikipedia.org/wiki/DomainKeys_Identified_Mail) and "quarantine" [DMARC](https://en.wikipedia.org/wiki/DMARC) records are automatically set in DNS. Receiving MTAs that implement DMARC will automatically quarantine mail that is "From:" a domain hosted by the box but which was not sent by the box. (Strong [SPF](https://en.wikipedia.org/wiki/Sender_Policy_Framework) records are also automatically set in DNS.) ([source](management/dns_update.py))

### User Policy

While domain policy records prevent other servers from sending mail with a "From:" header that matches a domain hosted on the box (see above), those policy records do not guarantee that the user portion of the sender email address matches the actual sender. In enterprise environments where the box may host the mail of untrusted users, it is important to guard against users impersonating other users.

The box restricts the envelope sender address (also called the return path or MAIL FROM address --- this is different from the "From:" header) that users may put into outbound mail. The envelope sender address must be either their own email address (their SMTP login username) or any alias that they are listed as a permitted sender of. (There is currently no restriction on the contents of the "From:" header.)

Incoming Mail
-------------

### Encryption Settings

As with outbound email, there is no way to require on-the-wire encryption of incoming mail from all senders. When the box receives an incoming email (SMTP on port 25), it offers encryption (STARTTLS) but cannot require that senders use it because some senders may not support STARTTLS at all and other senders may support STARTTLS but not with the latest protocols/ciphers. To give senders the best chance at making use of encryption, the box offers protocols back to TLSv1 and ciphers with key lengths as low as 112 bits. Modern clients (senders) will make use of the 256-bit ciphers and Diffie-Hellman ciphers with a 2048-bit key for perfect forward secrecy, however. ([source](setup/mail-postfix.sh))

### MTA-STS

The box publishes a SMTP MTA Strict Transport Security ([SMTP MTA-STS](https://en.wikipedia.org/wiki/Simple_Mail_Transfer_Protocol#SMTP_MTA_Strict_Transport_Security)) policy (via DNS and HTTPS) in "enforce" mode. Senders that support MTA-STS will use a secure SMTP connection. (MTA-STS tells senders to connect and expect a signed TLS certificate for the "MX" domain without permitting a fallback to an unencrypted connection.)

### DANE

When DNSSEC is enabled at the box's domain name's registrar, [DANE TLSA](https://en.wikipedia.org/wiki/DNS-based_Authentication_of_Named_Entities) records are automatically published in DNS. Senders supporting DANE will enforce encryption on-the-wire between them and the box --- see the section on DANE for outgoing mail above. ([source](management/dns_update.py))

### Filters

Incoming mail is run through several filters. Email is bounced if the sender's IP address is listed in the [Spamhaus Zen blacklist](http://www.spamhaus.org/zen/) or if the sender's domain is listed in the [Spamhaus Domain Block List](http://www.spamhaus.org/dbl/). Greylisting (with [postgrey](http://postgrey.schweikert.ch/)) is also used to cut down on spam. ([source](setup/mail-postfix.sh))

Mail Storage (At-Rest Encryption)
---------------------------------

By default mail is stored unencrypted on disk in each user's Maildir, readable by anyone with root or `mail`-user access to the box.

Optionally, an administrator can upload a per-account PGP public key in the control panel (Users → "encryption"). When a key is present, incoming mail for that account is encrypted to the key at delivery time and only the ciphertext is written to disk. This happens in a Dovecot Sieve `filter` action (`sieve_extprograms`) that runs *after* SpamAssassin and the spam-sorting Sieve, so spam filtering still works on the plaintext. ([source](conf/pgp-encrypt.py), [source](setup/mail-dovecot.sh))

This protects the *contents* of stored mail against an adversary who later gains read access to the disk (e.g. a stolen backup or disk image), provided the corresponding private key is not on the box. Important limitations:

* Only the message **body** is encrypted, as a [PGP/MIME](https://datatracker.ietf.org/doc/html/rfc3156) (RFC 3156) part. Routing headers — including **Subject**, From, To and Date — remain in clear text because IMAP needs them, so message metadata is not protected.
* It protects mail **at rest after delivery**, not in transit; on-the-wire protection is covered by the sections above. Mail sitting in queues or scanned in memory before the filter runs is not covered.
* Only **inbound** mail is encrypted. Messages the user sends, saves to Drafts, or that were already stored before a key was uploaded are not changed.
* If an account has no key, or encryption fails for any reason, the message is stored **unencrypted** — the filter never discards or defers mail.
* Webmail (Roundcube) and any client without the private key will display ciphertext. Decryption must happen in a PGP-capable client (e.g. Thunderbird, or Roundcube's Enigma plugin) holding the private key. To preserve the security benefit, the private key should **not** be stored on the box.
* Only public keys are stored on the box, under `$STORAGE_ROOT/mail/pgp_keys`. The control panel refuses to store a private key.
