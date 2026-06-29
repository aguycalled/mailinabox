<?php
/**
 * Browser PGP for Roundcube (Mail-in-a-Box fork).
 *
 * Client-side OpenPGP: the user's PRIVATE key lives only in the browser
 * (passphrase-encrypted in localStorage) and all encryption/decryption happens
 * in the browser via OpenPGP.js. The server never sees private keys.
 *
 * The server side here is intentionally tiny and only handles PUBLIC keys:
 *  - a per-account public-key "directory" (reused from the at-rest PGP feature,
 *    $STORAGE_ROOT/mail/pgp_keys/<domain>/<user>.asc) so the compose UI can
 *    fetch a recipient's public key and encrypt to it before sending.
 */
class browserpgp extends rcube_plugin
{
    public $task = 'mail|settings';

    function init()
    {
        $this->add_texts('localization/', true);

        $rcmail = rcmail::get_instance();
        // The logged-in account's address (used as the key's user ID, and the
        // only address we let the user publish a public key for).
        $rcmail->output->set_env('browserpgp_email', $rcmail->get_user_name());

        // Load OpenPGP.js and our client logic into the mail and settings UIs.
        $this->include_script('vendor/openpgp.min.js');
        $this->include_script('browserpgp.js');
        $this->include_stylesheet('browserpgp.css');

        // Settings section where the user manages their key.
        $this->add_hook('settings_actions', [$this, 'settings_actions']);
        $this->register_action('plugin.browserpgp', [$this, 'settings_page']);

        // Public-key directory endpoints (public keys only).
        $this->register_action('plugin.browserpgp.getpubkey', [$this, 'action_getpubkey']);
        $this->register_action('plugin.browserpgp.publishpubkey', [$this, 'action_publishpubkey']);
    }

    function settings_actions($args)
    {
        $args['actions'][] = [
            'action' => 'plugin.browserpgp',
            'class'  => 'browserpgp enabled',
            'label'  => 'pgpkeys',
            'domain' => 'browserpgp',
        ];
        return $args;
    }

    function settings_page()
    {
        $rcmail = rcmail::get_instance();
        $rcmail->output->set_pagetitle($this->gettext('pgpkeys'));
        $rcmail->output->send('browserpgp.settings');
    }

    // Resolve the public-key directory base (set in config; falls back to the
    // Mail-in-a-Box default storage path).
    private function keydir()
    {
        $rcmail = rcmail::get_instance();
        $dir = $rcmail->config->get('browserpgp_keydir', '/home/user-data/mail/pgp_keys');
        return rtrim($dir, '/');
    }

    // Map an email address to its public-key file, guarding against traversal.
    private function keyfile($email)
    {
        $email = strtolower(trim($email));
        if (strpos($email, '@') === false) return null;
        [$user, $domain] = explode('@', $email, 2);
        if (!preg_match('/^[a-z0-9._+\-]+$/', $user) || !preg_match('/^[a-z0-9.\-]+$/', $domain)) {
            return null;
        }
        return $this->keydir() . '/' . $domain . '/' . $user . '.asc';
    }

    // GET ?email=... -> { has_key: bool, key: armored }
    function action_getpubkey()
    {
        $rcmail = rcmail::get_instance();
        $email  = rcube_utils::get_input_value('email', rcube_utils::INPUT_GPC);
        $file   = $this->keyfile($email);
        $resp   = ['has_key' => false, 'key' => ''];
        if ($file && is_file($file) && filesize($file) > 0) {
            $resp = ['has_key' => true, 'key' => file_get_contents($file)];
        }
        $rcmail->output->command('plugin.browserpgp_pubkey', $resp);
    }

    // POST key=<armored public key> -> stores it for the logged-in user only.
    function action_publishpubkey()
    {
        $rcmail = rcmail::get_instance();
        $key    = rcube_utils::get_input_value('key', rcube_utils::INPUT_POST);
        $email  = $rcmail->get_user_name(); // the logged-in account's address
        $file   = $this->keyfile($email);

        $ok = false; $msg = 'Invalid request.';
        if ($file && strpos($key, 'BEGIN PGP PUBLIC KEY BLOCK') !== false && strpos($key, 'PRIVATE KEY') === false) {
            @mkdir(dirname($file), 0755, true);
            if (@file_put_contents($file, rtrim($key, "\n") . "\n") !== false) {
                @chmod($file, 0644);
                $ok = true; $msg = 'Your public key was published to this box.';
            } else {
                $msg = 'Could not write the key file on the server.';
            }
        } elseif (strpos($key, 'PRIVATE KEY') !== false) {
            $msg = 'Refusing to store a PRIVATE key on the server.';
        }
        $rcmail->output->command('plugin.browserpgp_published', ['ok' => $ok, 'message' => $msg]);
    }
}
