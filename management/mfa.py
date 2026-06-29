import base64
import hmac
import io
import json
import os
import pyotp
import qrcode

from expiringdict import ExpiringDict

from mailconfig import open_database

# Short-lived store of pending WebAuthn (passkey) challenges, keyed by email.
# The control panel runs a single gunicorn worker (see setup/management.sh), so
# an in-process store is fine -- the same process that issues a challenge also
# verifies the response. Challenges expire after five minutes.
_webauthn_challenges = ExpiringDict(max_len=256, max_age_seconds=300)

def get_user_id(email, c):
	c.execute('SELECT id FROM users WHERE email=?', (email,))
	r = c.fetchone()
	if not r: raise ValueError("User does not exist.")
	return r[0]

def get_mfa_state(email, env):
	c = open_database(env)
	c.execute('SELECT id, type, secret, mru_token, label FROM mfa WHERE user_id=?', (get_user_id(email, c),))
	return [
		{ "id": r[0], "type": r[1], "secret": r[2], "mru_token": r[3], "label": r[4] }
		for r in c.fetchall()
	]

def get_public_mfa_state(email, env):
	mfa_state = get_mfa_state(email, env)
	return [
		{ "id": s["id"], "type": s["type"], "label": s["label"] }
		for s in mfa_state
	]

def get_hash_mfa_state(email, env):
	mfa_state = get_mfa_state(email, env)
	return [
		{ "id": s["id"], "type": s["type"], "secret": s["secret"] }
		for s in mfa_state
	]

def enable_mfa(email, type, secret, token, label, env):
	if type == "totp":
		validate_totp_secret(secret)
		# Sanity check with the provide current token.
		totp = pyotp.TOTP(secret)
		if not totp.verify(token, valid_window=1):
			msg = "Invalid token."
			raise ValueError(msg)
	else:
		msg = "Invalid MFA type."
		raise ValueError(msg)

	conn, c = open_database(env, with_connection=True)
	c.execute('INSERT INTO mfa (user_id, type, secret, label) VALUES (?, ?, ?, ?)', (get_user_id(email, c), type, secret, label))
	conn.commit()

def set_mru_token(email, mfa_id, token, env):
	conn, c = open_database(env, with_connection=True)
	c.execute('UPDATE mfa SET mru_token=? WHERE user_id=? AND id=?', (token, get_user_id(email, c), mfa_id))
	conn.commit()

def disable_mfa(email, mfa_id, env):
	conn, c = open_database(env, with_connection=True)
	if mfa_id is None:
		# Disable all MFA for a user.
		c.execute('DELETE FROM mfa WHERE user_id=?', (get_user_id(email, c),))
	else:
		# Disable a particular MFA mode for a user.
		c.execute('DELETE FROM mfa WHERE user_id=? AND id=?', (get_user_id(email, c), mfa_id))
	conn.commit()
	return c.rowcount > 0

def validate_totp_secret(secret):
	if not isinstance(secret, str) or secret.strip() == "":
		msg = "No secret provided."
		raise ValueError(msg)
	if len(secret) != 32:
		msg = "Secret should be a 32 characters base32 string"
		raise ValueError(msg)

def provision_totp(email, env):
	# Make a new secret.
	secret = base64.b32encode(os.urandom(20)).decode('utf-8')
	validate_totp_secret(secret) # sanity check

	# Make a URI that we encode within a QR code.
	uri = pyotp.TOTP(secret).provisioning_uri(
		name=email,
		issuer_name=env["PRIMARY_HOSTNAME"] + " Mail-in-a-Box Control Panel"
	)

	# Generate a QR code as a base64-encode PNG image.
	qr = qrcode.make(uri)
	byte_arr = io.BytesIO()
	qr.save(byte_arr, format='PNG')
	png_b64 = base64.b64encode(byte_arr.getvalue()).decode('utf-8')

	return {
		"type": "totp",
		"secret": secret,
		"qr_code_base64": png_b64
	}

# ### WebAuthn (passkeys / security keys) ###
#
# Passkeys are stored in the same `mfa` table as a row with type "webauthn".
# The `secret` column holds a JSON blob with the credential id, public key and
# signature counter; `label` is a user-chosen name for the authenticator.
#
# The webauthn library is imported lazily inside each function so that the rest
# of MFA (and the whole control panel) keeps working even if the package isn't
# installed yet -- a missing library disables passkeys, it doesn't break login.

def get_webauthn_rp(env):
	# The Relying Party is the control panel hostname. Browsers bind a passkey
	# to this exact origin, so passkeys only work when reaching the panel via
	# the box's primary hostname over HTTPS.
	hostname = env["PRIMARY_HOSTNAME"]
	return {
		"rp_id": hostname,
		"rp_name": hostname + " Mail-in-a-Box Control Panel",
		"origin": "https://" + hostname,
	}

def get_webauthn_credentials(email, env):
	# Return the parsed webauthn credentials for the user.
	creds = []
	for s in get_mfa_state(email, env):
		if s["type"] == "webauthn":
			data = json.loads(s["secret"])
			data["mfa_id"] = s["id"]
			creds.append(data)
	return creds

def begin_webauthn_registration(email, env):
	# Produce the options the browser needs to create a new passkey, and stash
	# the challenge so we can verify the browser's response. Returns a JSON
	# string ready to hand to navigator.credentials.create().
	import webauthn
	from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
	from webauthn.helpers.structs import (
		PublicKeyCredentialDescriptor, AuthenticatorSelectionCriteria,
		ResidentKeyRequirement, UserVerificationRequirement)

	rp = get_webauthn_rp(env)
	c = open_database(env)
	user_id = get_user_id(email, c)

	exclude = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(cred["credential_id"]))
		for cred in get_webauthn_credentials(email, env)]

	options = webauthn.generate_registration_options(
		rp_id=rp["rp_id"],
		rp_name=rp["rp_name"],
		user_id=str(user_id).encode("utf-8"),
		user_name=email,
		user_display_name=email,
		exclude_credentials=exclude,
		authenticator_selection=AuthenticatorSelectionCriteria(
			resident_key=ResidentKeyRequirement.PREFERRED,
			user_verification=UserVerificationRequirement.PREFERRED,
		),
	)

	_webauthn_challenges["reg:" + email] = options.challenge
	return webauthn.options_to_json(options)

def complete_webauthn_registration(email, credential_json, label, env):
	# Verify the browser's attestation against the stashed challenge and, on
	# success, store the new passkey as an mfa row.
	import webauthn
	from webauthn.helpers import bytes_to_base64url

	challenge = _webauthn_challenges.get("reg:" + email)
	if challenge is None:
		msg = "The registration request expired. Please try again."
		raise ValueError(msg)

	rp = get_webauthn_rp(env)
	try:
		# The webauthn library accepts the browser's credential as a raw JSON string.
		verification = webauthn.verify_registration_response(
			credential=credential_json,
			expected_challenge=challenge,
			expected_rp_id=rp["rp_id"],
			expected_origin=rp["origin"],
		)
	except Exception as e:
		raise ValueError("Could not register this passkey: " + str(e))
	finally:
		_webauthn_challenges.pop("reg:" + email, None)

	secret = json.dumps({
		"credential_id": bytes_to_base64url(verification.credential_id),
		"public_key": bytes_to_base64url(verification.credential_public_key),
		"sign_count": verification.sign_count,
	})

	conn, c = open_database(env, with_connection=True)
	c.execute('INSERT INTO mfa (user_id, type, secret, label) VALUES (?, ?, ?, ?)',
		(get_user_id(email, c), "webauthn", secret, label or "Passkey"))
	conn.commit()

def begin_webauthn_authentication(email, env):
	# Produce the options the browser needs to sign in with an existing passkey,
	# stashing the challenge. Returns a JSON string, or None if the user has no
	# passkeys registered.
	import webauthn
	from webauthn.helpers import base64url_to_bytes
	from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement

	creds = get_webauthn_credentials(email, env)
	if not creds:
		return None

	rp = get_webauthn_rp(env)
	options = webauthn.generate_authentication_options(
		rp_id=rp["rp_id"],
		allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(cred["credential_id"]))
			for cred in creds],
		user_verification=UserVerificationRequirement.PREFERRED,
	)

	_webauthn_challenges["auth:" + email] = options.challenge
	return webauthn.options_to_json(options)

def validate_webauthn_assertion(email, assertion_json, env):
	# Verify a passkey assertion against the stashed challenge and the stored
	# public key. On success, advances the stored signature counter (a clone
	# detection measure) and returns True. Returns False on any failure.
	import webauthn
	from webauthn.helpers import base64url_to_bytes

	challenge = _webauthn_challenges.get("auth:" + email)
	if challenge is None:
		return False

	# Parse the assertion JSON just enough to find which stored credential it is.
	try:
		assertion = json.loads(assertion_json)
		assertion_cred_id = assertion.get("id") or assertion.get("rawId")
	except Exception:
		return False
	if not assertion_cred_id:
		return False

	# Find the stored credential whose id matches the assertion (both base64url).
	target = None
	for stored in get_webauthn_credentials(email, env):
		if stored["credential_id"] == assertion_cred_id:
			target = stored
			break
	if target is None:
		return False

	rp = get_webauthn_rp(env)
	try:
		# The webauthn library accepts the assertion as a raw JSON string.
		verification = webauthn.verify_authentication_response(
			credential=assertion_json,
			expected_challenge=challenge,
			expected_rp_id=rp["rp_id"],
			expected_origin=rp["origin"],
			credential_public_key=base64url_to_bytes(target["public_key"]),
			credential_current_sign_count=target.get("sign_count", 0),
		)
	except Exception:
		return False
	finally:
		_webauthn_challenges.pop("auth:" + email, None)

	# Persist the advanced signature counter.
	update_webauthn_sign_count(email, target["mfa_id"], verification.new_sign_count, env)
	return True

def update_webauthn_sign_count(email, mfa_id, new_sign_count, env):
	conn, c = open_database(env, with_connection=True)
	c.execute('SELECT secret FROM mfa WHERE user_id=? AND id=?', (get_user_id(email, c), mfa_id))
	row = c.fetchone()
	if not row:
		return
	data = json.loads(row[0])
	data["sign_count"] = new_sign_count
	c.execute('UPDATE mfa SET secret=? WHERE user_id=? AND id=?', (json.dumps(data), get_user_id(email, c), mfa_id))
	conn.commit()


def validate_auth_mfa(email, request, env):
	# Validates that a login request satisfies any MFA modes
	# that have been enabled for the user's account. Returns
	# a tuple (status, [hints]). status is True for a successful
	# MFA login, False for a missing token. If status is False,
	# hints is an array of codes that indicate what the user
	# can try. Possible codes are:
	# "missing-totp-token"
	# "invalid-totp-token"
	# "missing-webauthn-assertion"
	# "invalid-webauthn-assertion"

	mfa_state = get_mfa_state(email, env)

	# If no MFA modes are added, return True.
	if len(mfa_state) == 0:
		return (True, [])

	# Try the enabled MFA modes. Any one satisfied mode logs the user in.
	hints = set()
	has_webauthn = False
	for mfa_mode in mfa_state:
		if mfa_mode["type"] == "totp":
			# Check that a token is present in the X-Auth-Token header.
			# If not, give a hint that one can be supplied.
			token = request.headers.get('x-auth-token')
			if not token:
				hints.add("missing-totp-token")
				continue

			# Check for a replay attack.
			if hmac.compare_digest(token, mfa_mode['mru_token'] or ""):
				# If the token fails, skip this MFA mode.
				hints.add("invalid-totp-token")
				continue

			# Check the token.
			totp = pyotp.TOTP(mfa_mode["secret"])
			if not totp.verify(token, valid_window=1):
				hints.add("invalid-totp-token")
				continue

			# On success, record the token to prevent a replay attack.
			set_mru_token(email, mfa_mode['id'], token, env)
			return (True, [])

		elif mfa_mode["type"] == "webauthn":
			has_webauthn = True

	# Handle passkeys after TOTP so a present TOTP token wins without needing a
	# WebAuthn round-trip. The assertion arrives in a form/JSON body field.
	if has_webauthn:
		assertion = request.form.get('webauthn_assertion') if request.form else None
		if not assertion:
			hints.add("missing-webauthn-assertion")
		elif validate_webauthn_assertion(email, assertion, env):
			return (True, [])
		else:
			hints.add("invalid-webauthn-assertion")

	# On a failed login, indicate failure and any hints for what the user can do instead.
	return (False, list(hints))
