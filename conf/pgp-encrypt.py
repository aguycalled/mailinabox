#!/usr/bin/env python3
#
# Mail-in-a-Box PGP-at-rest delivery filter.
#
# Invoked by Dovecot's Sieve `filter` action (sieve_extprograms /
# vnd.dovecot.filter) at LMTP delivery time, AFTER SpamAssassin has scanned
# the message. The whole raw message arrives on stdin; whatever we write to
# stdout replaces it before it is written to the user's Maildir.
#
# Behaviour:
#   * argv[1] is the envelope recipient (passed by the global Sieve script).
#   * We look up that account's ASCII-armored public key in the keystore.
#   * If a key exists, we re-wrap the message as PGP/MIME (RFC 3156) encrypted
#     to that key. Only the body is encrypted; routing headers (From, To,
#     Subject, Date, ...) stay in clear text because IMAP needs them.
#   * If there is NO key, encryption fails, or anything at all goes wrong, we
#     pass the original message through UNCHANGED. Delivery must never lose
#     mail because of this filter.
#
# The keystore base path is substituted in by setup/mail-dovecot.sh.

import sys
import os
import re
import subprocess
import tempfile
import shutil

# Filled in at install time by setup/mail-dovecot.sh.
KEYSTORE = "###STORAGE_ROOT###/mail/pgp_keys"


def log(msg):
	# Goes to stderr, which Dovecot records in the mail log.
	sys.stderr.write("pgp-encrypt: " + msg + "\n")


def keyfile_for(recipient):
	# Map user@domain -> {KEYSTORE}/{domain}/{user}.asc, guarding against any
	# path traversal in the (untrusted) envelope address.
	recipient = recipient.strip().lower()
	if "@" not in recipient:
		return None
	user, domain = recipient.rsplit("@", 1)
	if not re.match(r'^[a-z0-9._+\-]+$', user) or not re.match(r'^[a-z0-9.\-]+$', domain):
		return None
	return os.path.join(KEYSTORE, domain, user + ".asc")


def split_headers_body(raw):
	# Split a raw RFC822 message (bytes) into the header block and the body at
	# the first blank line, tolerating both LF and CRLF line endings.
	m = re.search(rb'\r?\n\r?\n', raw)
	if not m:
		return raw, b''
	return raw[:m.start()], raw[m.end():]


def parse_headers(header_blob):
	# Return a list of (name, raw_value) tuples preserving order, with folded
	# (continuation) lines kept attached to their header.
	headers = []
	for line in re.split(rb'\r?\n', header_blob):
		if line[:1] in (b' ', b'\t') and headers:
			headers[-1] = (headers[-1][0], headers[-1][1] + b'\r\n' + line)
		elif b':' in line:
			name, _, value = line.partition(b':')
			headers.append((name.strip(), value))
	return headers


def is_content_header(name):
	low = name.lower()
	return low.startswith(b'content-') or low == b'mime-version'


def gpg_encrypt(keyfile, plaintext):
	# Encrypt `plaintext` (bytes) to the public key in `keyfile`, returning the
	# ASCII-armored ciphertext (bytes). Uses a throwaway GnuPG home so nothing
	# touches a persistent keyring.
	gnupghome = tempfile.mkdtemp(prefix="miab-pgp-")
	try:
		os.chmod(gnupghome, 0o700)
		base = ["gpg", "--homedir", gnupghome, "--batch", "--no-tty", "--quiet"]

		imp = subprocess.run(base + ["--import", keyfile],
			capture_output=True)
		if imp.returncode != 0:
			raise RuntimeError("key import failed: " + imp.stderr.decode("utf-8", "replace"))

		# Collect the PRIMARY fingerprint of each key we just imported, so we can
		# name them as explicit recipients (handles files with multiple keys).
		# We take the `fpr` line that follows a `pub` record only, not the ones
		# for subkeys, and let gpg select each key's encryption subkey itself.
		listing = subprocess.run(base + ["--with-colons", "--list-keys"],
			capture_output=True)
		fprs = []
		last = None
		for ln in listing.stdout.decode("utf-8", "replace").splitlines():
			rec = ln.split(":")
			if rec[0] in ("pub", "sub"):
				last = rec[0]
			elif rec[0] == "fpr" and last == "pub":
				fprs.append(rec[9])
				last = None
		if not fprs:
			raise RuntimeError("no usable public key in keyfile")

		recips = []
		for fpr in fprs:
			recips += ["--recipient", fpr]
		enc = subprocess.run(
			base + ["--trust-model", "always", "--armor", "--encrypt"] + recips,
			input=plaintext, capture_output=True)
		if enc.returncode != 0:
			raise RuntimeError("encrypt failed: " + enc.stderr.decode("utf-8", "replace"))
		return enc.stdout
	finally:
		shutil.rmtree(gnupghome, ignore_errors=True)


def build_pgp_mime(headers, body, ciphertext):
	# Assemble the outer PGP/MIME message: original non-content headers on the
	# outside, the encrypted original content as the second body part.
	boundary = "pgpmime-" + os.urandom(16).hex()
	out = bytearray()

	for name, value in headers:
		if is_content_header(name):
			continue
		out += name + b':' + value + b'\r\n'

	out += b'MIME-Version: 1.0\r\n'
	out += ('Content-Type: multipart/encrypted; protocol="application/pgp-encrypted";\r\n'
		' boundary="' + boundary + '"\r\n').encode()
	out += b'\r\n'
	out += b'This is an OpenPGP/MIME encrypted message (RFC 3156).\r\n'

	out += ('--' + boundary + '\r\n').encode()
	out += b'Content-Type: application/pgp-encrypted\r\n'
	out += b'Content-Description: PGP/MIME version identification\r\n\r\n'
	out += b'Version: 1\r\n\r\n'

	out += ('--' + boundary + '\r\n').encode()
	out += b'Content-Type: application/octet-stream; name="encrypted.asc"\r\n'
	out += b'Content-Description: OpenPGP encrypted message\r\n'
	out += b'Content-Disposition: inline; filename="encrypted.asc"\r\n\r\n'
	out += ciphertext
	if not ciphertext.endswith(b'\n'):
		out += b'\r\n'

	out += ('--' + boundary + '--\r\n').encode()
	return bytes(out)


def main():
	raw = sys.stdin.buffer.read()

	# Whatever happens below, on error we emit the original message untouched.
	try:
		recipient = sys.argv[1] if len(sys.argv) > 1 else ""
		keyfile = keyfile_for(recipient)
		if not keyfile or not os.path.exists(keyfile) or os.path.getsize(keyfile) == 0:
			sys.stdout.buffer.write(raw)
			return

		header_blob, body = split_headers_body(raw)
		headers = parse_headers(header_blob)

		# Don't double-encrypt an already PGP/MIME message.
		for name, value in headers:
			if name.lower() == b'content-type' and b'multipart/encrypted' in value.lower():
				sys.stdout.buffer.write(raw)
				return

		# Rebuild the inner MIME entity = original content headers + body, with
		# CRLF line endings, then encrypt it verbatim.
		inner = bytearray()
		had_ct = False
		for name, value in headers:
			if is_content_header(name):
				if name.lower() == b'content-type':
					had_ct = True
				inner += name + b':' + value + b'\r\n'
		if not had_ct:
			inner += b'Content-Type: text/plain; charset=utf-8\r\n'
		inner += b'\r\n'
		inner += re.sub(rb'\r?\n', b'\r\n', body)

		ciphertext = gpg_encrypt(keyfile, bytes(inner))
		sys.stdout.buffer.write(build_pgp_mime(headers, body, ciphertext))
	except Exception as e:
		log("passing message through unencrypted: " + str(e))
		sys.stdout.buffer.write(raw)


if __name__ == "__main__":
	main()
