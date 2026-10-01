<?php
declare(strict_types=1);
define('MAX_API_TEST_MODE', true);
require __DIR__ . '/../api-php/index.php';
$called = [];
$forwarded = [];
$forward = static function ($update) use (&$forwarded) { $forwarded[] = $update; };
$respond = static function ($id, $text) use (&$called) { $called[] = [$id, $text]; };
$message = static fn($text, $attachments = []) => ['update_type' => 'message_created', 'message' => ['sender' => ['user_id' => 123], 'body' => ['text' => $text, 'attachments' => $attachments]]];
foreach ([['update_type' => 'bot_started', 'user_id' => 123], $message('/start'), $message('/start abc'), $message('/start=token'), $message('/start@bot=token'), $message('start'), $message(''), $message('A023222', [['type' => 'contact']]), $message('', [['type' => 'contact']])] as $update) {
    process_bot_update($update, $respond, $forward);
}
if ($called !== []) throw new RuntimeException('PHP replied to a Convex-owned event');
process_bot_update($message('Мой заказ А023222'), $respond);
process_bot_update($message('Здравствуйте'), $respond);
if (count($called) !== 2 || $called[0] !== [123, 'Мой заказ А023222']) throw new RuntimeException('Text lookup was lost');
if (env('MAX_LEGACY_TELEGRAM_ENABLED') === '1') throw new RuntimeException('Run tests without emergency flag');
echo "PASS webhook ownership, contact caption suppression, text dispatch; no HTTP sends\n";

$fixtures = json_decode(file_get_contents(__DIR__ . '/start-commands.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($fixtures as $fixture) {
    $start = max_start_command($fixture['text']);
    if (($start !== null) !== $fixture['start'] || ($start[1] ?? null) !== $fixture['payload']) {
        throw new RuntimeException('Start grammar mismatch: ' . json_encode($fixture));
    }
    $called = []; $forwarded = [];
    process_bot_update($message($fixture['text']), $respond, $forward);
    $expected = $fixture['start'] || trim($fixture['text']) === '' ? 0 : 1;
    if (count($forwarded) !== ($fixture['start'] && !$fixture['legacy'] ? 1 : 0)) throw new RuntimeException('Forwarding ownership mismatch: ' . json_encode($fixture));
    if (count($called) !== $expected) throw new RuntimeException('Start ownership mismatch: ' . json_encode($fixture));
}
echo 'PASS ' . count($fixtures) . " shared start variants and payloads; PHP defers every recognized start to Convex\n";

$called = [];
try {
    process_bot_update($message('start'), $respond, static function ($update) { throw new RuntimeException('held/failed forward'); });
    throw new RuntimeException('Forward error was swallowed');
} catch (RuntimeException $e) {
    if ($e->getMessage() !== 'held/failed forward') throw $e;
}
if ($called !== []) throw new RuntimeException('Forward failure must not send generic fallback');
try { max_forward_start($message('start')); throw new RuntimeException('Test network guard missing'); }
catch (RuntimeException $e) { if ($e->getMessage() !== 'Inject a forwarding callback in tests') throw $e; }
echo "PASS forward failure has no second responder; no test-mode network calls\n";

$called = []; $forwarded = [];
foreach (['chat', 'channel'] as $chatType) {
    foreach (['Мой заказ A023222', 'START'] as $text) {
        $event = $message($text);
        $event['message']['recipient'] = ['chat_type' => $chatType];
        process_bot_update($event, $respond, $forward);
    }
}
if ($called !== [] || $forwarded !== []) throw new RuntimeException('B0 group/channel guard was lost');
echo "PASS B0 private-chat-only PHP dispatch retained\n";

try { max_forward_start_envelope(['invalid' => "\xB1\x31"], 'dummy', '1790848800'); throw new RuntimeException('Malformed JSON accepted'); }
catch (RuntimeException $e) { if ($e->getMessage() !== 'MAX forwarding payload is not encodable') throw $e; }
echo "PASS PHP 7.2 compatible forwarding JSON failure guard\n";
