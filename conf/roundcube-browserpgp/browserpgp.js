/**
 * Browser PGP for Roundcube — client side.
 *
 * The private key is stored ONLY in this browser, in localStorage, as an
 * ASCII-armored OpenPGP key that is itself passphrase-encrypted. The passphrase
 * is never stored and never sent to the server. All crypto runs here via
 * OpenPGP.js. The server only ever receives PUBLIC keys.
 */
(function () {
  "use strict";

  var LS_PRIV = "browserpgp.privkey"; // armored, passphrase-encrypted
  var LS_PUB = "browserpgp.pubkey"; // armored public key
  var LS_CONTACTS = "browserpgp.contacts"; // { email: armoredPublicKey }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function contacts() { try { return JSON.parse(lsGet(LS_CONTACTS) || "{}"); } catch (e) { return {}; } }
  function saveContacts(c) { lsSet(LS_CONTACTS, JSON.stringify(c)); }

  function haveOpenPGP() { return typeof openpgp !== "undefined"; }

  // Decrypt the locally stored private key with a passphrase (in memory only).
  async function unlockPrivateKey(passphrase) {
    var armored = lsGet(LS_PRIV);
    if (!armored) throw new Error("No private key is stored in this browser.");
    var key = await openpgp.readPrivateKey({ armoredKey: armored });
    if (passphrase) {
      key = await openpgp.decryptKey({ privateKey: key, passphrase: passphrase });
    }
    return key;
  }

  // Fetch a recipient's public key: local contacts first, then the server
  // public-key directory (for local accounts).
  async function recipientKey(email) {
    email = (email || "").toLowerCase().trim();
    var c = contacts();
    if (c[email]) return openpgp.readKey({ armoredKey: c[email] });
    var resp = await new Promise(function (resolve) {
      rcmail.addEventListener("plugin.browserpgp_pubkey", function (d) { resolve(d); });
      rcmail.http_get("plugin.browserpgp.getpubkey", { email: email });
    });
    if (resp && resp.has_key && resp.key) {
      c[email] = resp.key; saveContacts(c); // cache it
      return openpgp.readKey({ armoredKey: resp.key });
    }
    throw new Error("No public key available for " + email + ". Import it under Settings → PGP Keys.");
  }

  function parseRecipients() {
    var out = [];
    ["_to", "_cc", "_bcc"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value) {
        el.value.split(",").forEach(function (a) {
          var m = a.match(/[^<>\s,]+@[^<>\s,]+/);
          if (m) out.push(m[0].toLowerCase());
        });
      }
    });
    return out.filter(function (v, i, s) { return s.indexOf(v) === i; });
  }

  function composeBody() {
    // Plain-text compose textarea (Browser PGP requires plain text, not HTML).
    return document.getElementById("composebody");
  }

  // ---- Compose: encrypt the body in place before the user sends ----
  async function encryptCompose() {
    if (!haveOpenPGP()) return rcmail.display_message("OpenPGP.js failed to load.", "error");
    var body = composeBody();
    if (!body) return rcmail.display_message("Switch the composer to plain text to use Browser PGP.", "warning");
    var recips = parseRecipients();
    if (!recips.length) return rcmail.display_message("Add a recipient first.", "warning");

    try {
      var keys = [];
      for (var i = 0; i < recips.length; i++) keys.push(await recipientKey(recips[i]));
      // Also encrypt to self so the sender can read their Sent copy.
      var ownPub = lsGet(LS_PUB);
      if (ownPub) keys.push(await openpgp.readKey({ armoredKey: ownPub }));

      var message = await openpgp.createMessage({ text: body.value });
      var armored = await openpgp.encrypt({ message: message, encryptionKeys: keys });
      body.value = armored;
      if (window.tinyMCE && tinyMCE.get("composebody")) tinyMCE.get("composebody").setContent(armored);
      rcmail.display_message("Message encrypted. Review, then Send.", "confirmation");
    } catch (e) {
      rcmail.display_message("Encryption failed: " + e.message, "error");
    }
  }

  // If the decrypted data is itself a MIME entity (PGP/MIME wraps the original
  // content with headers), strip a leading header block so the body shows.
  function stripMimeHeaders(text) {
    if (/^(content-type|content-transfer-encoding|mime-version)\s*:/i.test(text)) {
      var idx = text.search(/\r?\n\r?\n/);
      if (idx !== -1) return text.slice(idx).replace(/^\s+/, "");
    }
    return text;
  }

  // ---- Message view: decrypt the message (fetch raw source so PGP/MIME, where
  // the ciphertext is in the encrypted.asc part, works too) ----
  async function decryptView() {
    if (!haveOpenPGP()) return rcmail.display_message("OpenPGP.js failed to load.", "error");
    var uid = rcmail.env.uid, mbox = rcmail.env.mailbox || rcmail.env.mbox;
    if (!uid) return rcmail.display_message("Open a message first.", "warning");

    rcmail.display_message("Fetching message…", "loading");
    var raw;
    try {
      var url = "?_task=mail&_action=viewsource&_uid=" + encodeURIComponent(uid) + "&_mbox=" + encodeURIComponent(mbox);
      raw = await fetch(url, { credentials: "same-origin" }).then(function (r) { return r.text(); });
    } catch (e) {
      return rcmail.display_message("Could not fetch the message source: " + e.message, "error");
    }
    var m = raw.match(/-----BEGIN PGP MESSAGE-----[\s\S]+?-----END PGP MESSAGE-----/);
    if (!m) return rcmail.display_message("No PGP-encrypted data found in this email.", "warning");

    var passphrase = prompt("Enter your PGP key passphrase to decrypt (it stays in this browser):");
    if (passphrase === null) return;
    try {
      var privateKey = await unlockPrivateKey(passphrase);
      var message = await openpgp.readMessage({ armoredMessage: m[0] });
      var decrypted = await openpgp.decrypt({ message: message, decryptionKeys: privateKey });
      var panel = document.createElement("pre");
      panel.className = "browserpgp-decrypted";
      panel.textContent = stripMimeHeaders(decrypted.data);
      var anchor = document.querySelector(".message-part, #messagebody, .message-content") || document.body;
      anchor.parentNode ? anchor.parentNode.insertBefore(panel, anchor) : anchor.appendChild(panel);
      rcmail.display_message("Decrypted in your browser.", "confirmation");
    } catch (e) {
      rcmail.display_message("Decryption failed (wrong passphrase or not encrypted to your key): " + e.message, "error");
    }
  }

  // ---- Settings page: key management ----
  async function generateKey() {
    var name = document.getElementById("bpgp-name").value || rcmail.env.browserpgp_email;
    var email = rcmail.env.browserpgp_email;
    var pass = document.getElementById("bpgp-pass").value;
    if (!pass || pass.length < 8) return rcmail.display_message("Choose a passphrase of at least 8 characters.", "warning");
    rcmail.display_message("Generating key…", "loading");
    try {
      var k = await openpgp.generateKey({
        type: "ecc", curve: "curve25519",
        userIDs: [{ name: name, email: email }],
        passphrase: pass,
      });
      lsSet(LS_PRIV, k.privateKey);
      lsSet(LS_PUB, k.publicKey);
      rcmail.display_message("Key generated and stored in this browser. Publish your public key so others can encrypt to you.", "confirmation");
      refreshStatus();
    } catch (e) {
      rcmail.display_message("Key generation failed: " + e.message, "error");
    }
  }

  async function importKey() {
    var armored = document.getElementById("bpgp-import").value.trim();
    if (!armored) return;
    try {
      if (armored.indexOf("PRIVATE KEY") !== -1) {
        await openpgp.readPrivateKey({ armoredKey: armored }); // validate
        lsSet(LS_PRIV, armored);
        // derive & store the public half
        var pk = await openpgp.readPrivateKey({ armoredKey: armored });
        lsSet(LS_PUB, pk.toPublic().armor());
        rcmail.display_message("Private key imported into this browser.", "confirmation");
      } else if (armored.indexOf("PUBLIC KEY") !== -1) {
        lsSet(LS_PUB, armored);
        rcmail.display_message("Public key stored.", "confirmation");
      } else {
        rcmail.display_message("That doesn't look like a PGP key.", "warning");
      }
      refreshStatus();
    } catch (e) {
      rcmail.display_message("Import failed: " + e.message, "error");
    }
  }

  function publishPubkey() {
    var pub = lsGet(LS_PUB);
    if (!pub) return rcmail.display_message("No public key to publish. Generate or import one first.", "warning");
    rcmail.addEventListener("plugin.browserpgp_published", function (d) {
      rcmail.display_message(d.message, d.ok ? "confirmation" : "error");
    });
    rcmail.http_post("plugin.browserpgp.publishpubkey", { key: pub });
  }

  function importContact() {
    var email = (document.getElementById("bpgp-contact-email").value || "").toLowerCase().trim();
    var key = document.getElementById("bpgp-contact-key").value.trim();
    if (!email || key.indexOf("PUBLIC KEY") === -1) return rcmail.display_message("Enter an email and an armored public key.", "warning");
    var c = contacts(); c[email] = key; saveContacts(c);
    rcmail.display_message("Stored public key for " + email + ".", "confirmation");
    refreshStatus();
  }

  function exportPub() {
    var pub = lsGet(LS_PUB);
    if (!pub) return;
    var el = document.getElementById("bpgp-pubout");
    if (el) { el.value = pub; el.style.display = "block"; }
  }

  function forgetKeys() {
    if (!confirm("Remove your PGP keys from this browser? If the private key isn't backed up elsewhere, encrypted mail becomes unreadable.")) return;
    [LS_PRIV, LS_PUB, LS_CONTACTS].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    refreshStatus();
    rcmail.display_message("Keys removed from this browser.", "confirmation");
  }

  function refreshStatus() {
    var s = document.getElementById("bpgp-status");
    if (!s) return;
    var hasPriv = !!lsGet(LS_PRIV), hasPub = !!lsGet(LS_PUB), n = Object.keys(contacts()).length;
    s.innerHTML = "Private key in this browser: <b>" + (hasPriv ? "yes" : "no") +
      "</b> · Public key: <b>" + (hasPub ? "yes" : "no") +
      "</b> · Contact keys: <b>" + n + "</b>";
  }

  // ---- Wire up UI depending on where we are ----
  rcmail.addEventListener("init", function () {
    var task = rcmail.env.task, action = rcmail.env.action;

    if (task === "settings" && action === "plugin.browserpgp") {
      // bind settings buttons
      var bind = function (id, fn) { var e = document.getElementById(id); if (e) e.addEventListener("click", function (ev) { ev.preventDefault(); fn(); }); };
      bind("bpgp-generate", generateKey);
      bind("bpgp-import-btn", importKey);
      bind("bpgp-publish", publishPubkey);
      bind("bpgp-export", exportPub);
      bind("bpgp-contact-add", importContact);
      bind("bpgp-forget", forgetKeys);
      refreshStatus();
    }

    if (task === "mail" && action === "compose") {
      rcmail.register_command("plugin.browserpgp.encrypt", encryptCompose, true);
      rcmail.addEventListener("init", function () {});
      // Add a toolbar button.
      var btn = $('<a href="#" class="button btn-pgp" role="button" title="Encrypt with Browser PGP">🔒 Encrypt (PGP)</a>');
      btn.on("click", function (e) { e.preventDefault(); encryptCompose(); });
      $("#compose-buttons,.formbuttons,.compose-toolbar").first().append(btn);
    }

    if (task === "mail" && (action === "show" || action === "preview" || action === "")) {
      var btn2 = $('<a href="#" class="button btn-pgp-decrypt" role="button" title="Decrypt with Browser PGP">🔓 Decrypt (PGP)</a>');
      btn2.on("click", function (e) { e.preventDefault(); decryptView(); });
      $(".header-links,.message-headers,#messageheader").first().append(btn2);
    }
  });
})();
