<?php
declare(strict_types=1);
// Narrow ownership patch only; never replaces the server file with the git copy.
function handoff_source(string $source): string {
    $helper = <<<'PATCH'
// BEGIN IB_MAX_OWNERSHIP_HANDOFF_V2
function ib_handoff_is_start(string $text): bool
{
    // Frozen origin/master 1bb24212: no trim, no case/@bot expansion.
    // Explicit common whitespace, with historical JS NEL exception at this boundary.
    $ws = '\x{0009}-\x{000D}\x{0020}\x{0085}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';
    $legacyWs = str_replace('\x{0085}', '', $ws);
    return preg_match('/^\/start(?:[ =]([^' . $legacyWs . ']+))?(?=[' . $legacyWs . ']|$)/u', $text) === 1;
}
// END IB_MAX_OWNERSHIP_HANDOFF_V2

PATCH;
    $guard = <<<'PATCH'

    // BEGIN IB_MAX_OWNERSHIP_GUARD_V2
    if (($update['update_type'] ?? '') === 'bot_started') return;
    if (($update['update_type'] ?? '') === 'message_created') {
        $ibBody = $update['message']['body'] ?? [];
        if (is_array($ibBody)) {
            foreach (($ibBody['attachments'] ?? []) as $ibAttachment) {
                if (is_array($ibAttachment) && ($ibAttachment['type'] ?? '') === 'contact'
                    && is_string($ibAttachment['payload']['vcf_info'] ?? null)
                    && is_string($ibAttachment['payload']['hash'] ?? null)) return;
            }
            if (ib_handoff_is_start((string)($ibBody['text'] ?? ''))) return;
        }
    }
    // END IB_MAX_OWNERSHIP_GUARD_V2

PATCH;
    if (str_contains($source, 'IB_MAX_OWNERSHIP_HANDOFF_V2') || str_contains($source, 'ib_handoff_is_start')) {
        if (substr_count($source, $helper) === 1 && substr_count($source, $guard) === 1) return $source;
        throw new RuntimeException('Unknown existing ownership patch; inspect manually');
    }
    // Only the two reviewed signatures are accepted. Unknown server drift fails closed.
    $pattern = '/^function\s+process_bot_update\(array \$update(?:, \?callable \$respond = null)?\): void\s*\{/m';
    if (preg_match_all($pattern, $source, $matches, PREG_OFFSET_CAPTURE) !== 1) {
        throw new RuntimeException('Expected one recognized process_bot_update anchor');
    }
    [$signature, $offset] = $matches[0][0];
    return substr($source, 0, $offset) . $helper . $signature . $guard . substr($source, $offset + strlen($signature));
}

if (defined('IB_HANDOFF_TEST')) return;
try {
    $root = $argv[1] ?? '';
    $archive = $argv[2] ?? '';
    if ($root === '/' || !str_starts_with($root, '/') || realpath($root) !== $root) throw new RuntimeException('Invalid root');
    foreach (['www', 'www/max-app', 'www/max-api', 'max-deploy-backups'] as $dir) {
        $path = "$root/$dir";
        if (!is_dir($path) || is_link($path) || realpath($path) !== $path) throw new RuntimeException('Invalid directory');
    }
    if (!str_starts_with($archive, "$root/max-deploy-backups/snapshot-") || !str_ends_with($archive, '.tar.gz') || realpath($archive) !== $archive || is_link($archive)) throw new RuntimeException('Invalid backup path');
    $checksumPath = $archive . '.sha256';
    if (!is_file($checksumPath) || is_link($checksumPath)) throw new RuntimeException('Missing checksum');
    $expected = substr((string)file_get_contents($checksumPath), 0, 64);
    if (!preg_match('/^[a-f0-9]{64}$/D', $expected) || !hash_equals($expected, (string)hash_file('sha256', $archive))) throw new RuntimeException('Backup checksum mismatch');
    $path = "$root/www/max-api/index.php";
    if (!is_file($path) || is_link($path)) throw new RuntimeException('Invalid PHP file');
    $source = file_get_contents($path);
    if ($source === false) throw new RuntimeException('Cannot read PHP file');
    // The archive must cover this exact version, not an earlier concurrent edit.
    exec('tar -xOzf ' . escapeshellarg($archive) . ' max-api/index.php | sha256sum', $archivedHash, $archiveStatus);
    if ($archiveStatus !== 0 || !hash_equals(hash('sha256', $source), substr($archivedHash[0] ?? '', 0, 64))) throw new RuntimeException('PHP differs from backup; take a fresh full snapshot');
    $patched = handoff_source($source);
    if ($patched === $source) { echo "HANDOFF_ALREADY_PRESENT\n"; exit(0); }
    // Stage outside www so PHP source is never temporarily served as plain text.
    $temp = tempnam("$root/max-deploy-backups", '.handoff-');
    if ($temp === false) throw new RuntimeException('Cannot stage PHP patch');
    if (stat(dirname($temp))['dev'] !== stat(dirname($path))['dev']) { unlink($temp); throw new RuntimeException('Staging and target must share a filesystem for atomic rename'); }
    try {
        if (file_put_contents($temp, $patched) !== strlen($patched)) throw new RuntimeException('Incomplete staged PHP');
        exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($temp) . ' 2>&1', $lint, $status);
        if ($status !== 0) throw new RuntimeException('PHP lint failed: ' . implode("\n", $lint));
        if (!hash_equals(hash('sha256', $source), (string)hash_file('sha256', $path))) throw new RuntimeException('Remote PHP changed during patch; retry with fresh backup');
        if (!chmod($temp, fileperms($path) & 0777)) throw new RuntimeException('Cannot preserve PHP mode');
        if (!rename($temp, $path)) throw new RuntimeException('Cannot publish PHP patch');
    } finally {
        if (is_file($temp)) unlink($temp);
    }
    echo 'HANDOFF_PHP_SHA256=' . hash_file('sha256', $path) . "\n";
    echo "HANDOFF_BACKUP=$archive\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Handoff refused: ' . $e->getMessage() . "\n");
    exit(1);
}
